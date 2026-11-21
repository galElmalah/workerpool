/**
 * Zone models (metrics.md §3) and intensity classification (product.md §4.3).
 *
 * A zone model is an ascending list of lower bounds as fractions of a threshold;
 * zone k covers [b_k, b_{k+1}), the top zone is open. Samples are classified on
 * raw values (no rounding).
 */
import type { IntensityClass, ZoneTime } from '../domain';
import { INTENSITY_META } from '../domain';
import { rpeIntensityClass } from './rpe';
import type { NumSeries } from './util';

export type ZoneBasis = 'ftp' | 'lthr' | 'hrMax' | 'thresholdSpeed' | 'css' | 'rowThreshold';

export interface ZoneModel {
  id: string;
  /** Which threshold the fractions multiply. */
  basis: ZoneBasis;
  /** Native unit of resolved bounds. */
  unit: 'W' | 'bpm' | 'mps';
  /** Short labels, e.g. Z1…Z5c. */
  labels: readonly string[];
  names: readonly string[];
  /** Lower bounds as fractions of the threshold; first is 0. */
  bounds: readonly number[];
}

const z = (n: number) => Array.from({ length: n }, (_, i) => `Z${i + 1}`);
const FRIEL_LABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5a', 'Z5b', 'Z5c'];
const FRIEL_NAMES = ['Recovery', 'Aerobic', 'Tempo', 'Sub-threshold', 'Super-threshold', 'Aerobic capacity', 'Anaerobic capacity'];
const SKIBA6 = ['Active Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic'];

/** Coggan 7 levels, % FTP (§3.2). Also used for run power and erg power by %FTP. */
export const POWER_ZONES_COGGAN: ZoneModel = {
  id: 'power-coggan-7',
  basis: 'ftp',
  unit: 'W',
  labels: z(7),
  names: ['Active Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Neuromuscular'],
  bounds: [0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5],
};

/** Friel 7-zone HR, bike table, % LTHR (§3.1). */
export const HR_ZONES_FRIEL_BIKE: ZoneModel = {
  id: 'hr-friel-bike',
  basis: 'lthr',
  unit: 'bpm',
  labels: FRIEL_LABELS,
  names: FRIEL_NAMES,
  bounds: [0, 0.81, 0.9, 0.94, 1.0, 1.03, 1.07],
};

/** Friel 7-zone HR, run table, % LTHR (§3.1). Also used for swim/row/other sports. */
export const HR_ZONES_FRIEL_RUN: ZoneModel = {
  id: 'hr-friel-run',
  basis: 'lthr',
  unit: 'bpm',
  labels: FRIEL_LABELS,
  names: FRIEL_NAMES,
  bounds: [0, 0.85, 0.9, 0.95, 1.0, 1.03, 1.07],
};

/** Coggan 5-zone HR, % LTHR (§3.1). */
export const HR_ZONES_COGGAN: ZoneModel = {
  id: 'hr-coggan-5',
  basis: 'lthr',
  unit: 'bpm',
  labels: z(5),
  names: ['Active Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max'],
  bounds: [0, 0.69, 0.84, 0.95, 1.06],
};

/** 5-zone % HRmax fallback when no LTHR is known (§3.1). Z1 absorbs everything below 60 %. */
export const HR_ZONES_PCT_MAX: ZoneModel = {
  id: 'hr-pct-max-5',
  basis: 'hrMax',
  unit: 'bpm',
  labels: z(5),
  names: ['Very light', 'Light', 'Moderate', 'Hard', 'Maximum'],
  bounds: [0, 0.6, 0.7, 0.8, 0.9],
};

/** Friel 7-zone run pace as speed fractions of threshold speed (§3.3); a boundary belongs to the faster zone. */
export const PACE_ZONES_FRIEL: ZoneModel = {
  id: 'pace-friel-7',
  basis: 'thresholdSpeed',
  unit: 'mps',
  labels: FRIEL_LABELS,
  names: ['Recovery', 'Aerobic', 'Tempo', 'Sub-threshold', 'Super-threshold', 'Aerobic capacity', 'Anaerobic capacity'],
  bounds: [0, 1 / 1.29, 1 / 1.14, 1 / 1.06, 1, 1 / 0.97, 1 / 0.9],
};

/** Skiba 6-zone run pace, % critical speed (§3.3 alternative). */
export const PACE_ZONES_SKIBA: ZoneModel = {
  id: 'pace-skiba-6',
  basis: 'thresholdSpeed',
  unit: 'mps',
  labels: z(6),
  names: SKIBA6,
  bounds: [0, 0.8, 0.87, 0.95, 1.05, 1.19],
};

/** Skiba 6-zone swim, % CSS speed (§3.4). */
export const SWIM_ZONES_CSS: ZoneModel = {
  id: 'swim-css-6',
  basis: 'css',
  unit: 'mps',
  labels: z(6),
  names: SKIBA6,
  bounds: [0, 0.93, 0.97, 0.99, 1.02, 1.09],
};

/**
 * Rowing bands, scheme B (§3.5, UNVERIFIED), expressed against the single rowing
 * threshold power (FTP_row = 0.75 × P2k): UT2 0.45·P2k … AN 1.05·P2k, plus "below UT2".
 */
export const ROW_ZONES: ZoneModel = {
  id: 'row-scheme-b',
  basis: 'rowThreshold',
  unit: 'W',
  labels: ['Z0', 'UT2', 'UT1', 'AT', 'TR', 'AN'],
  names: ['Below UT2', 'Utilisation 2', 'Utilisation 1', 'Anaerobic threshold', 'Transport', 'Anaerobic'],
  bounds: [0, 0.45 / 0.75, 0.6 / 0.75, 0.7 / 0.75, 0.8 / 0.75, 1.05 / 0.75],
};

/** Zones with absolute lower bounds in the model's unit. */
export interface ResolvedZones {
  model: ZoneModel;
  threshold: number;
  /** Absolute lower bounds (W, bpm or m/s). */
  lows: number[];
}

/** Resolve a model against a threshold value; null when the threshold is missing. */
export function resolveZones(model: ZoneModel, threshold: number | null | undefined): ResolvedZones | null {
  if (threshold == null || !(threshold > 0)) return null;
  return { model, threshold, lows: model.bounds.map((b) => b * threshold) };
}

/** 0-based zone index of a value (values below the first bound fall in zone 0); −1 for missing. */
export function zoneIndex(value: number | null | undefined, lows: readonly number[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return -1;
  let k = 0;
  for (let i = 1; i < lows.length; i++) if (value >= lows[i]) k = i;
  return k;
}

/** Seconds per zone (1 Hz by default). Missing samples are not counted (§3.6). */
export function timeInZones(series: NumSeries, zones: ResolvedZones, dtSec = 1): ZoneTime[] {
  const { lows, model } = zones;
  const secs = new Array<number>(lows.length).fill(0);
  for (let i = 0; i < series.length; i++) {
    const k = zoneIndex(series[i], lows);
    if (k >= 0) secs[k] += dtSec;
  }
  return lows.map((low, k) => ({
    zone: k + 1,
    name: model.names[k] ?? model.labels[k] ?? `Z${k + 1}`,
    low: k === 0 && low === 0 ? null : low,
    high: k + 1 < lows.length ? lows[k + 1] : null,
    seconds: secs[k],
  }));
}

/** Integer display ranges: zone k is ceil(T·b_k) … ceil(T·b_{k+1}) − 1 (§3). */
export function zoneDisplayRanges(model: ZoneModel, threshold: number): Array<{ label: string; name: string; low: number | null; high: number | null }> {
  return model.bounds.map((b, k) => ({
    label: model.labels[k],
    name: model.names[k],
    low: k === 0 && b === 0 ? null : Math.ceil(threshold * b - 1e-9),
    high: k + 1 < model.bounds.length ? Math.ceil(threshold * model.bounds[k + 1] - 1e-9) - 1 : null,
  }));
}

// ───────────────────────────── 3-zone distribution ─────────────────────────────

export type ThreeZoneSignal = 'power' | 'hr' | 'runSpeed' | 'swim' | 'row';

/** Seiler 3-zone boundaries [LT1, LT2] as fractions of the signal's threshold (§3.6; row in rowing-threshold units). */
export const THREE_ZONE_BOUNDS: Readonly<Record<ThreeZoneSignal, readonly [number, number]>> = {
  power: [0.75, 1.0],
  hr: [0.9, 1.0],
  runSpeed: [1 / 1.14, 1.0],
  swim: [0.93, 1.0],
  row: [0.6 / 0.75, 0.8 / 0.75],
};

export interface ThreeZoneSeconds {
  easy: number;
  moderate: number;
  hard: number;
}

/** Seconds below LT1 (easy), between (moderate) and at/above LT2 (hard). */
export function threeZoneSeconds(series: NumSeries, threshold: number, signal: ThreeZoneSignal, dtSec = 1): ThreeZoneSeconds {
  const out = { easy: 0, moderate: 0, hard: 0 };
  if (!(threshold > 0)) return out;
  const [a, b] = THREE_ZONE_BOUNDS[signal];
  const lt1 = a * threshold;
  const lt2 = b * threshold;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v >= lt2) out.hard += dtSec;
    else if (v >= lt1) out.moderate += dtSec;
    else out.easy += dtSec;
  }
  return out;
}

/** Easy/moderate/hard bucket of an intensity class (domain INTENSITY_META). */
export function intensityBucket(cls: IntensityClass): 'easy' | 'moderate' | 'hard' {
  return INTENSITY_META[cls].bucket;
}

/**
 * Polarization Index (Treff 2019, §3.6) from zone amounts (fractions or seconds;
 * normalised internally). Null when undefined.
 */
export function polarizationIndex(z1: number, z2: number, z3: number): number | null {
  const s = z1 + z2 + z3;
  if (!(s > 0)) return null;
  const a = z1 / s;
  const b = z2 / s;
  const c = z3 / s;
  if (b > 0 && c > 0) return a > 0 ? Math.log10((a / b) * c * 100) : null;
  if (b === 0 && c > 0.01) return a > 0 ? Math.log10((a / 0.01) * (c - 0.01) * 100) : null;
  return null;
}

export type DistributionType = 'polarized' | 'pyramidal' | 'threshold' | 'high_intensity' | 'mixed';

/** Classify a 3-zone distribution (§3.6), checked in order; ties → mixed. */
export function classifyDistribution(z1: number, z2: number, z3: number): DistributionType {
  const s = z1 + z2 + z3;
  if (!(s > 0)) return 'mixed';
  const pi = polarizationIndex(z1, z2, z3);
  if (z1 > z3 && z3 > z2 && pi !== null && pi > 2) return 'polarized';
  if (z1 > z2 && z2 > z3) return 'pyramidal';
  if (z2 > z1 && z2 > z3) return 'threshold';
  if (z3 > z1 && z3 > z2) return 'high_intensity';
  return 'mixed';
}

// ───────────────────────────── auto intensity (product.md §4.3) ─────────────────────────────

export type IntensitySignal = 'power' | 'runSpeed' | 'hr' | 'swim';

/**
 * Lower bounds of intensity levels L1…L5 (recovery … high) as threshold fractions,
 * per product.md §4.3. Power uses Coggan's bounds; swim (% CSS) is ours.
 */
export const INTENSITY_LEVEL_BOUNDS: Readonly<Record<IntensitySignal, readonly number[]>> = {
  power: [0, 0.55, 0.75, 0.9, 1.05],
  runSpeed: [0, 0.78, 0.88, 0.95, 1.02],
  hr: [0, 0.81, 0.9, 0.95, 1.0],
  swim: [0, 0.85, 0.93, 0.99, 1.02],
};

/** Seconds per intensity level L1…L5 of a series against a threshold. */
export function intensityLevelSeconds(series: NumSeries, threshold: number, signal: IntensitySignal, dtSec = 1): number[] {
  const lows = INTENSITY_LEVEL_BOUNDS[signal].map((b) => b * threshold);
  const secs = [0, 0, 0, 0, 0];
  for (let i = 0; i < series.length; i++) {
    const k = zoneIndex(series[i], lows);
    if (k >= 0) secs[k] += dtSec;
  }
  return secs;
}

export interface AutoIntensityInput {
  /** Seconds in L1…L5 from the best available signal (power → pace → HR). */
  levelSeconds?: readonly number[] | null;
  movingSec?: number;
  intensityFactor?: number | null;
  rpe?: number | null;
  /** Used when nothing else is available (default 'endurance'). */
  fallback?: IntensityClass;
}

const mins = (s: number) => `${Math.round(s / 60)}′`;

/**
 * Auto intensity class (product.md §4.3, completed activities):
 * ≥ 5 min or ≥ 8 % of moving time in L5 → high; ≥ 10 min in L4 → threshold;
 * ≥ 15 min in L3 → tempo; IF ≥ 0.60 or ≥ 60 % of zoned time in L2+ → endurance;
 * else recovery. Without zone data: RPE, then IF bands (ours), then `fallback`.
 * (We read "≥ 60 % in L2" as L2-or-above, so short tempo bits do not demote a ride.)
 */
export function autoIntensity(input: AutoIntensityInput): { intensity: IntensityClass; reason: string } {
  const lv = input.levelSeconds;
  const total = lv ? lv.reduce((a, b) => a + b, 0) : 0;
  if (lv && total > 0) {
    const moving = input.movingSec && input.movingSec > 0 ? input.movingSec : total;
    if (lv[4] >= 300 || lv[4] >= 0.08 * moving) return { intensity: 'high', reason: `${mins(lv[4])} above threshold` };
    if (lv[3] >= 600) return { intensity: 'threshold', reason: `${mins(lv[3])} at threshold` };
    if (lv[2] >= 900) return { intensity: 'tempo', reason: `${mins(lv[2])} at tempo` };
    const l2up = lv[1] + lv[2] + lv[3] + lv[4];
    if ((input.intensityFactor ?? 0) >= 0.6 || l2up >= 0.6 * total)
      return { intensity: 'endurance', reason: `${Math.round((100 * l2up) / total)}% endurance or above` };
    return { intensity: 'recovery', reason: `${Math.round((100 * lv[0]) / total)}% recovery` };
  }
  if (input.rpe != null && input.rpe > 0) return { intensity: rpeIntensityClass(input.rpe), reason: `RPE ${input.rpe}` };
  const IF = input.intensityFactor;
  if (IF != null && IF > 0) {
    const cls: IntensityClass = IF >= 0.95 ? 'high' : IF >= 0.85 ? 'threshold' : IF >= 0.75 ? 'tempo' : IF >= 0.6 ? 'endurance' : 'recovery';
    return { intensity: cls, reason: `IF ${IF.toFixed(2)}` };
  }
  return { intensity: input.fallback ?? 'endurance', reason: 'default' };
}
