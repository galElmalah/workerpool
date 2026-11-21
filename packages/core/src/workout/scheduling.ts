/**
 * Pure helpers for calendar bulk operations: copy week (with progression), shift plan,
 * repeat weekly, and structure scaling.
 */
import type { IsoInstant, LocalDate, PlannedWorkout, Sport, StepRole, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { addDays, diffDays } from '../time';
import { derivePlannedTotals, estimateWorkout, profileSparkline } from './estimate';
import { mapSteps, newId as defaultNewId, reassignIds } from './structure';
import { autoTitle, autoTitleUnstructured } from './title';

/** Round a step duration (s) to a tidy value: 5 s < 1′, 15 s < 5′, 30 s < 20′, else 1′. */
export function tidyStepSeconds(sec: number): number {
  const q = sec < 60 ? 5 : sec < 300 ? 15 : sec < 1200 ? 30 : 60;
  return Math.max(q, Math.round(sec / q) * q);
}

/** Round a step distance (m) to a tidy value: 5 m < 100 m, 25 m < 1 km, 50 m < 5 km, else 100 m. */
export function tidyStepMeters(m: number): number {
  const q = m < 100 ? 5 : m < 1000 ? 25 : m < 5000 ? 50 : 100;
  return Math.max(q, Math.round(m / q) * q);
}

/** Round a planned total duration (s): 1′ under 30′, else 5′. */
export function tidyTotalSeconds(sec: number): number {
  const q = sec < 1800 ? 60 : 300;
  return Math.max(0, Math.round(sec / q) * q);
}

/** Round a planned total distance (m): swim 100 m; others 100 m under 5 km, else 500 m. */
export function tidyTotalMeters(m: number, sport: Sport): number {
  const q = sport === 'swim' || m < 5000 ? 100 : 500;
  return Math.max(0, Math.round(m / q) * q);
}

/**
 * Scale the time/distance of steps with the given roles (default: active steps only, so
 * warm-ups, recoveries and cool-downs keep their length) by `factor`, rounding to tidy values.
 * Repeat counts and strength prescriptions are unchanged. Ids are preserved. factor 1 → same object.
 */
export function scaleStructure(structure: WorkoutStructure, factor: number, opts: { roles?: readonly StepRole[] } = {}): WorkoutStructure {
  if (!(factor > 0) || factor === 1) return structure;
  const roles = opts.roles ?? ['active'];
  return mapSteps(structure, (s) => {
    if (!roles.includes(s.role) || s.strength) return s;
    if (s.measure.type === 'time') return { ...s, measure: { type: 'time', sec: tidyStepSeconds(s.measure.sec * factor) } };
    if (s.measure.type === 'distance') return { ...s, measure: { type: 'distance', m: tidyStepMeters(s.measure.m * factor) } };
    return s;
  });
}

export interface CopyOptions {
  /** Progression in % (−40 … +20 in the UI); scales active steps / unstructured totals. */
  progressionPct?: number;
  /** Keep pre-notes (default true). */
  includeNotes?: boolean;
  /** Keep key flags (default true). */
  includeKey?: boolean;
  /** When given, planned totals of structured copies are recomputed exactly. */
  thresholds?: ThresholdSnapshot;
  /** Timestamp for createdAt/updatedAt (default: now). */
  now?: IsoInstant;
  /** Id factory (default: newId('w')). */
  newId?: () => string;
}

/** Copy one workout to `date`, scaled by `factor`, with pairing / Garmin / skip state reset. */
export function copyWorkout(w: PlannedWorkout, date: LocalDate, factor = 1, opts: CopyOptions = {}): PlannedWorkout {
  const now = opts.now ?? new Date().toISOString();
  const id = (opts.newId ?? (() => defaultNewId('w')))();
  const next: PlannedWorkout = {
    ...w,
    id,
    date,
    status: 'planned',
    garmin: { syncState: 'none' },
    isKey: opts.includeKey === false ? false : w.isKey,
    tags: [...w.tags],
    createdAt: now,
    updatedAt: now,
  };
  delete next.pairedActivityId;
  delete next.compliance;
  delete next.skipReason;
  delete next.seriesId;
  delete next.eventId;
  if (opts.includeNotes === false) delete next.preNote;

  if (w.structure) {
    const scaled = scaleStructure(w.structure, factor);
    next.structure = reassignIds(scaled);
    if (opts.thresholds) {
      const t = derivePlannedTotals({ sport: w.sport, intensity: w.intensity, structure: next.structure }, opts.thresholds);
      next.plannedDurationSec = t.plannedDurationSec;
      if (t.plannedDistanceM !== undefined) next.plannedDistanceM = t.plannedDistanceM;
      next.plannedLoad = t.plannedLoad;
      next.plannedIntensityFactor = t.plannedIntensityFactor;
    } else if (factor !== 1) {
      const a = estimateWorkout(w.structure, w.sport, {});
      const b = estimateWorkout(scaled, w.sport, {});
      const ratio = (x: number, y: number) => (x > 0 ? y / x : 1);
      if (w.plannedDurationSec !== undefined) next.plannedDurationSec = Math.round(w.plannedDurationSec * ratio(a.durationSec, b.durationSec));
      if (w.plannedDistanceM !== undefined) next.plannedDistanceM = Math.round(w.plannedDistanceM * ratio(a.distanceM ?? 0, b.distanceM ?? 0));
      if (w.plannedLoad !== undefined) next.plannedLoad = Math.round(w.plannedLoad * ratio(a.load, b.load) * 10) / 10;
    }
    if (factor !== 1 && w.title === autoTitle(w.structure, w.sport)) next.title = autoTitle(next.structure, w.sport);
    // derived card sparkline (if the domain carries one) follows the scaled structure
    const withSpark = next as PlannedWorkout & { sparkline?: number[] };
    if (withSpark.sparkline !== undefined) withSpark.sparkline = profileSparkline(next.structure, w.sport, opts.thresholds ?? {});
  } else if (factor !== 1) {
    const oldTitle = autoTitleUnstructured({ sport: w.sport, durationSec: w.plannedDurationSec, distanceM: w.plannedDistanceM, intensity: w.intensity });
    if (w.plannedDurationSec !== undefined) next.plannedDurationSec = tidyTotalSeconds(w.plannedDurationSec * factor);
    if (w.plannedDistanceM !== undefined) next.plannedDistanceM = tidyTotalMeters(w.plannedDistanceM * factor, w.sport);
    if (w.plannedLoad !== undefined) next.plannedLoad = Math.round(w.plannedLoad * factor);
    if (w.title === oldTitle)
      next.title = autoTitleUnstructured({ sport: w.sport, durationSec: next.plannedDurationSec, distanceM: next.plannedDistanceM, intensity: w.intensity });
  }
  return next;
}

/**
 * Copy the workouts of the week starting `fromWeekStart` (Mon, inclusive, 7 days) onto the week
 * starting `toWeekStart`, keeping weekdays. Returns only the new copies (new ids), scaled by
 * `progressionPct`, with pairing, compliance, skip, series and Garmin state reset.
 */
export function copyWeek(
  workouts: readonly PlannedWorkout[],
  fromWeekStart: LocalDate,
  toWeekStart: LocalDate,
  opts: CopyOptions = {},
): PlannedWorkout[] {
  const end = addDays(fromWeekStart, 6);
  const offset = diffDays(fromWeekStart, toWeekStart);
  const factor = 1 + (opts.progressionPct ?? 0) / 100;
  return workouts
    .filter((w) => w.date >= fromWeekStart && w.date <= end)
    .map((w) => copyWorkout(w, addDays(w.date, offset), factor, opts));
}

/**
 * Shift plan: every planned workout dated ≥ `fromDate` moves by `days` (±). Workouts already
 * paired to an activity (completed) never move. Moved workouts known to Garmin get
 * `syncState: 'pending'` so they are re-scheduled. Returns a new array in the same order.
 */
export function shiftWorkouts(workouts: readonly PlannedWorkout[], fromDate: LocalDate, days: number, opts: { now?: IsoInstant } = {}): PlannedWorkout[] {
  if (!days) return workouts.slice();
  const now = opts.now ?? new Date().toISOString();
  return workouts.map((w) => {
    if (w.date < fromDate || w.pairedActivityId) return w;
    const onGarmin = !!(w.garmin.workoutId || w.garmin.scheduleId) || w.garmin.syncState === 'synced';
    return {
      ...w,
      date: addDays(w.date, days),
      updatedAt: now,
      garmin: onGarmin ? { ...w.garmin, syncState: 'pending' } : w.garmin,
    };
  });
}

/**
 * "Repeat every week for `count` weeks": returns `count` workouts — the original (with a
 * series id set) followed by `count − 1` weekly copies, each compounding `progressionPct`.
 */
export function repeatWeekly(
  workout: PlannedWorkout,
  count: number,
  opts: CopyOptions & { seriesId?: string } = {},
): PlannedWorkout[] {
  const seriesId = opts.seriesId ?? workout.seriesId ?? defaultNewId('series');
  const out: PlannedWorkout[] = [{ ...workout, seriesId }];
  const step = 1 + (opts.progressionPct ?? 0) / 100;
  for (let k = 1; k < Math.max(1, Math.floor(count)); k++) {
    const c = copyWorkout(workout, addDays(workout.date, 7 * k), Math.pow(step, k), opts);
    out.push({ ...c, seriesId });
  }
  return out;
}
