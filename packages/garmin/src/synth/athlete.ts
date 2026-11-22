/**
 * generateAthlete: season → plan → execution (skips, swaps, unplanned extras) → activity models
 * → wellness → coarse simulation → summaries, notes. Holds no streams.
 * generateActivityDetail: rebuilds one activity's model from the athlete and renders 1 Hz.
 */
import type { DayMarker, LocalDate, WellnessDay } from '@cadence/core/domain';
import { addDays, diffDays, eachDay, isoWeekOf, isoWeekday } from '@cadence/core/time';
import { garminTypeKey, type Header } from './internal';
import { buildModel, type Model, type ModelCtx } from './model';
import { athleteVoice, RANDOM_DAY_NOTES, weekReflection } from './notes';
import { buildPlan } from './plan';
import { rngFor } from './prng';
import { buildProfile, buildThresholdHistory, PROFILE_BASE, thresholdsAfter, thresholdsAt } from './profile';
import { renderDynamics, summaryExtras } from './extras';
import { render } from './render';
import { buildSeason, inRange, seasonMarkers, type Season } from './season';
import { BasePool, simulate } from './simulate';
import { summarize, type Summary } from './summary';
import type { SynthActivity, SynthActivityDetail, SynthAthlete, SynthOptions, SynthPlannedSession, SynthThresholdChange } from './types';
import { airTempC, fmtDuration, fmtPaceKm, hhmmToSec, isoFromMs, isWinter, localToEpochMs, madridOffsetMin, round } from './util';
import { buildWellness, hrOffsetFromWellness } from './wellness';

// ───────────────────────────── shared ctx (used by both passes) ─────────────────────────────

function localStartHour(h: Header): number {
  const ms = Date.parse(h.startedAt) + h.utcOffsetMin * 60_000;
  return ((ms / 3_600_000) % 24 + 24) % 24;
}

export function modelCtx(seed: number, history: SynthThresholdChange[], markers: Omit<DayMarker, 'id'>[], h: Header): ModelCtx {
  const d = h.localDate;
  const covers = (type: DayMarker['type'], date: LocalDate) => markers.some((m) => m.type === type && date >= m.date && date <= (m.endDate ?? m.date));
  const tomorrow = addDays(d, 1);
  const sickTomorrow = markers.some((m) => m.type === 'sick' && m.date === tomorrow);
  const place = covers('vacation', d) ? 'vacation' : covers('travel', d) ? 'travel' : 'home';
  return {
    seed,
    thr: thresholdsAt(history, d),
    thrNext: thresholdsAfter(history, d),
    sickTomorrow,
    place,
    tempC: airTempC(seed, d, localStartHour(h)),
  };
}

/** Garmin-style activity id: increases with start time, unique per start second. */
function activityId(seed: number, epochMs: number): number {
  return 20_000_000_000 + (Math.floor(epochMs / 1000) - 1_700_000_000) * 4 + (seed % 4);
}

function headerOf(a: SynthActivity): Header {
  const h: Header = { id: a.garminActivityId, sport: a.sport, title: a.title, startedAt: a.startedAt, localDate: a.localDate, utcOffsetMin: a.utcOffsetMin };
  if (a.subSport) h.subSport = a.subSport;
  if (a.plannedKey) h.plannedKey = a.plannedKey;
  return h;
}

// ───────────────────────────── execution decisions ─────────────────────────────

type Exec = { kind: 'skip'; reason: NonNullable<SynthPlannedSession['skipped']>['reason'] } | { kind: 'missed' } | { kind: 'do'; swap?: 'indoor' | 'treadmill' };

function decide(seed: number, s: Season, p: SynthPlannedSession): Exec {
  const rng = rngFor(seed, 'skip', p.key);
  const d = p.date;
  const race = p.tags.includes('race') || p.tags.includes('test');
  if (inRange(d, s.sick)) return { kind: 'skip', reason: 'sick' };
  const afterSick = diffDays(s.sick.end, d);
  if (afterSick >= 1 && afterSick <= 2 && rng.chance(0.55)) return { kind: 'skip', reason: 'sick' };
  if (inRange(d, s.injury) && p.sport === 'run') return { kind: 'skip', reason: 'injury' };
  if (inRange(d, s.travel)) {
    if (p.sport === 'run') return { kind: 'do', swap: 'treadmill' };
    return { kind: 'skip', reason: 'travel' };
  }
  if (race) return { kind: 'do' };
  if (p.sport === 'bike' && p.environment === 'outdoor') {
    const pw = isWinter(d) ? 0.16 : 0.03;
    if (rng.chance(pw)) return rng.chance(0.5) ? { kind: 'skip', reason: 'weather' } : { kind: 'do', swap: 'indoor' };
  }
  if (p.sport === 'run' && isWinter(d) && rng.chance(0.02)) return { kind: 'skip', reason: 'weather' };
  const r = rng.next();
  if (!p.isKey && r < 0.016) return { kind: 'missed' };
  if (r < 0.038) return { kind: 'skip', reason: 'life' };
  if (r < 0.048 && !p.isKey) return { kind: 'skip', reason: 'fatigue' };
  if (r < 0.052) return { kind: 'skip', reason: 'other' };
  return { kind: 'do' };
}

interface Pending {
  header: Header;
  planned?: SynthPlannedSession;
  model: Model;
  ctx: ModelCtx;
}

interface Candidate {
  planned?: SynthPlannedSession;
  sport: SynthActivity['sport'];
  subSport?: SynthActivity['subSport'];
  title: string;
  /** Planned local start (s of day). */
  at: number;
  chained: boolean;
}

function unplannedFor(seed: number, s: Season, d: LocalDate, dayPlan: SynthPlannedSession[]): Candidate[] {
  const rng = rngFor(seed, 'unplanned', d);
  const out: Candidate[] = [];
  if (inRange(d, s.sick) || inRange(d, s.travel)) return out;
  const wd = isoWeekday(d);
  const vac = inRange(d, s.vacation);
  const busyEvening = dayPlan.some((p) => (p.startTime ?? '') >= '16:00');
  const busyMorning = dayPlan.some((p) => (p.startTime ?? '') < '12:00');
  const rel = Math.round(diffDays(s.raceMonday, d) / 7);
  const town = vac ? 'Queralbs' : 'Girona';
  if (vac) {
    if (!busyMorning && rng.chance(0.3)) out.push({ sport: 'hike', subSport: 'generic', title: `${town} Hiking`, at: 9.5 * 3600, chained: false });
    else if (!busyEvening && rng.chance(0.5)) out.push({ sport: 'walk', subSport: 'generic', title: `${town} Walking`, at: 18 * 3600, chained: false });
    return out;
  }
  if (wd >= 6 && !busyEvening && rng.chance(0.13)) out.push({ sport: 'walk', subSport: 'generic', title: 'Girona Walking', at: 17.5 * 3600, chained: false });
  if (wd === 7 && !busyEvening && rng.chance(0.06)) out.push({ sport: 'yoga', subSport: 'generic', title: 'Yoga', at: 19 * 3600, chained: false });
  if (wd >= 2 && wd <= 5 && !busyEvening && !dayPlan.some((p) => p.sport === 'bike') && rng.chance(0.045) && !isWinter(d))
    out.push({ sport: 'bike', subSport: 'road', title: rng.chance(0.5) ? 'Girona Road Cycling' : 'Coffee spin', at: 18 * 3600, chained: false });
  if ((rel === 1 || rel === 3) && wd === 7 && !busyMorning) out.push({ sport: 'hike', subSport: 'generic', title: 'Gavarres hike', at: 10 * 3600, chained: false });
  return out;
}

// ───────────────────────────── generateAthlete ─────────────────────────────

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function generateAthlete(opts: SynthOptions): SynthAthlete {
  const seed = opts.seed ?? 7;
  const months = opts.months ?? 12;
  const today = opts.today;
  const season = buildSeason(seed, today, months);
  const history = buildThresholdHistory(season.raceMonday, season.start, today);
  const profile = buildProfile(history, today);
  const plan = buildPlan(seed, season, history);
  const markers = seasonMarkers(season);

  const planByDate = new Map<LocalDate, SynthPlannedSession[]>();
  for (const p of plan) {
    const arr = planByDate.get(p.date) ?? [];
    arr.push(p);
    planByDate.set(p.date, arr);
  }

  // 1) execution + models
  const pending: Pending[] = [];
  for (const d of eachDay(season.start, today)) {
    const dayPlan = planByDate.get(d) ?? [];
    const cands: Candidate[] = [];
    for (const p of dayPlan) {
      if (d === today && (p.startTime ?? '23:59') >= '10:00') continue;
      const ex = decide(seed, season, p);
      if (ex.kind === 'skip') {
        p.skipped = { reason: ex.reason };
        continue;
      }
      if (ex.kind === 'missed') continue;
      let subSport = p.subSport;
      let title = p.title;
      if (ex.swap === 'indoor') {
        subSport = 'indoor';
        title = `${p.title} → trainer`;
      } else if (ex.swap === 'treadmill') {
        subSport = 'treadmill';
        title = 'Hotel treadmill run';
      }
      const at = hhmmToSec(p.startTime ?? '08:00');
      const c: Candidate = { planned: p, sport: p.sport, title, at, chained: p.tags.includes('brick') || (p.tags.includes('race') && cands.some((x) => x.planned?.tags.includes('race'))) };
      if (subSport) c.subSport = subSport;
      cands.push(c);
    }
    if (d !== today) cands.push(...unplannedFor(seed, season, d, dayPlan));
    cands.sort((a, b) => a.at - b.at);
    const off = madridOffsetMin(d);
    let prevEnd = -1;
    for (const c of cands) {
      const rng = rngFor(seed, 'start', d, c.title);
      let startSec: number;
      if (c.chained && prevEnd > 0) startSec = prevEnd + rng.int(c.planned?.tags.includes('race') ? 100 : 160, c.planned?.tags.includes('race') ? 260 : 420);
      else {
        startSec = c.at + rng.int(-8 * 60, 18 * 60) + (c.planned?.tags.includes('race') ? 0 : 0);
        if (c.planned?.tags.includes('race')) startSec = c.at + rng.int(0, 90);
        if (prevEnd > 0) startSec = Math.max(startSec, prevEnd + 20 * 60);
      }
      const epoch = localToEpochMs(d, startSec, off);
      const header: Header = { id: activityId(seed, epoch), sport: c.sport, title: c.title, startedAt: isoFromMs(epoch), localDate: d, utcOffsetMin: off };
      if (c.subSport) header.subSport = c.subSport;
      if (c.planned) header.plannedKey = c.planned.key;
      const ctx = modelCtx(seed, history, markers, header);
      const model = buildModel(ctx, header, c.planned);
      pending.push(c.planned ? { header, planned: c.planned, model, ctx } : { header, model, ctx });
      prevEnd = startSec + model.dur;
    }
  }

  // 2) wellness from estimated loads
  const dailyLoad = new Map<LocalDate, number>();
  const vo2Days = new Set<LocalDate>();
  for (const p of pending) {
    dailyLoad.set(p.header.localDate, (dailyLoad.get(p.header.localDate) ?? 0) + p.model.estLoad);
    if (!p.model.indoor && (p.model.family === 'run' || p.model.family === 'bike')) vo2Days.add(p.header.localDate);
  }
  const wellness = buildWellness({ seed, season, profile, history, dailyLoad, vo2Days });
  const wByDate = new Map<LocalDate, WellnessDay>(wellness.map((w) => [w.date, w]));

  // 3) coarse simulation → summaries
  const activities: SynthActivity[] = [];
  const sums: Summary[] = [];
  const pool = new BasePool();
  for (const p of pending) {
    const h = p.header;
    const base = simulate(p.model, p.ctx.thr, hrOffsetFromWellness(wByDate.get(h.localDate), PROFILE_BASE.hrRest), pool);
    const s = summarize(p.model, base, p.ctx.thr);
    const voice = athleteVoice({ model: p.model, sum: s, planned: p.planned, thr: p.ctx.thr, thrNext: p.ctx.thrNext, rng: rngFor(seed, 'voice', h.id) });
    const a: SynthActivity = strip({
      garminActivityId: h.id,
      garminTypeKey: garminTypeKey(h.sport, h.subSport),
      startedAt: h.startedAt,
      utcOffsetMin: h.utcOffsetMin,
      localDate: h.localDate,
      sport: h.sport,
      subSport: h.subSport,
      title: h.title,
      durationSec: s.durationSec,
      movingSec: s.movingSec,
      distanceM: s.distanceM,
      elevationGainM: s.elevationGainM,
      avgHr: s.avgHr,
      maxHr: s.maxHr,
      avgPower: s.avgPower,
      normPower: s.normPower,
      maxPower: s.maxPower,
      avgSpeedMps: s.avgSpeedMps,
      avgCadence: s.avgCadence,
      calories: s.calories,
      aerobicEffect: s.aerobicEffect,
      anaerobicEffect: s.anaerobicEffect,
      poolLengthM: s.poolLengthM,
      strokes: s.strokes,
      avgSwolf: s.avgSwolf,
      totalSets: s.totalSets,
      totalReps: s.totalReps,
      hasGps: p.model.hasGps,
      plannedKey: h.plannedKey,
      ...summaryExtras(p.model, base, s),
    });
    const logged = p.model.isRace || p.model.isTest || p.model.exec.kind !== 'on' || !!p.planned?.isKey || rngFor(seed, 'log', h.id).chance(0.7);
    if (logged) {
      a.rpe = voice.rpe;
      a.feel = voice.feel;
      if (voice.postNote) a.postNote = voice.postNote;
    }
    if (p.planned) p.planned.activityId = h.id;
    activities.push(a);
    sums.push(s);
  }

  raceNotes(season, activities, sums);

  // events: link results
  const events = season.events.map((e) => {
    const legs = activities.filter((a) => a.localDate === e.date && a.plannedKey && plan.find((p) => p.key === a.plannedKey)?.tags.includes('race'));
    const ev = { ...e };
    if (legs.length) ev.resultActivityId = String(legs[legs.length - 1]!.garminActivityId);
    return ev;
  });

  // rest-day markers for planned rest days (no sessions planned)
  const allMarkers = [...markers];
  const covered = (d: LocalDate) => markers.some((m) => d >= m.date && d <= (m.endDate ?? m.date));
  for (const d of eachDay(season.start, season.end)) if (!planByDate.has(d) && !covered(d)) allMarkers.push({ type: 'rest', date: d, label: 'Rest day' });
  allMarkers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    seed,
    today,
    profile,
    thresholdHistory: history,
    activities,
    plan,
    wellness,
    events,
    phases: season.phases,
    markers: allMarkers,
    dayNotes: buildDayNotes(seed, season, plan),
    weekNotes: buildWeekNotes(seed, season, plan, activities),
  };
}

function raceNotes(season: Season, acts: SynthActivity[], sums: Summary[]): void {
  const byDate = (d: LocalDate) => acts.map((a, i) => ({ a, s: sums[i]! })).filter((x) => x.a.localDate === d && x.a.plannedKey);
  const total = (legs: { a: SynthActivity }[]) => {
    const first = legs[0]!.a;
    const last = legs[legs.length - 1]!.a;
    return (Date.parse(last.startedAt) - Date.parse(first.startedAt)) / 1000 + last.durationSec;
  };
  const tri = (d: LocalDate, a: boolean) => {
    const legs = byDate(d).filter((x) => x.a.title.includes('Swim') || x.a.title.includes('Bike') || x.a.title.includes('Run'));
    if (legs.length !== 3) return;
    const [sw, bk, rn] = legs as [(typeof legs)[0], (typeof legs)[0], (typeof legs)[0]];
    const tt = total(legs);
    sw.a.postNote = a ? `Washing-machine start, found feet after 400 m. ${fmtDuration(sw.a.durationSec)} out of the water.` : `Cold lake, short swim. ${fmtDuration(sw.a.durationSec)}. T1 was a mess (wetsuit stuck on the ankle).`;
    bk.a.postNote = a
      ? `NP ${bk.a.normPower} W, stuck to the plan. Ate everything. ${(bk.a.distanceM! / 1000).toFixed(1)} km in ${fmtDuration(bk.a.durationSec)}.`
      : `Went too hard on the hill, NP ${bk.a.normPower}. Worth it.`;
    rn.a.postNote = a
      ? tt < 5 * 3600
        ? `FINISHED ${fmtDuration(tt)}! Run fell apart a bit after 15k but held ${fmtPaceKm(rn.a.avgSpeedMps!)}/km. Sub-5 ✔`
        : `${fmtDuration(tt)}. Missed sub-5 by ${fmtDuration(tt - 5 * 3600)}. The run is where it went. Next year.`
      : `Sprint done in ${fmtDuration(tt)}. Legs on fire the whole 5k. Good sharpener.`;
    for (const l of legs) {
      l.a.rpe = 9;
      l.a.feel = a ? 5 : 4;
    }
  };
  tri(season.aRaceDate, true);
  tri(season.sprintDate, false);
  const tenK = byDate(season.tenKDate).find((x) => x.a.title.includes('10K'));
  if (tenK) {
    const sub40 = tenK.a.durationSec < 2400;
    tenK.a.postNote = sub40
      ? `${fmtDuration(tenK.a.durationSec)} — ${fmtPaceKm(tenK.a.avgSpeedMps!)}/km. SUB-40! Negative split, legs still had a bit.`
      : `${fmtDuration(tenK.a.durationSec)} — ${fmtPaceKm(tenK.a.avgSpeedMps!)}/km. Not sub-40 (headwind on the river section) but way better than last winter.`;
    tenK.a.rpe = 9;
    tenK.a.feel = 4;
  }
}

function buildDayNotes(seed: number, s: Season, plan: SynthPlannedSession[]): { date: LocalDate; body: string }[] {
  const out: { date: LocalDate; body: string }[] = [];
  const add = (date: LocalDate, body: string) => {
    if (date >= s.start && date <= s.end) out.push({ date, body });
  };
  add(s.sick.start, 'Woke up with a fever (38.6). Shut it down.');
  add(addDays(s.sick.start, 2), 'Still in bed. HRV 31. Netflix and soup.');
  add(addDays(s.sick.end, 1), 'First day without a headache. Easy walk only, maybe a spin tomorrow.');
  add(s.travel.start, 'Lisbon for work till Thursday. Packed run shoes, optimistic.');
  add(s.injury.start, 'Left calf tight after Tuesday. No running till it settles — bike & swim only.');
  add(s.vacation.start, 'Núria! Bikes stay home this week.');
  add(addDays(s.aRaceDate, -1), 'Bike racked, bags packed. Legs feel sharp, head less so. Pasta at 19:00, bed at 21:30.');
  add(s.aRaceDate, 'RACE DAY. Alarm 4:45, oats + coffee, go.');
  add(addDays(s.aRaceDate, 1), 'Everything hurts. Worth it.');
  add(addDays(s.bRaceDate, -1), 'Bib pickup 10–14h at the Fira. Shakeout + feet up.');
  add(addDays(s.today, 3), 'Physio 17:00 — get the left calf checked before the HM block.');
  for (const p of plan) if (p.tags.includes('test') && p.date <= s.today) add(p.date, 'Test day. Nervous like it’s a race.');
  const rng = rngFor(seed, 'daynotes');
  for (const d of eachDay(s.start, s.today)) {
    if (rng.chance(0.045)) add(d, rng.pick(RANDOM_DAY_NOTES));
  }
  const seen = new Set<string>();
  return out
    .filter((n) => (seen.has(n.date) ? false : (seen.add(n.date), true)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function planLoad(p: SynthPlannedSession): number {
  const IF: Record<string, number> = { recovery: 0.55, endurance: 0.68, tempo: 0.8, threshold: 0.86, high: 0.87, race: 0.9 };
  if (p.sport === 'strength') return (p.plannedDurationSec / 3600) * 55;
  if (p.sport === 'yoga' || p.sport === 'walk') return (p.plannedDurationSec / 3600) * 22;
  return (p.plannedDurationSec / 3600) * 100 * (IF[p.intensity] ?? 0.7) ** 2;
}

function buildWeekNotes(seed: number, s: Season, plan: SynthPlannedSession[], acts: SynthActivity[]): { isoWeek: string; body: string; targetHours?: number; targetLoad?: number }[] {
  const out: { isoWeek: string; body: string; targetHours?: number; targetLoad?: number }[] = [];
  for (const w of s.weeks) {
    const end = addDays(w.monday, 6);
    const wp = plan.filter((p) => p.date >= w.monday && p.date <= end);
    const wa = acts.filter((a) => a.localDate >= w.monday && a.localDate <= end);
    const past = end < s.today;
    const rng = rngFor(seed, 'weeknote', w.monday);
    const sick = wp.some((p) => p.skipped?.reason === 'sick');
    const travel = wp.some((p) => p.skipped?.reason === 'travel');
    const special = sick || travel || ['race', 'vacation', 'taper', 'post_recovery'].includes(w.block);
    const current = !past && w.monday <= s.today;
    if (past && !special && !rng.chance(0.38)) continue;
    const hoursPlanned = wp.reduce((a, p) => a + p.plannedDurationSec, 0) / 3600;
    const hoursDone = wa.reduce((a, x) => a + x.durationSec, 0) / 3600;
    const keyPlanned = wp.filter((p) => p.isKey).length;
    const keyDone = wp.filter((p) => p.isKey && p.activityId !== undefined).length;
    let body = weekReflection({ rng, block: w.block, recovery: w.recovery, past: past || false, hoursDone, hoursPlanned, keyDone, keyPlanned, sick, travel, rel: w.rel });
    if (w.block === 'race' && past) {
      const legs = wa.filter((x) => x.localDate === s.aRaceDate && x.title.startsWith('Costa Brava'));
      if (legs.length) {
        const tt = (Date.parse(legs[legs.length - 1]!.startedAt) - Date.parse(legs[0]!.startedAt)) / 1000 + legs[legs.length - 1]!.durationSec;
        body = tt < 5 * 3600 ? `RACE WEEK. ${fmtDuration(tt)} — sub-5 in the bag, the season’s work paid off. Now: nothing for a few days.` : `RACE WEEK. ${fmtDuration(tt)}. Not the sub-5, but a proper race. Rest, then rethink the run.`;
      }
    }
    if (!body) continue;
    const note: { isoWeek: string; body: string; targetHours?: number; targetLoad?: number } = { isoWeek: isoWeekOf(w.monday), body: current ? `This week: ${body}` : body };
    if (!past || rng.chance(0.6)) {
      note.targetHours = round(Math.round(hoursPlanned * 2) / 2, 1);
      note.targetLoad = Math.round(wp.reduce((a, p) => a + planLoad(p), 0) / 10) * 10;
    }
    out.push(note);
  }
  return out;
}

// ───────────────────────────── generateActivityDetail ─────────────────────────────

function findActivity(acts: SynthActivity[], id: number): SynthActivity | undefined {
  let lo = 0;
  let hi = acts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = acts[mid]!.garminActivityId;
    if (v === id) return acts[mid];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return acts.find((a) => a.garminActivityId === id);
}

export function generateActivityDetail(athlete: SynthAthlete, garminActivityId: number): SynthActivityDetail {
  const a = findActivity(athlete.activities, garminActivityId);
  if (!a) throw new Error(`synth: unknown activity ${garminActivityId}`);
  const planned = a.plannedKey ? athlete.plan.find((p) => p.key === a.plannedKey) : undefined;
  const h = headerOf(a);
  const ctx = modelCtx(athlete.seed, athlete.thresholdHistory, athlete.markers, h);
  const model = buildModel(ctx, h, planned);
  const w = athlete.wellness.find((x) => x.date === a.localDate);
  const base = simulate(model, ctx.thr, hrOffsetFromWellness(w, PROFILE_BASE.hrRest));
  const r = render(model, base);
  const detail: SynthActivityDetail = { activity: a, laps: r.laps };
  if (r.streams) detail.streams = r.streams;
  const dyn = r.streams ? renderDynamics(model, r.streams.t, r.streams.speed, r.streams.cadence) : undefined;
  if (dyn) detail.dynamics = dyn;
  if (r.strengthSets) detail.strengthSets = r.strengthSets;
  return detail;
}
