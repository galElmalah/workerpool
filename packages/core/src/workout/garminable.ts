/**
 * Can a planned workout be pushed to Garmin Connect as a structured workout?
 * Facts from docs/research/garmin.md §5: workout sport types are running, cycling, other,
 * swimming, strength_training, cardio_training, yoga, pilates, hiit, multi_sport, mobility.
 * There is no rowing, walking or hiking workout type; nested repeats are unverified (we unroll);
 * targets are power / cadence / HR / speed / pace (plus a swim CSS-offset secondary) — no RPE.
 */
import type { Sport, SubSport, Target, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { MAX_UNROLLED_STEPS, countUnrolledSteps, listSteps, structureDepth } from './structure';

export type GarminSportTypeKey =
  | 'running'
  | 'cycling'
  | 'other'
  | 'swimming'
  | 'strength_training'
  | 'cardio_training'
  | 'yoga'
  | 'pilates'
  | 'hiit'
  | 'multi_sport'
  | 'mobility';

export interface GarminSupport {
  pushable: boolean;
  /** Garmin workout sport type the workout is pushed as. */
  sportTypeKey: GarminSportTypeKey;
  warnings: string[];
}

/** Garmin workout sport type for one of our sports. */
export function garminSportType(sport: Sport, subSport?: SubSport): GarminSportTypeKey {
  switch (sport) {
    case 'run':
      return 'running';
    case 'bike':
      return 'cycling';
    case 'swim':
      return 'swimming';
    case 'strength':
      return subSport === 'mobility' ? 'mobility' : subSport === 'hiit' ? 'hiit' : 'strength_training';
    case 'yoga':
      return 'yoga';
    case 'row':
      return 'cardio_training';
    default:
      return 'other';
  }
}

function needs(t: Target, sport: Sport, th: ThresholdSnapshot | undefined): string | undefined {
  if (!th) return undefined;
  const powerThr = sport === 'row' ? th.rowThresholdW : th.ftp;
  if ((t.type === 'power_pct' || (t.type === 'ramp' && t.basis === 'power_pct')) && !powerThr)
    return `% power targets need ${sport === 'row' ? 'a rowing threshold' : 'an FTP'} to convert to watts`;
  if ((t.type === 'hr_pct_lthr' || (t.type === 'ramp' && t.basis === 'hr_pct_lthr')) && !th.lthr) return '%LTHR targets need an LTHR to convert to bpm';
  if (t.type === 'pace_pct' || (t.type === 'ramp' && t.basis === 'pace_pct')) {
    // Rowing pace comes from the rowing threshold power (Concept2: P = 2.80 · v³); walk/hike use the run threshold.
    const thr =
      sport === 'swim' ? th.swimCssMps : sport === 'row' ? th.rowThresholdW : sport === 'run' || sport === 'walk' || sport === 'hike' ? th.runThresholdMps : undefined;
    if (!thr) return sport === 'row' ? '% pace targets need a rowing threshold to convert' : '% pace targets need a threshold pace to convert';
  }
  return undefined;
}

/**
 * Push support and warnings for a workout.
 *  - No structure: pushable only with `opts.pushUnstructured` (sent as a single open step).
 *  - Rowing → cardio_training, hiking/walking/ski/other → other, with step notes.
 *  - Warnings: open-water swim, RPE targets (sent as no-target + note), ramps (sent as ranges),
 *    nested repeats (unrolled), > 50 unrolled steps (older devices), relative targets without
 *    the threshold needed to convert them (when `opts.thresholds` is given), swim power targets.
 */
export function garminSupport(
  sport: Sport,
  structure: WorkoutStructure | undefined,
  opts: { subSport?: SubSport; pushUnstructured?: boolean; thresholds?: ThresholdSnapshot } = {},
): GarminSupport {
  const sportTypeKey = garminSportType(sport, opts.subSport);
  const warnings: string[] = [];
  if (sport === 'row') warnings.push('Garmin has no rowing workout type; it is sent as Cardio with step notes.');
  if (sport === 'hike' || sport === 'walk' || sport === 'ski' || sport === 'other')
    warnings.push(`Garmin has no ${sport === 'other' ? 'matching' : sport} workout type; it is sent as Other.`);
  if (sport === 'swim' && opts.subSport === 'open_water') warnings.push('Garmin structured swim workouts are pool workouts; open-water steps may not display as intended.');

  if (!structure || !structure.steps.length) {
    if (!opts.pushUnstructured) warnings.push('Unstructured workout: enable “push unstructured” to send it as a single open step.');
    return { pushable: !!opts.pushUnstructured, sportTypeKey, warnings };
  }
  const steps = listSteps(structure).map((s) => s.step);
  const once = new Set<string>();
  const warnOnce = (msg: string) => {
    if (!once.has(msg)) {
      once.add(msg);
      warnings.push(msg);
    }
  };
  for (const s of steps) {
    for (const t of [s.target, s.secondary]) {
      if (!t) continue;
      if (t.type === 'rpe') warnOnce('Garmin has no RPE target; RPE steps are sent without a target and the RPE in the step note.');
      if (t.type === 'ramp') warnOnce('Ramps are sent as a low–high range (Garmin has no ramp target).');
      if (sport === 'swim' && (t.type === 'power_pct' || t.type === 'power_w')) warnOnce('Swim power targets are not supported and are dropped.');
      const n = needs(t, sport, opts.thresholds);
      if (n) warnOnce(n);
    }
    if (s.strength && sport !== 'strength') warnOnce('Exercises in a non-strength workout are sent as plain steps.');
  }
  if (structureDepth(structure) >= 2) warnings.push('Nested repeats are expanded into a single repeat level for Garmin.');
  const n = countUnrolledSteps(structure);
  if (n > MAX_UNROLLED_STEPS) warnings.push(`${n} steps when expanded; older Garmin devices accept at most ${MAX_UNROLLED_STEPS}.`);
  return { pushable: true, sportTypeKey, warnings };
}
