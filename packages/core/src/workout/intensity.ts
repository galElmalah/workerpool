/**
 * Intensity classification of planned workouts (product.md §4.3).
 */
import { INTENSITY_META } from '../domain';
import type { IntensityClass, Sport, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { estimateWorkout } from './estimate';
import { ifKind, levelForIF, levelForRpe } from './tables';
import type { Level } from './tables';
import { listSteps } from './structure';

export { levelForIF } from './tables';

const LEVEL_CLASS: Record<Level, IntensityClass> = {
  1: 'recovery',
  2: 'endurance',
  3: 'tempo',
  4: 'threshold',
  5: 'high',
};

/** Class for a level 1–5. */
export function classForLevel(level: Level): IntensityClass {
  return LEVEL_CLASS[level];
}

/** Level 1–5 for a class (race → 5). */
export function levelForClass(c: IntensityClass): Level {
  return INTENSITY_META[c].level;
}

/**
 * Class from a whole-session IF (unstructured plans, or a completed session without zone data).
 * Session IF includes warm-up/cool-down, so the cut-offs are lower than the step-level table:
 *  - bike/row/other (power-like): < 0.62 recovery, < 0.77 endurance, < 0.85 tempo, < 0.95 threshold, else high;
 *  - run (speed fraction): < 0.75, < 0.85, < 0.90, < 0.97;
 *  - swim (CSS fraction): < 0.82, < 0.90, < 0.95, < 1.00.
 */
export function intensityFromIF(intensityFactor: number, sport: Sport = 'bike'): IntensityClass {
  const k = ifKind(sport);
  const cuts = k === 'run' ? [0.75, 0.85, 0.9, 0.97] : k === 'swim' ? [0.82, 0.9, 0.95, 1.0] : [0.62, 0.77, 0.85, 0.95];
  const classes: IntensityClass[] = ['recovery', 'endurance', 'tempo', 'threshold', 'high'];
  for (let i = 0; i < cuts.length; i++) if (intensityFactor < cuts[i]) return classes[i];
  return 'high';
}

/** Minimum cumulative active time (s) at ≥ level for that level to define the workout. */
export const LEVEL_MIN_SEC: Record<3 | 4 | 5, number> = { 5: 4 * 60, 4: 10 * 60, 3: 15 * 60 };
/** Minimum time above recovery (s) for an Endurance classification. */
export const ENDURANCE_MIN_SEC = 45 * 60;

export interface PlannedIntensity {
  intensity: IntensityClass;
  level: Level;
  /** Human explanation, e.g. "Threshold · 32′ at L4+ in active steps". */
  reason: string;
  /** Active-step seconds at ≥ level k (index 0 = ≥ L1 … 4 = ≥ L5). */
  activeSecAtOrAbove: [number, number, number, number, number];
}

/**
 * Planned rule (§4.3): the highest level L among `active` steps whose cumulative time at ≥ L
 * reaches the minimum (High ≥ 4′, Threshold ≥ 10′, Tempo ≥ 15′). Otherwise Endurance when
 * ≥ 45′ of the workout is above Recovery, else Recovery. Strength: from the highest prescribed
 * RPE (default Tempo-equivalent RPE 6 → Tempo). Empty structure → Endurance.
 */
export function classifyPlannedIntensity(structure: WorkoutStructure, sport: Sport, thresholds: ThresholdSnapshot = {}): PlannedIntensity {
  const zero: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  if (!structure.steps.length) return { intensity: 'endurance', level: 2, reason: 'No steps', activeSecAtOrAbove: zero };
  const steps = listSteps(structure).map((s) => s.step);
  if (sport === 'strength' || steps.every((s) => s.strength)) {
    const rpes = steps.map((s) => s.strength?.rpe ?? (s.target?.type === 'rpe' ? s.target.high : undefined)).filter((r): r is number => r !== undefined);
    const rpe = rpes.length ? Math.max(...rpes) : 6;
    const level = levelForRpe(rpe);
    return { intensity: LEVEL_CLASS[level], level, reason: `${INTENSITY_META[LEVEL_CLASS[level]].label} · RPE ${rpe}`, activeSecAtOrAbove: zero };
  }
  const { profile } = estimateWorkout(structure, sport, thresholds);
  const atOrAbove: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let aboveRecovery = 0;
  for (const b of profile) {
    if (b.level >= 2) aboveRecovery += b.durationSec;
    if (b.role !== 'active') continue;
    for (let l = 1; l <= b.level; l++) atOrAbove[l - 1] += b.durationSec;
  }
  for (const l of [5, 4, 3] as const) {
    if (atOrAbove[l - 1] >= LEVEL_MIN_SEC[l]) {
      const c = LEVEL_CLASS[l];
      return { intensity: c, level: l, reason: `${INTENSITY_META[c].label} · ${Math.round(atOrAbove[l - 1] / 60)}′ at L${l}+`, activeSecAtOrAbove: atOrAbove };
    }
  }
  if (aboveRecovery >= ENDURANCE_MIN_SEC)
    return { intensity: 'endurance', level: 2, reason: `Endurance · ${Math.round(aboveRecovery / 60)}′ above recovery`, activeSecAtOrAbove: atOrAbove };
  return { intensity: 'recovery', level: 1, reason: `Recovery · ${Math.round(aboveRecovery / 60)}′ above recovery`, activeSecAtOrAbove: atOrAbove };
}

/** Level of a step-level IF (re-exported from tables for convenience). */
export function levelOf(sport: Sport, intensityFactor: number): Level {
  return levelForIF(sport, intensityFactor);
}
