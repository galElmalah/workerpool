/**
 * Weekly templates per training block → the full planned calendar (past and future).
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { rngFor } from './prng';
import { THRESHOLD_STEPS, thresholdsAt } from './profile';
import type { Season, WeekInfo } from './season';
import type { SynthPlannedSession, SynthThresholdChange } from './types';
import type { SessionCtx, SessionDraft } from './sessions/common';
import { bikeEnduranceIndoor, bikeLong, bikeOpeners, bikeRaceLeg, bikeRecovery, bikeSweetSpot, bikeTest, bikeThreshold, bikeVo2 } from './sessions/bike';
import { runBrick, runEasy, runHills, runLong, runRace, runShakeout, runTempo, runTrack, runTt30 } from './sessions/run';
import { swimCss, swimCssTest, swimEasy, swimEndurance, swimOpenWater, swimRaceLeg } from './sessions/swim';
import { rowPieces, rowTest, rowUt2 } from './sessions/row';
import { mobility, strengthA, strengthB } from './sessions/strength';
import { hike, walk, yoga } from './sessions/misc';
import { hhmmToSec, isSummer, secToHhmm } from './util';

type Make = (c: SessionCtx) => SessionDraft;
interface Slot {
  dow: number;
  time: string;
  make: Make;
  /** Start this slot after the previous slot of the same day ends (+gap minutes). */
  after?: number;
  /** Override key flag. */
  key?: boolean;
}

const S = (dow: number, time: string, make: Make, extra: Partial<Slot> = {}): Slot => ({ dow, time, make, ...extra });

function recoveryWeek(w: WeekInfo): Slot[] {
  return [
    S(1, '06:45', (c) => swimEasy(c, 1800)),
    S(2, '18:30', (c) => bikeEnduranceIndoor(c, 50)),
    S(3, '07:00', (c) => runEasy(c, 40)),
    S(3, '18:30', (c) => (w.rel < -12 ? strengthA(c) : mobility(c))),
    S(4, '19:00', (c) => yoga(c, 45)),
    S(5, '06:45', (c) => swimEndurance(c)),
    S(6, '09:30', (c) => bikeLong({ ...c, vol: c.vol * 1.1 })),
    S(7, '09:00', (c) => runLong({ ...c, vol: c.vol * 1.1 })),
  ];
}

function templateFor(w: WeekInfo): Slot[] {
  const summer = isSummer(addDays(w.monday, 3));
  if (w.recovery) return recoveryWeek(w);
  switch (w.block) {
    case 'offseason':
      return [
        S(1, '18:30', strengthA),
        S(2, '07:15', (c) => runEasy(c, 40, true)),
        S(2, '18:30', (c) => bikeEnduranceIndoor(c, 60)),
        S(3, '07:00', swimEndurance),
        S(3, '18:45', rowUt2),
        S(4, '18:30', runHills),
        S(5, '18:30', strengthB),
        S(6, '10:00', bikeLong),
        S(7, '09:30', (c) => runLong(c)),
      ];
    case 'genprep':
      return [
        S(1, '06:45', swimCss),
        S(1, '18:30', strengthA),
        S(2, '18:30', bikeSweetSpot),
        S(3, '07:00', (c) => runEasy(c, 45, true)),
        S(3, '18:45', (c) => (w.index % 2 === 0 ? rowUt2(c) : rowPieces(c))),
        S(4, '06:30', (c) => bikeEnduranceIndoor(c, 60)),
        S(4, '18:30', runTempo),
        S(5, '06:45', swimEndurance),
        S(5, '18:30', strengthB),
        S(6, '09:30', bikeLong),
        S(7, '09:00', (c) => runLong(c, { trail: w.pos === 1 && w.index % 3 === 0 })),
      ];
    case 'base':
      return [
        S(1, '06:45', swimCss),
        S(1, '18:30', strengthA),
        S(2, '18:30', (c) => (w.index % 2 === 0 ? bikeThreshold(c) : bikeSweetSpot(c))),
        S(3, '07:00', (c) => runEasy(c, 50, true)),
        S(3, '18:45', (c) => (w.index % 2 === 0 ? rowPieces(c) : rowUt2(c))),
        S(4, '06:30', (c) => bikeEnduranceIndoor(c, 60)),
        S(4, '18:30', (c) => (w.rel >= -15 ? runTrack(c) : runTempo(c))),
        S(5, '07:00', (c) => (summer && w.index % 2 === 0 ? swimOpenWater(c) : swimEndurance(c))),
        ...(w.index % 2 === 1 ? [S(5, '18:30', strengthB)] : []),
        S(6, '08:30', bikeLong),
        S(7, '08:30', (c) => runLong(c, { trail: w.pos === 2 && w.index % 2 === 0 })),
      ];
    case 'build1':
    case 'build2': {
      const brick = w.block === 'build2' || w.pos === 2;
      return [
        S(1, '06:45', swimCss),
        S(1, '18:30', strengthA),
        S(2, '18:30', bikeVo2),
        S(3, '07:00', (c) => runEasy(c, 50, true)),
        S(3, '18:45', (c) => (w.block === 'build1' ? rowPieces(c) : rowUt2(c))),
        S(4, '06:30', (c) => bikeEnduranceIndoor(c, 60)),
        S(4, '18:30', runTrack),
        S(5, '07:30', (c) => (summer ? swimOpenWater(c, w.block === 'build2') : swimEndurance(c))),
        S(6, '08:00', bikeLong),
        ...(brick ? [S(6, '', (c) => runBrick(c, 20), { after: 6 })] : []),
        S(7, '08:30', (c) => runLong(c), { key: w.pos !== 2 }),
      ];
    }
    case 'peak':
      return [
        S(1, '07:30', (c) => swimOpenWater(c, true)),
        ...(w.rel === -3 ? [S(1, '18:30', strengthA)] : []),
        S(2, '18:30', (c) => bikeThreshold(c, true)),
        S(3, '07:00', (c) => runEasy(c, 50, true)),
        S(3, '19:00', swimCss),
        S(4, '06:30', (c) => bikeEnduranceIndoor(c, 60)),
        S(4, '18:30', runTempo),
        S(5, '07:30', (c) => swimOpenWater(c)),
        S(6, '08:00', bikeLong),
        S(6, '', (c) => runBrick(c, w.rel === -3 ? 30 : 20), { after: 6 }),
        S(7, '08:30', (c) => (w.rel === -3 ? runLong(c) : runEasy(c, 60))),
      ];
    case 'taper':
      return [
        S(1, '06:45', swimCss),
        S(2, '18:30', (c) => bikeThreshold(c, true)),
        S(3, '07:00', (c) => runEasy(c, 40, true)),
        S(4, '07:30', (c) => swimOpenWater(c, true)),
        S(4, '18:30', (c) => runTempo({ ...c, variant: 2 })),
        S(6, '08:30', (c) => bikeLong({ ...c, vol: 0.55 })),
        S(6, '', (c) => runBrick(c, 15), { after: 5 }),
        S(7, '09:00', (c) => runEasy(c, 55)),
      ];
    case 'race':
      return [
        S(1, '07:00', (c) => swimEasy(c, 1500)),
        S(2, '18:00', (c) => bikeOpeners(c, 45)),
        S(3, '07:30', (c) => runShakeout(c, 30)),
        S(4, '07:30', (c) => swimEasy(c, 1200)),
        S(6, '10:00', (c) => bikeRecovery(c, 25, true)),
        S(6, '', (c) => runShakeout(c, 15), { after: 3 }),
        S(7, '08:00', (c) => swimRaceLeg(c, 1900, 'Costa Brava Half'), { key: true }),
        S(7, '', (c) => bikeRaceLeg(c, 90000, 'Costa Brava Half'), { after: 4 }),
        S(7, '', (c) => runRace(c, 21100, 'Costa Brava Half — Run 21.1k', ['A-race']), { after: 3 }),
      ];
    case 'post_recovery':
      return [
        S(2, '08:00', (c) => swimEasy(c, 1200)),
        S(3, '18:30', (c) => walk(c, 45)),
        S(4, '17:30', (c) => bikeRecovery(c, 45, true)),
        S(6, '10:00', (c) => bikeRecovery(c, 90, true)),
        S(7, '09:30', (c) => runEasy(c, 30)),
      ];
    case 'vacation':
      return [S(2, '09:00', (c) => hike(c, 240, 'Vall de Núria')), S(4, '08:00', (c) => runEasy({ ...c, vol: 0.8 }, 40)), S(6, '08:30', (c) => hike(c, 300, 'Puigmal'))];
    case 'transition':
      return [
        S(1, '18:30', strengthA),
        S(2, '07:00', (c) => swimEasy(c, 1800)),
        S(3, '07:00', (c) => runEasy({ ...c, vol: 0.8 }, 40)),
        S(5, '19:00', (c) => yoga(c, 45)),
        S(6, '10:00', (c) => bikeRecovery(c, 120, true)),
        S(7, '09:30', (c) => runEasy({ ...c, vol: 0.85 }, 50)),
      ];
    case 'runbase':
      return [
        S(1, '07:00', swimEndurance),
        S(1, '18:30', strengthA),
        S(2, '07:00', (c) => runEasy(c, 45, true)),
        S(2, '18:30', bikeSweetSpot),
        S(3, '07:00', swimCss),
        S(3, '18:45', rowUt2),
        S(4, '18:30', runTempo),
        S(5, '18:30', strengthB),
        S(6, '09:30', bikeLong),
        S(7, '09:00', (c) => runLong(c, { trail: w.rel === 5 })),
      ];
    case 'hmbuild':
      return [
        S(1, '07:00', swimEndurance),
        S(1, '18:30', strengthA),
        S(2, '18:30', runTrack),
        S(3, '07:00', (c) => runEasy(c, 40)),
        S(3, '18:30', bikeSweetSpot),
        S(4, '18:30', (c) => runTempo(c, true)),
        S(5, '07:00', swimCss),
        S(5, '18:45', rowUt2),
        S(6, '09:30', bikeLong),
        S(7, '09:00', (c) => runLong(c, { hmPace: w.rel >= 8 })),
      ];
    case 'hmtaper':
      return [
        S(1, '07:00', (c) => swimEasy(c, 1500)),
        S(2, '18:30', (c) => runTrack(c, true)),
        S(3, '18:30', (c) => bikeEnduranceIndoor(c, 45)),
        S(4, '07:00', (c) => runEasy(c, 35, true)),
        S(5, '07:00', (c) => swimEasy(c, 1200)),
        S(6, '09:00', (c) => runShakeout(c, 20)),
        S(7, '09:00', (c) => runRace(c, 21097, 'Riu Ter Half Marathon', ['B-race'])),
      ];
  }
}

/** Replace template slots with tests and C races scheduled in this week. */
function applyOverrides(w: WeekInfo, slots: Slot[], season: Season): Slot[] {
  const out = [...slots];
  const replace = (dow: number, pred: (s: Slot) => boolean, slot: Slot | null) => {
    const i = out.findIndex((s) => s.dow === dow && pred(s));
    if (i >= 0) {
      if (slot) out[i] = slot;
      else out.splice(i, 1);
    } else if (slot) out.push(slot);
  };
  for (const st of THRESHOLD_STEPS) {
    if (!st.test || st.rel !== w.rel) continue;
    switch (st.test) {
      case 'ftp_20':
      case 'ftp_ramp': {
        const kind = st.test;
        replace(st.dow, (s) => s.time !== '' && s.time >= '08:00', S(st.dow, '09:30', (c) => bikeTest(c, kind)));
        break;
      }
      case 'css':
        replace(st.dow, (s) => s.time < '12:00', S(st.dow, '07:00', swimCssTest));
        break;
      case 'row_2k':
        replace(st.dow, (s) => s.time >= '18:00', S(st.dow, '18:45', rowTest));
        break;
      case 'run_tt30':
        replace(st.dow, () => true, S(st.dow, '09:00', runTt30));
        break;
      case 'run_10k':
        replace(st.dow, () => true, S(st.dow, '10:00', (c) => runRace(c, 10000, 'Girona Winter 10K', ['C-race'])));
        replace(6, (s) => s.time >= '08:00', S(6, '10:00', (c) => bikeEnduranceIndoor(c, 60)));
        break;
    }
  }
  if (addDays(w.monday, 6) === season.sprintDate) {
    replace(6, (s) => s.time !== '', S(6, '09:30', (c) => bikeOpeners(c, 60)));
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.dow === 6 && out[i]!.after) out.splice(i, 1);
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.dow === 7) out.splice(i, 1);
    out.push(
      S(7, '09:00', (c) => swimRaceLeg(c, 750, 'Banyoles Sprint')),
      S(7, '', (c) => bikeRaceLeg(c, 20000, 'Banyoles Sprint'), { after: 3 }),
      S(7, '', (c) => runRace(c, 5000, 'Banyoles Sprint — Run 5k', ['C-race']), { after: 2 }),
    );
  }
  return out;
}

export function buildPlan(seed: number, season: Season, history: SynthThresholdChange[]): SynthPlannedSession[] {
  const plan: SynthPlannedSession[] = [];
  for (const w of season.weeks) {
    const slots = applyOverrides(w, templateFor(w), season);
    const byDay = new Map<number, Slot[]>();
    for (const s of slots) {
      const arr = byDay.get(s.dow) ?? [];
      arr.push(s);
      byDay.set(s.dow, arr);
    }
    for (const [dow, daySlots] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      const date: LocalDate = addDays(w.monday, dow - 1);
      if (date < season.start) continue;
      const thr = thresholdsAt(history, date);
      // chains: a timed slot followed by its 'after' slots (declaration order); chains sorted by time
      const chains: Slot[][] = [];
      for (const s of daySlots) {
        if (s.after !== undefined && chains.length) chains[chains.length - 1]!.push(s);
        else chains.push([s]);
      }
      chains.sort((a, b) => a[0]!.time.localeCompare(b[0]!.time));
      const ordered = chains.flat();
      const sessions: { draft: SessionDraft; time: string }[] = [];
      let prevEnd = 0;
      ordered.forEach((slot, i) => {
        const c: SessionCtx = { thr, week: w, date, rng: rngFor(seed, 'plan', date, i), variant: w.index + i, vol: w.volume };
        const d = slot.make(c);
        if (slot.key !== undefined) d.isKey = slot.key;
        let startSec = slot.time ? hhmmToSec(slot.time) : prevEnd + (slot.after ?? 5) * 60;
        startSec = Math.ceil(startSec / 300) * 300;
        prevEnd = startSec + d.plannedDurationSec;
        sessions.push({ draft: d, time: secToHhmm(startSec) });
      });
      sessions.sort((a, b) => a.time.localeCompare(b.time));
      sessions.forEach((s, i) => {
        plan.push({
          key: `${date}#${i + 1}`,
          date,
          startTime: s.time,
          ...s.draft,
        });
      });
    }
  }
  return plan;
}
