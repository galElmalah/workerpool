/**
 * Rowing (metrics.md §2.5): Concept2 pace ↔ watts conversions and threshold
 * helpers. The formula is erg-specific; it does not hold for boats on water.
 */
import type { NumSeries } from './util';

/** Concept2 constant: P = 2.80 / pace³ with pace in s/m. */
export const C2_K = 2.8;

/** Watts from a Concept2 split (s per 500 m). */
export function c2SplitToWatts(splitSecPer500: number): number | null {
  if (!(splitSecPer500 > 0)) return null;
  return C2_K / (splitSecPer500 / 500) ** 3;
}

/** Concept2 split (s per 500 m) from watts. */
export function c2WattsToSplit(watts: number): number | null {
  if (!(watts > 0)) return null;
  return 500 * (C2_K / watts) ** (1 / 3);
}

/** Watts from boat speed (m/s) on a Concept2 erg: 2.80 · v³. */
export function c2SpeedToWatts(speedMps: number): number {
  return speedMps > 0 ? C2_K * speedMps ** 3 : 0;
}

/**
 * Per-second erg power (W) from a speed series — convert each sample *before*
 * any averaging/normalization (§2.5). Missing speed → NaN.
 */
export function ergPowerFromSpeed(speed: NumSeries): Float64Array {
  const out = new Float64Array(speed.length);
  for (let i = 0; i < speed.length; i++) {
    const v = speed[i];
    out[i] = typeof v === 'number' && Number.isFinite(v) ? c2SpeedToWatts(v) : NaN;
  }
  return out;
}

/** Average 2 k power (W) from a 2000 m erg time (s). */
export function p2kFromTime(timeSec: number): number | null {
  return timeSec > 0 ? c2SplitToWatts(timeSec / 4) : null;
}

/** Default rowing threshold from 2 k power: 0.75 × P2k (UNVERIFIED heuristic, §2.5). */
export function rowThresholdFromP2k(p2kW: number): number {
  return 0.75 * p2kW;
}
