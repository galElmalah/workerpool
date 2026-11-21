/**
 * Macro periodisation. Everything is anchored on the A-race week, placed 7 weeks before the
 * current week so the generated history always ends with taper → race → recovery → a fresh
 * build towards a B race ~3–4 weeks after `today`.
 *
 *   rel ≤ −40  Off-season        (general training, gym + run heavy)
 *   −39…−24    General prep 1–4  (4-week 3:1 mesocycles)
 *   −23…−12    Base 1–3
 *   −11…−8     Build 1           (sprint tri C-race at −10)
 *   −7…−4      Build 2
 *   −3…−2      Peak
 *   −1         Taper
 *    0         Race week         (A race on Sunday)
 *    1         Recovery
 *    2–3       Transition        (vacation in the Pyrenees at +2)
 *    4–6       Run base
 *    7–9       HM build          (current week = +7)
 *   10         HM taper          (B race on Sunday)
 */
import type { DayMarker, Event, LocalDate, Phase } from '@cadence/core/domain';
import { addDays, diffDays, weekStart } from '@cadence/core/time';
import { rngFor } from './prng';

export type Block =
  | 'offseason'
  | 'genprep'
  | 'base'
  | 'build1'
  | 'build2'
  | 'peak'
  | 'taper'
  | 'race'
  | 'post_recovery'
  | 'vacation'
  | 'transition'
  | 'runbase'
  | 'hmbuild'
  | 'hmtaper';

export interface WeekInfo {
  index: number;
  monday: LocalDate;
  /** Weeks relative to the A-race week. */
  rel: number;
  block: Block;
  phaseType: Phase['type'];
  phaseLabel: string;
  /** Position within a 3:1 mesocycle (3 = recovery week); −1 when not in one. */
  pos: number;
  recovery: boolean;
  /** Relative training volume (1.0 ≈ 12 h/week). */
  volume: number;
}

export interface Range {
  start: LocalDate;
  end: LocalDate;
  label: string;
}

export interface Season {
  start: LocalDate; // Monday, first day of history
  today: LocalDate;
  end: LocalDate; // Sunday, last planned day
  raceMonday: LocalDate;
  aRaceDate: LocalDate;
  bRaceDate: LocalDate;
  tenKDate: LocalDate;
  sprintDate: LocalDate;
  weeks: WeekInfo[];
  phases: Omit<Phase, 'id'>[];
  events: Omit<Event, 'id'>[];
  sick: Range;
  travel: Range;
  injury: Range;
  vacation: Range;
}

interface BlockInfo {
  block: Block;
  type: Phase['type'];
  label: string;
  pos: number;
  base: number;
}

const MESO = [0.94, 1.0, 1.07, 0.7];

function blockFor(relIn: number): BlockInfo {
  // histories longer than one season repeat the previous season's structure
  let rel = relIn;
  while (rel < -45) rel += 52;
  if (rel <= -40) return { block: 'offseason', type: 'transition', label: 'Off-season', pos: -1, base: 0.46 };
  if (rel <= -24) {
    const g = Math.floor((rel + 39) / 4);
    return { block: 'genprep', type: 'base', label: `General prep ${g + 1}`, pos: (rel + 39) % 4, base: [0.54, 0.58, 0.62, 0.66][g]! };
  }
  if (rel <= -12) {
    const g = Math.floor((rel + 23) / 4);
    return { block: 'base', type: 'base', label: `Base ${g + 1}`, pos: (rel + 23) % 4, base: [0.72, 0.77, 0.82][g]! };
  }
  if (rel <= -8) return { block: 'build1', type: 'build', label: 'Build 1', pos: rel + 11, base: 0.9 };
  if (rel <= -4) return { block: 'build2', type: 'build', label: 'Build 2', pos: rel + 7, base: 0.95 };
  if (rel <= -2) return { block: 'peak', type: 'peak', label: 'Peak', pos: -1, base: rel === -3 ? 0.96 : 0.9 };
  if (rel === -1) return { block: 'taper', type: 'taper', label: 'Taper', pos: -1, base: 0.62 };
  if (rel === 0) return { block: 'race', type: 'race', label: 'Race week', pos: -1, base: 0.42 };
  if (rel === 1) return { block: 'post_recovery', type: 'recovery', label: 'Recovery', pos: -1, base: 0.3 };
  if (rel === 2) return { block: 'vacation', type: 'transition', label: 'Transition', pos: -1, base: 0.3 };
  if (rel === 3) return { block: 'transition', type: 'transition', label: 'Transition', pos: -1, base: 0.42 };
  if (rel <= 6) return { block: 'runbase', type: 'base', label: 'Run base', pos: -1, base: [0.6, 0.66, 0.72][rel - 4]! };
  if (rel <= 9) return { block: 'hmbuild', type: 'build', label: 'HM build', pos: -1, base: [0.74, 0.8, 0.72][rel - 7]! };
  if (rel === 10) return { block: 'hmtaper', type: 'taper', label: 'HM taper', pos: -1, base: 0.48 };
  return { block: 'runbase', type: 'base', label: 'Winter base', pos: -1, base: 0.62 };
}

export function buildSeason(seed: number, today: LocalDate, months: number): Season {
  const curMonday = weekStart(today);
  const raceMonday = addDays(curMonday, -7 * 7);
  const start = weekStart(addDays(today, -Math.round(months * 30.4375)));
  const end = addDays(curMonday, 3 * 7 + 6);
  const weeks: WeekInfo[] = [];
  for (let m = start, i = 0; m <= end; m = addDays(m, 7), i++) {
    const rel = Math.round(diffDays(raceMonday, m) / 7);
    const b = blockFor(rel);
    const meso = b.pos >= 0 ? MESO[b.pos]! : 1;
    const noise = 1 + rngFor(seed, 'weekvol', m).range(-0.04, 0.04);
    weeks.push({
      index: i,
      monday: m,
      rel,
      block: b.block,
      phaseType: b.type,
      phaseLabel: b.label,
      pos: b.pos,
      recovery: b.pos === 3,
      volume: b.base * meso * noise,
    });
  }

  // contiguous phases (merge consecutive weeks with the same label)
  const phases: Omit<Phase, 'id'>[] = [];
  for (const w of weeks) {
    const last = phases[phases.length - 1];
    if (last && last.label === w.phaseLabel && last.type === w.phaseType) {
      last.endDate = addDays(w.monday, 6);
      last.weeklyLoadTarget = Math.max(last.weeklyLoadTarget ?? 0, Math.round((w.volume * 620) / 10) * 10);
    } else {
      phases.push({
        type: w.phaseType,
        label: w.phaseLabel,
        startDate: w.monday,
        endDate: addDays(w.monday, 6),
        weeklyLoadTarget: Math.round((w.volume * 620) / 10) * 10,
      });
    }
  }

  const at = (rel: number, dow: number): LocalDate => addDays(raceMonday, rel * 7 + dow - 1);
  const aRaceDate = at(0, 7);
  const bRaceDate = at(10, 7);
  const tenKDate = at(-32, 7);
  const sprintDate = at(-10, 7);

  const allEvents: Omit<Event, 'id'>[] = [
    {
      date: tenKDate,
      name: 'Girona Winter 10K',
      priority: 'C',
      sport: 'run',
      distanceM: 10000,
      goal: 'Sub 40, even splits',
      location: 'Girona',
      note: 'Fitness check in the middle of the winter block. No taper.',
    },
    {
      date: sprintDate,
      name: 'Banyoles Sprint Triathlon',
      priority: 'C',
      distanceM: 25750,
      goal: 'Practise transitions, race the bike hard',
      location: 'Banyoles',
      note: '750 m lake swim / 20 km / 5 km. Training race inside Build 1.',
    },
    {
      date: aRaceDate,
      name: 'Costa Brava Half Triathlon',
      priority: 'A',
      distanceM: 113000,
      goal: 'Sub 5:00 — run off the bike under 1:40',
      location: "Platja d'Aro",
      note: '1.9 km sea swim, 90 km rolling bike (~750 m), 21.1 km flat run (2 laps).',
    },
    {
      date: bRaceDate,
      name: 'Riu Ter Half Marathon',
      priority: 'B',
      sport: 'run',
      distanceM: 21097,
      goal: 'Sub 1:30',
      location: 'Girona',
      note: 'Flat river course. Short build off the back of the tri season.',
    },
  ];
  const events = allEvents.filter((e) => e.date >= start && e.date <= end);

  const sick: Range = { start: at(-18, 3), end: at(-17, 1), label: 'Flu' };
  const travel: Range = { start: at(-28, 2), end: at(-28, 4), label: 'Lisbon (work)' };
  const injury: Range = { start: at(-26, 4), end: at(-26, 6), label: 'Calf niggle' };
  const vacation: Range = { start: at(2, 1), end: at(2, 7), label: 'Pyrenees' };

  return {
    start,
    today,
    end,
    raceMonday,
    aRaceDate,
    bRaceDate,
    tenKDate,
    sprintDate,
    weeks,
    phases,
    events,
    sick,
    travel,
    injury,
    vacation,
  };
}

export function inRange(d: LocalDate, r: Range): boolean {
  return d >= r.start && d <= r.end;
}

export function seasonMarkers(s: Season): Omit<DayMarker, 'id'>[] {
  const out: Omit<DayMarker, 'id'>[] = [];
  const add = (type: DayMarker['type'], r: Range) => {
    if (r.end < s.start || r.start > s.end) return;
    out.push({ type, date: r.start < s.start ? s.start : r.start, endDate: r.end, label: r.label });
  };
  add('travel', s.travel);
  add('injured', s.injury);
  add('sick', s.sick);
  add('vacation', s.vacation);
  return out;
}
