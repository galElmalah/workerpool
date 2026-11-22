/**
 * Weekly aggregation (metrics.md §6.11, product.md §3.2, §3.6.3) and
 * consistency / streak / rolling-average helpers.
 *
 * Rules:
 *  - Planned = all planned workouts in the week (incl. paired and skipped: the plan of record).
 *  - Done = all activities (paired + unplanned). Time = moving time (elapsed if 0).
 *  - Projected = done + planned workouts dated ≥ today that are unpaired and not skipped.
 *  - WoW deltas compare with the previous ISO week computed from the same inputs;
 *    pass one extra prior week of workouts/activities, otherwise the delta is null.
 */
import type {
  Activity,
  FitnessDay,
  LocalDate,
  Phase,
  PlannedWorkout,
  Sport,
  SportTotals,
  WeekNote,
  WeekSummary,
} from '../domain';
import { INTENSITY_META, SPORTS } from '../domain';
import type { IntensityClass } from '../domain';
import type { ThreeZoneSeconds } from './zones';
import { addDays, diffDays, eachWeek, isoWeekStart, weekStart } from '../time';

export interface BuildWeeksInput {
  workouts: readonly PlannedWorkout[];
  activities: readonly Activity[];
  fitness: readonly FitnessDay[];
  weekNotes?: readonly WeekNote[];
  phases?: readonly Phase[];
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  /** Stored three-bucket zone seconds per activity id (activities without them use their class). */
  zoneSeconds?: ReadonlyMap<string, ThreeZoneSeconds>;
}

/**
 * Time by intensity bucket for ONE activity — the single definition shared by week summaries and
 * the intensity trend: the activity's stored three-bucket zone seconds when present (and non-zero),
 * otherwise all of its time in the bucket of its intensity class.
 */
export function activityIntensitySplit(sec: number, cls: IntensityClass | null | undefined, three?: ThreeZoneSeconds | null): ThreeZoneSeconds {
  if (three && three.easy + three.moderate + three.hard > 0) return { easy: three.easy, moderate: three.moderate, hard: three.hard };
  const bucket = cls && INTENSITY_META[cls] ? INTENSITY_META[cls].bucket : 'easy';
  return { easy: 0, moderate: 0, hard: 0, [bucket]: sec };
}

const activitySec = (a: Activity) => (a.movingSec > 0 ? a.movingSec : a.durationSec) || 0;

interface WeekBucket {
  workouts: PlannedWorkout[];
  activities: Activity[];
}

function emptyTotals(sport: Sport): SportTotals {
  return {
    sport,
    plannedSec: 0,
    doneSec: 0,
    plannedLoad: 0,
    doneLoad: 0,
    plannedDistanceM: 0,
    doneDistanceM: 0,
    plannedCount: 0,
    doneCount: 0,
    elevationGainM: 0,
  };
}

/** Clamped (≤ 1) compliance ratio of a paired planned workout (load → duration → distance). */
export function complianceRatio(w: PlannedWorkout, a: Activity | undefined): number {
  if (!a) return 0;
  let r: number | undefined = w.compliance?.ratio;
  if (r === undefined) {
    if ((w.plannedLoad ?? 0) > 0 && a.load > 0) r = a.load / w.plannedLoad!;
    else if ((w.plannedDurationSec ?? 0) > 0) r = activitySec(a) / w.plannedDurationSec!;
    else if ((w.plannedDistanceM ?? 0) > 0 && (a.distanceM ?? 0) > 0) r = a.distanceM! / w.plannedDistanceM!;
    else r = 1;
  }
  return Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
}

const wow = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

/** Week summaries for every ISO week touching [from, to]. */
export function buildWeekSummaries(input: BuildWeeksInput): WeekSummary[] {
  const { from, to, today } = input;
  if (to < from) return [];
  const buckets = new Map<LocalDate, WeekBucket>();
  const bucket = (d: LocalDate) => {
    const k = weekStart(d);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { workouts: [], activities: [] }));
    return b;
  };
  for (const w of input.workouts) bucket(w.date).workouts.push(w);
  for (const a of input.activities) bucket(a.localDate).activities.push(a);

  const actById = new Map(input.activities.map((a) => [a.id, a] as const));
  const actByWorkout = new Map<string, Activity>();
  for (const a of input.activities) if (a.pairedWorkoutId) actByWorkout.set(a.pairedWorkoutId, a);
  const pairedOf = (w: PlannedWorkout): Activity | undefined =>
    (w.pairedActivityId ? actById.get(w.pairedActivityId) : undefined) ?? actByWorkout.get(w.id);

  const fitByDate = new Map(input.fitness.map((f) => [f.date, f] as const));
  const sortedFit = [...input.fitness].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const fitAt = (d: LocalDate): FitnessDay | undefined => {
    const exact = fitByDate.get(d);
    if (exact) return exact;
    let best: FitnessDay | undefined;
    for (const f of sortedFit) {
      if (f.date > d) break;
      best = f;
    }
    return best;
  };
  const notes = new Map((input.weekNotes ?? []).map((n) => [n.isoWeek, n] as const));

  const doneTotals = (start: LocalDate) => {
    const b = buckets.get(start);
    let sec = 0;
    let load = 0;
    let dist = 0;
    for (const a of b?.activities ?? []) {
      sec += activitySec(a);
      load += a.load || 0;
      dist += a.distanceM ?? 0;
    }
    return { sec, load, dist };
  };

  const out: WeekSummary[] = [];
  for (const isoWeek of eachWeek(from, to)) {
    const start = isoWeekStart(isoWeek);
    const end = addDays(start, 6);
    const b = buckets.get(start) ?? { workouts: [], activities: [] };
    const bySport = new Map<Sport, SportTotals>();
    const st = (s: Sport) => {
      let t = bySport.get(s);
      if (!t) bySport.set(s, (t = emptyTotals(s)));
      return t;
    };
    let plannedSec = 0;
    let plannedLoad = 0;
    let plannedDistanceM = 0;
    let remainSec = 0;
    let remainLoad = 0;
    let keyPlanned = 0;
    let keyDone = 0;
    let compSum = 0;
    let compN = 0;
    for (const w of b.workouts) {
      const sec = w.plannedDurationSec ?? 0;
      const load = w.plannedLoad ?? 0;
      const dist = w.plannedDistanceM ?? 0;
      plannedSec += sec;
      plannedLoad += load;
      plannedDistanceM += dist;
      const t = st(w.sport);
      t.plannedSec += sec;
      t.plannedLoad += load;
      t.plannedDistanceM += dist;
      t.plannedCount++;
      const paired = pairedOf(w);
      if (w.isKey) {
        keyPlanned++;
        if (paired) keyDone++;
      }
      if (!paired && w.status === 'planned' && w.date >= today) {
        remainSec += sec;
        remainLoad += load;
      }
      if (w.date < today && w.status !== 'skipped') {
        compSum += complianceRatio(w, paired);
        compN++;
      }
    }
    let doneSec = 0;
    let doneLoad = 0;
    let doneDistanceM = 0;
    let elevationGainM = 0;
    const intensitySec = { easy: 0, moderate: 0, hard: 0 };
    const dailyLoad = [0, 0, 0, 0, 0, 0, 0];
    for (const a of b.activities) {
      const sec = activitySec(a);
      doneSec += sec;
      doneLoad += a.load || 0;
      doneDistanceM += a.distanceM ?? 0;
      elevationGainM += a.elevationGainM ?? 0;
      const t = st(a.sport);
      t.doneSec += sec;
      t.doneLoad += a.load || 0;
      t.doneDistanceM += a.distanceM ?? 0;
      t.doneCount++;
      t.elevationGainM += a.elevationGainM ?? 0;
      const split = activityIntensitySplit(sec, a.intensity ?? a.intensityOverride ?? a.intensityAuto, input.zoneSeconds?.get(a.id));
      intensitySec.easy += split.easy;
      intensitySec.moderate += split.moderate;
      intensitySec.hard += split.hard;
      const di = diffDays(start, a.localDate);
      if (di >= 0 && di < 7) dailyLoad[di] += a.load || 0;
    }
    const prev = doneTotals(addDays(start, -7));
    const fEnd = fitAt(end);
    const fPrev = fitAt(addDays(end, -7));
    const note = notes.get(isoWeek);
    const phase = (input.phases ?? []).find((p) => p.startDate <= end && p.endDate >= start);
    const summary: WeekSummary = {
      isoWeek,
      startDate: start,
      endDate: end,
      plannedSec,
      doneSec,
      plannedLoad,
      doneLoad,
      plannedDistanceM,
      doneDistanceM,
      elevationGainM,
      projectedSec: doneSec + remainSec,
      projectedLoad: doneLoad + remainLoad,
      bySport: SPORTS.filter((s) => bySport.has(s)).map((s) => bySport.get(s)!),
      keyPlanned,
      keyDone,
      intensitySec,
      compliancePct: compN ? (100 * compSum) / compN : null,
      fitness: fEnd?.fitness ?? 0,
      fatigue: fEnd?.fatigue ?? 0,
      form: fEnd?.form ?? 0,
      formPct: fEnd?.formPct ?? null,
      formZone: fEnd?.formZone ?? null,
      fitnessDelta: fEnd && fPrev ? fEnd.fitness - fPrev.fitness : 0,
      wowSec: wow(doneSec, prev.sec),
      wowLoad: wow(doneLoad, prev.load),
      wowDistanceM: wow(doneDistanceM, prev.dist),
      isProjected: end > today,
      hasNote: !!note && note.body.trim().length > 0,
      dailyLoad,
    };
    const targetHours = note?.targetHours;
    const targetLoad = note?.targetLoad ?? phase?.weeklyLoadTarget;
    if (targetHours !== undefined) summary.targetHours = targetHours;
    if (targetLoad !== undefined) summary.targetLoad = targetLoad;
    if (phase) summary.phaseId = phase.id;
    out.push(summary);
  }
  return out;
}

// ───────────────────────────── helpers ─────────────────────────────

/**
 * Trailing rolling average over `window` values; entries with fewer than
 * `minPeriods` (default `window`) finite values are null.
 */
export function rollingAverage(values: ReadonlyArray<number | null | undefined>, window: number, minPeriods = window): Array<number | null> {
  const out: Array<number | null> = [];
  let s = 0;
  let c = 0;
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (ok(v)) {
      s += v;
      c++;
    }
    if (i >= window) {
      const o = values[i - window];
      if (ok(o)) {
        s -= o;
        c--;
      }
    }
    out.push(c >= minPeriods && c > 0 ? s / c : null);
  }
  return out;
}

/**
 * Day streaks over dates with training. The current streak counts back from today,
 * or from yesterday when today has no activity yet (the day is not over).
 */
export function dayStreak(activeDates: Iterable<LocalDate>, today: LocalDate): { current: number; longest: number } {
  const set = new Set(activeDates);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: LocalDate | null = null;
  for (const d of sorted) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  let current = 0;
  let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  return { current, longest };
}

/**
 * Consecutive weeks (newest first, skipping a still-running current week that
 * fails) satisfying `pred` (default: any training done).
 */
export function weekStreak(weeks: readonly WeekSummary[], today: LocalDate, pred: (w: WeekSummary) => boolean = (w) => w.doneSec > 0): number {
  const sorted = [...weeks].filter((w) => w.startDate <= today).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (pred(w)) n++;
    else if (i === 0 && w.endDate >= today) continue;
    else break;
  }
  return n;
}

/**
 * Consistency: share (0..1) of completed weeks with a plan where done time
 * reached `minRatio` (default 0.8) of planned time. Null when no such week.
 */
export function weeklyConsistency(weeks: readonly WeekSummary[], minRatio = 0.8): number | null {
  const eligible = weeks.filter((w) => !w.isProjected && w.plannedSec > 0);
  if (!eligible.length) return null;
  return eligible.filter((w) => w.doneSec >= minRatio * w.plannedSec).length / eligible.length;
}
