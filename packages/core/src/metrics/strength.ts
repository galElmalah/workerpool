/**
 * Strength metrics (metrics.md §2.7.3), kept separate from Load.
 */
import type { StrengthSet } from '../domain';

/** Epley 1RM estimate (kg); r = 1 returns w. */
export function e1rmEpley(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Brzycki 1RM estimate (kg), valid for r < 37 (null otherwise). */
export function e1rmBrzycki(weightKg: number, reps: number): number | null {
  if (reps >= 37) return null;
  return reps <= 1 ? weightKg : (weightKg * 36) / (37 - reps);
}

/** Default e1RM: Epley for 1 ≤ r ≤ 12, nothing above 12 reps or without load. */
export function estimate1RM(weightKg: number | undefined, reps: number | undefined): number | null {
  if (!(weightKg && weightKg > 0) || !(reps && reps >= 1) || reps > 12) return null;
  return e1rmEpley(weightKg, reps);
}

/** A set with an optional repeat count (`sets`, default 1). */
export interface VolumeSet {
  reps?: number;
  weightKg?: number;
  sets?: number;
  isRest?: boolean;
}

/** Volume load (kg) = Σ sets × reps × weight. Rest entries and unloaded sets contribute 0. */
export function volumeLoad(sets: readonly VolumeSet[]): number {
  let v = 0;
  for (const s of sets) {
    if (s.isRest) continue;
    const r = s.reps ?? 0;
    const w = s.weightKg ?? 0;
    if (r > 0 && w > 0) v += (s.sets ?? 1) * r * w;
  }
  return v;
}

/** Best e1RM per exercise name across sets (kg). */
export function bestE1rmByExercise(sets: readonly StrengthSet[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sets) {
    if (s.isRest) continue;
    const e = estimate1RM(s.weightKg, s.reps);
    if (e === null) continue;
    const cur = out.get(s.exercise);
    if (cur === undefined || e > cur) out.set(s.exercise, e);
  }
  return out;
}
