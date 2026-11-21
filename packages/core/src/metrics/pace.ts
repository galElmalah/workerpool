/**
 * Pace / speed metrics (metrics.md §2.2, §4.2, §4.3, §4.6): Minetti 2002 grade
 * adjustment, adjusted (normalized) speed, Pace Load, best efforts by distance,
 * Riegel, VDOT and critical speed. Everything is computed in speed (m/s);
 * convert to pace only for display.
 */
import type { BestEffort } from '../domain';
import { loadFromIntensity, weightedPower } from './power';
import { linearFit, type NumSeries } from './util';

/** Minetti's measured gradient range; grades are clamped to it. */
export const GRADE_CLAMP = 0.45;

/** Energy cost of running (J·kg⁻¹·m⁻¹) at gradient i (rise/run), Minetti et al. 2002. */
export function minettiCost(grade: number): number {
  const i = Math.max(-GRADE_CLAMP, Math.min(GRADE_CLAMP, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/**
 * Grade factor f(i) = Cr(i)/3.6 (§2.2.1). `downhillFloor` optionally clamps
 * f from below (spec DECISION, default off → pure Minetti).
 */
export function gradeFactor(grade: number, downhillFloor?: number): number {
  if (!Number.isFinite(grade)) return 1;
  const f = minettiCost(grade) / 3.6;
  return downhillFloor != null ? Math.max(downhillFloor, f) : f;
}

/**
 * Grade series (fraction) from altitude (m) and cumulative distance (m), §2.2.1:
 * centred 15 s altitude mean, then (alt[i+5] − alt[i−5]) / (dist[i+5] − dist[i−5])
 * when the distance delta ≥ 10 m, else the previous grade (0 at start). Clamped.
 */
export function gradeSeries(altitude: NumSeries, distance: NumSeries): Float64Array {
  const n = Math.min(altitude.length, distance.length);
  const out = new Float64Array(n);
  // centred 15 s moving average of altitude, ignoring missing
  const alt = new Float64Array(n);
  const ps = new Float64Array(n + 1);
  const pc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = altitude[i];
    const ok = typeof v === 'number' && Number.isFinite(v);
    ps[i + 1] = ps[i] + (ok ? (v as number) : 0);
    pc[i + 1] = pc[i] + (ok ? 1 : 0);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 7);
    const b = Math.min(n, i + 8);
    const c = pc[b] - pc[a];
    alt[i] = c > 0 ? (ps[b] - ps[a]) / c : NaN;
  }
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 5);
    const b = Math.min(n - 1, i + 5);
    const da = distance[a];
    const db = distance[b];
    let g = prev;
    if (typeof da === 'number' && typeof db === 'number' && Number.isFinite(da) && Number.isFinite(db) && db - da >= 10) {
      const rise = alt[b] - alt[a];
      if (Number.isFinite(rise)) g = rise / (db - da);
    }
    g = Math.max(-GRADE_CLAMP, Math.min(GRADE_CLAMP, g));
    out[i] = g;
    prev = g;
  }
  return out;
}

/** Per-sample grade-adjusted speed v·f(grade) (m/s). Missing grade → flat; missing speed → NaN. */
export function adjustedSpeedSeries(speed: NumSeries, grade?: NumSeries | null, downhillFloor?: number): Float64Array {
  const n = speed.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = speed[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      out[i] = NaN;
      continue;
    }
    const g = grade ? grade[i] : 0;
    out[i] = v * (typeof g === 'number' && Number.isFinite(g) ? gradeFactor(g, downhillFloor) : 1);
  }
  return out;
}

/** Normalized (30 s / 4th-power) speed (m/s), the NGP analogue (§2.2.2). Falls back to mean for < 30 samples. */
export function normalizedSpeed(v: NumSeries): number | null {
  if (v.length === 0) return null;
  const ns = weightedPower(v);
  if (ns !== null) return ns;
  let s = 0;
  let c = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (typeof x === 'number' && Number.isFinite(x)) {
      s += x;
      c++;
    }
  }
  return c ? s / c : null;
}

export interface PaceLoadResult {
  /** Normalized adjusted speed (m/s). */
  normalizedSpeed: number;
  intensity: number;
  load: number;
  durationSec: number;
}

/**
 * Pace Load (§2.2.2) from an active 1 Hz grade-adjusted speed series and the
 * threshold speed (m/s). Null when empty or threshold missing.
 */
export function paceLoad(adjSpeed: NumSeries, thresholdMps: number | null | undefined): PaceLoadResult | null {
  if (adjSpeed.length === 0 || thresholdMps == null || !(thresholdMps > 0)) return null;
  const ns = normalizedSpeed(adjSpeed);
  if (ns == null) return null;
  const intensity = ns / thresholdMps;
  return { normalizedSpeed: ns, intensity, load: loadFromIntensity(adjSpeed.length, intensity, 2), durationSec: adjSpeed.length };
}

/** Running efficiency (m·min⁻¹·bpm⁻¹) = NS·60 / mean HR (§2.2.5). */
export function runEfficiency(normalizedSpeedMps: number | null, meanHr: number | null): number | null {
  if (normalizedSpeedMps == null || meanHr == null || !(meanHr > 0)) return null;
  return (normalizedSpeedMps * 60) / meanHr;
}

// ───────────────────────────── best efforts ─────────────────────────────

/** Mile (m). */
export const MILE_M = 1609.344;
/** Running best-effort targets (m). */
export const RUN_EFFORT_DISTANCES: readonly number[] = [400, 1000, MILE_M, 5000, 10000, 21097.5, 42195];
/** Rowing best-effort targets (m). */
export const ROW_EFFORT_DISTANCES: readonly number[] = [500, 1000, 2000, 5000, 6000, 10000, 21097.5];
/** Swim best-effort targets (m). */
export const SWIM_EFFORT_DISTANCES: readonly number[] = [50, 100, 200, 400, 800, 1500];

/**
 * Fastest time (s) to cover `targetM` metres in an elapsed 1 Hz cumulative-distance
 * series (§4.2): two pointers with linear interpolation inside the final second.
 * Missing samples are carried forward. Null when the distance is never covered. O(n).
 */
export function bestEffort(distance: NumSeries, targetM: number): BestEffort | null {
  const n = distance.length;
  if (n < 2 || !(targetM > 0)) return null;
  const D = new Float64Array(n);
  let last = 0;
  let seen = false;
  for (let i = 0; i < n; i++) {
    const v = distance[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      last = seen ? Math.max(last, v) : v;
      seen = true;
    }
    D[i] = last;
  }
  if (!seen || D[n - 1] - D[0] < targetM) return null;
  let best = Infinity;
  let at = -1;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n && D[j] - D[i] < targetM) j++;
    if (j >= n) break;
    const step = D[j] - D[j - 1];
    const need = targetM - (D[j - 1] - D[i]);
    const frac = step > 0 ? need / step : 1;
    const t = j - 1 - i + frac;
    if (t < best) {
      best = t;
      at = i;
    }
  }
  return at >= 0 ? { distanceM: targetM, timeSec: best, startSec: at } : null;
}

/** Best efforts for each target distance that the series covers. */
export function bestEfforts(distance: NumSeries, targets: readonly number[] = RUN_EFFORT_DISTANCES): BestEffort[] {
  const out: BestEffort[] = [];
  for (const d of targets) {
    const e = bestEffort(distance, d);
    if (e) out.push(e);
  }
  return out;
}

// ───────────────────────────── performance models ─────────────────────────────

/** Riegel prediction: time (s) for d2 given time t1 over d1 (T2 = T1·(D2/D1)^k, k = 1.06). */
export function riegelTime(t1Sec: number, d1M: number, d2M: number, exponent = 1.06): number {
  return t1Sec * (d2M / d1M) ** exponent;
}

/** Riegel inverse: distance (m) coverable in t2 given d1 in t1 (D2 = D1·(T2/T1)^(1/k)). */
export function riegelDistance(d1M: number, t1Sec: number, t2Sec: number, exponent = 1.06): number {
  return d1M * (t2Sec / t1Sec) ** (1 / exponent);
}

/** Threshold speed (m/s) from a race/effort: Riegel to the 60-minute distance, ÷ 3600 (§2.2.3). */
export function thresholdSpeedFromEffort(distanceM: number, timeSec: number, exponent = 1.06): number | null {
  if (!(distanceM > 0) || !(timeSec > 0)) return null;
  return riegelDistance(distanceM, timeSec, 3600, exponent) / 3600;
}

/** Daniels & Gilbert VDOT (§2.2.6) for a race of `distanceM` in `timeSec`. */
export function vdot(distanceM: number, timeSec: number): { vo2: number; pctMax: number; vdot: number } | null {
  if (!(distanceM > 0) || !(timeSec > 0)) return null;
  const tMin = timeSec / 60;
  const v = distanceM / tMin;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return { vo2, pctMax, vdot: vo2 / pctMax };
}

/**
 * Critical speed by OLS on distance = CS·t + D′ (§4.3) using efforts with
 * 120 s ≤ t ≤ 1200 s. Null with < 2 usable efforts or a non-physical fit.
 */
export function fitCriticalSpeed(
  efforts: ReadonlyArray<{ distanceM: number; timeSec: number }>,
  opts: { minSec?: number; maxSec?: number } = {},
): { cs: number; dPrime: number; r2: number } | null {
  const lo = opts.minSec ?? 120;
  const hi = opts.maxSec ?? 1200;
  const use = efforts.filter((e) => e.timeSec >= lo && e.timeSec <= hi && e.distanceM > 0);
  const fit = linearFit(
    use.map((e) => e.timeSec),
    use.map((e) => e.distanceM),
  );
  if (!fit || fit.slope <= 0) return null;
  return { cs: fit.slope, dPrime: fit.intercept, r2: fit.r2 };
}

/** Pace (s per `per` metres) from speed (m/s); null for non-positive speed. */
export function speedToPace(speedMps: number, per = 1000): number | null {
  return speedMps > 0 ? per / speedMps : null;
}

/** Speed (m/s) from pace (s per `per` metres). */
export function paceToSpeed(paceSec: number, per = 1000): number | null {
  return paceSec > 0 ? per / paceSec : null;
}
