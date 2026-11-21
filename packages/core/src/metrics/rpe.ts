/**
 * Session-RPE load (metrics.md §2.7) and the duration-only estimate (§2.8).
 */
import type { IntensityClass, Sport } from '../domain';
import { interpTable } from './util';

/** Load points per hour by CR10 RPE 0…10 (§2.7.2; RPE 4 = 50, 6 = 70 anchored, rest UNVERIFIED). */
export const RPE_PPH: readonly number[] = [0, 20, 30, 40, 50, 60, 70, 80, 100, 120, 140];
const RPE_X = RPE_PPH.map((_, i) => i);

/** Points per hour for an RPE (0–10), linearly interpolated for non-integers. */
export function rpePointsPerHour(rpe: number): number {
  if (!Number.isFinite(rpe)) return 0;
  return interpTable(RPE_X, RPE_PPH, rpe);
}

/** Equivalent intensity (IF) of an RPE: √(pph/100). */
export function rpeIntensity(rpe: number): number {
  return Math.sqrt(rpePointsPerHour(rpe) / 100);
}

/** Foster session RPE (AU) = RPE × duration in minutes. */
export function sessionRpe(rpe: number, durationSec: number): number {
  return rpe * (durationSec / 60);
}

/** RPE Load = pph(RPE) × hours × factor (`strengthLoadFactor`, default 1.0). */
export function rpeLoad(rpe: number, durationSec: number, factor = 1): number {
  if (!(durationSec > 0) || !(rpe > 0)) return 0;
  return rpePointsPerHour(rpe) * (durationSec / 3600) * factor;
}

/** Intensity class of an RPE per product.md §4.3 (1–2 recovery … 9–10 high). */
export function rpeIntensityClass(rpe: number): IntensityClass {
  if (rpe >= 9) return 'high';
  if (rpe >= 7) return 'threshold';
  if (rpe >= 5) return 'tempo';
  if (rpe >= 3) return 'endurance';
  return 'recovery';
}

/** Duration-only points per hour by sport (§2.8; ours, UNVERIFIED; ski is ours). */
export const DURATION_PPH: Readonly<Record<Sport, number>> = {
  bike: 50,
  run: 55,
  swim: 50,
  row: 50,
  strength: 40,
  hike: 35,
  walk: 25,
  yoga: 20,
  ski: 50,
  other: 40,
};

/**
 * Multiplier applied to the sport's duration pph when an intensity class is
 * known (ours, UNVERIFIED): the table assumes an easy/endurance session.
 */
export const INTENSITY_CLASS_MULTIPLIER: Readonly<Record<IntensityClass, number>> = {
  recovery: 0.7,
  endurance: 1,
  tempo: 1.3,
  threshold: 1.6,
  high: 1.75,
  race: 1.8,
};

/** Last-resort duration × intensity-class estimate (flag it `estimated`). */
export function durationLoad(sport: Sport, durationSec: number, intensity?: IntensityClass): number {
  if (!(durationSec > 0)) return 0;
  const pph = (DURATION_PPH[sport] ?? 40) * (intensity ? INTENSITY_CLASS_MULTIPLIER[intensity] : 1);
  return pph * (durationSec / 3600);
}

// ───────────────────────────── planned (label-only) ─────────────────────────────

/** Session IF by intensity class for unstructured planned workouts (§2.9.2; UNVERIFIED heuristics). */
export const INTENSITY_CLASS_IF: Readonly<Record<Exclude<IntensityClass, 'race'>, number>> = {
  recovery: 0.55,
  endurance: 0.68,
  tempo: 0.8,
  threshold: 0.88,
  high: 0.87,
};

/** Race IF heuristic: clamp((1/h)^0.10, 0.70, 1.05). */
export function raceIntensity(durationSec: number): number {
  const h = durationSec / 3600;
  if (!(h > 0)) return 1.05;
  return Math.max(0.7, Math.min(1.05, (1 / h) ** 0.1));
}

/** Planned Load from duration and intensity class: hours × 100 × IF² (§2.9.2). */
export function plannedLoadFromIntensity(durationSec: number, intensity: IntensityClass): number {
  if (!(durationSec > 0)) return 0;
  const IF = intensity === 'race' ? raceIntensity(durationSec) : INTENSITY_CLASS_IF[intensity];
  return (durationSec / 3600) * 100 * IF * IF;
}
