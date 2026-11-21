/**
 * Power metrics (metrics.md §2.1, §4.1, §4.3–4.5): Weighted Power (NP algorithm),
 * Intensity, Power Load, variability, efficiency, decoupling, work, mean-maximal
 * curves, critical power, W′ balance and threshold-power estimates.
 *
 * Non-finite samples in a power series are treated as 0 W.
 */
import type { PeakPoint } from '../domain';
import { linearFit, type NumSeries } from './util';

const num0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Weighted Power (W): 30 s trailing rolling mean → 4th power → mean → 4th root,
 * full windows only (i = 29…n−1, §2.1.1). Returns null for < 30 samples
 * (callers fall back to mean power). O(n).
 */
export function weightedPower(p: NumSeries): number | null {
  const n = p.length;
  if (n < 30) return null;
  let s = 0;
  for (let i = 0; i < 30; i++) s += num0(p[i]);
  let acc = (s / 30) ** 4;
  let c = 1;
  for (let i = 30; i < n; i++) {
    // Periodically recompute the window sum to bound float drift (§2.1.1).
    if (i % 3600 === 0) {
      s = 0;
      for (let j = i - 29; j <= i; j++) s += num0(p[j]);
    } else s += num0(p[i]) - num0(p[i - 30]);
    acc += (Math.max(0, s) / 30) ** 4;
    c++;
  }
  return (acc / c) ** 0.25;
}

/** Mean of a power series (W), missing = 0; null when empty. */
export function meanPower(p: NumSeries): number | null {
  if (p.length === 0) return null;
  let s = 0;
  for (let i = 0; i < p.length; i++) s += num0(p[i]);
  return s / p.length;
}

/** Intensity (IF) = WP / threshold. Null if either is missing or threshold ≤ 0. */
export function intensityFactor(weighted: number | null | undefined, threshold: number | null | undefined): number | null {
  if (weighted == null || threshold == null || !(threshold > 0) || !Number.isFinite(weighted)) return null;
  return weighted / threshold;
}

/**
 * Load for `durationSec` seconds at `intensity`: 100 · (s/3600) · intensity^exponent.
 * exponent 2 for power/pace (§2.1.2, §2.2.2), 3 for swim (§2.4.2).
 */
export function loadFromIntensity(durationSec: number, intensity: number, exponent = 2): number {
  if (!(durationSec > 0) || !(intensity > 0)) return 0;
  return 100 * (durationSec / 3600) * intensity ** exponent;
}

/** Variability (VI) = WP / mean power. */
export function variabilityIndex(weighted: number | null, meanP: number | null): number | null {
  if (weighted == null || meanP == null || !(meanP > 0)) return null;
  return weighted / meanP;
}

/** Efficiency (EF) = output / mean HR (bike: W/bpm). */
export function efficiencyFactor(output: number | null, meanHr: number | null): number | null {
  if (output == null || meanHr == null || !(meanHr > 0)) return null;
  return output / meanHr;
}

/** Mechanical work (kJ) of a 1 Hz power series. */
export function workKj(p: NumSeries): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += num0(p[i]);
  return s / 1000;
}

export interface PowerLoadResult {
  /** W */
  weightedPower: number;
  /** W */
  meanPower: number;
  intensity: number;
  load: number;
  variability: number | null;
  workKj: number;
  /** True when the series was < 30 s and WP = mean power. */
  wpFallback: boolean;
  durationSec: number;
}

/** Power Load of an active 1 Hz power series at threshold `ftp` (W) (§2.1.2). Null when empty or ftp missing. */
export function powerLoad(p: NumSeries, ftp: number | null | undefined): PowerLoadResult | null {
  const n = p.length;
  if (n === 0 || ftp == null || !(ftp > 0)) return null;
  const mp = meanPower(p) as number;
  const wp0 = weightedPower(p);
  const wp = wp0 ?? mp;
  const intensity = wp / ftp;
  return {
    weightedPower: wp,
    meanPower: mp,
    intensity,
    load: loadFromIntensity(n, intensity, 2),
    variability: variabilityIndex(wp, mp),
    workKj: workKj(p),
    wpFallback: wp0 === null,
    durationSec: n,
  };
}

/**
 * Aerobic decoupling (%) per GoldenCheetah (§2.1.3): split at floor(n/2), in each
 * half average output and HR over samples with HR > 0, then
 * 100·(r1 − r2)/r1 with r = output/HR. Positive = HR drifted up. Null if undefined.
 */
export function decoupling(output: NumSeries, hr: NumSeries): number | null {
  const n = Math.min(output.length, hr.length);
  if (n < 2) return null;
  const half = Math.floor(n / 2);
  const ratio = (a: number, b: number): number | null => {
    let sp = 0;
    let sh = 0;
    let c = 0;
    for (let i = a; i < b; i++) {
      const h = hr[i];
      if (typeof h === 'number' && h > 0) {
        sp += num0(output[i]);
        sh += h;
        c++;
      }
    }
    return c && sh > 0 ? sp / c / (sh / c) : null;
  };
  const r1 = ratio(0, half);
  const r2 = ratio(half, n);
  if (r1 === null || r2 === null || r1 === 0) return null;
  return (100 * (r1 - r2)) / r1;
}

// ───────────────────────────── mean-maximal curves ─────────────────────────────

function buildLadder(): number[] {
  const d: number[] = [];
  for (let s = 1; s <= 60; s++) d.push(s);
  for (let s = 65; s <= 300; s += 5) d.push(s);
  for (let s = 310; s <= 1200; s += 10) d.push(s);
  for (let s = 1230; s <= 3600; s += 30) d.push(s);
  for (let s = 3660; s <= 18000; s += 60) d.push(s);
  return d;
}

/**
 * Standard duration ladder (s) for mean-maximal curves (§4.1): 1–60 s every 1 s,
 * 65–300 every 5, 310–1200 every 10, 1230–3600 every 30, 3660–18000 every 60.
 * Note: the spec text says "185 points"; its own step rules produce 518 points.
 */
export const MMP_DURATIONS: readonly number[] = Object.freeze(buildLadder());

export interface MeanMaxOptions {
  /** How non-finite samples are handled: 'zero' (power default) or 'skip' (windows containing one are ignored; HR). */
  missing?: 'zero' | 'skip';
}

/**
 * Mean-maximal curve: for each duration d (s) ≤ n, the best mean of any d-sample
 * window of the elapsed 1 Hz series, with its start index. Durations longer than
 * the series are omitted. The exact per-workout curve is not always monotone
 * (e.g. [10, 0, 10]: 3 s beats 2 s, contrary to the spec's note); `mergeCurves`
 * enforces monotonicity. Complexity O(n · |durations|) with a prefix sum
 * (5 h at 1 Hz over the 518-point ladder ≈ 9 M adds, ~10–30 ms in V8).
 */
export function meanMaximal(x: NumSeries, durations: readonly number[] = MMP_DURATIONS, opts: MeanMaxOptions = {}): PeakPoint[] {
  const n = x.length;
  if (n === 0) return [];
  const skip = opts.missing === 'skip';
  const pre = new Float64Array(n + 1);
  const bad = skip ? new Int32Array(n + 1) : null;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const ok = typeof v === 'number' && Number.isFinite(v);
    pre[i + 1] = pre[i] + (ok ? (v as number) : 0);
    if (bad) bad[i + 1] = bad[i] + (ok ? 0 : 1);
  }
  const out: PeakPoint[] = [];
  for (const d of durations) {
    if (!(d >= 1) || d > n) continue;
    let best = -Infinity;
    let at = -1;
    const last = n - d;
    if (bad) {
      for (let i = 0; i <= last; i++) {
        if (bad[i + d] !== bad[i]) continue;
        const s = pre[i + d] - pre[i];
        if (s > best) {
          best = s;
          at = i;
        }
      }
    } else {
      for (let i = 0; i <= last; i++) {
        const s = pre[i + d] - pre[i];
        if (s > best) {
          best = s;
          at = i;
        }
      }
    }
    if (at >= 0) out.push({ durationSec: d, value: best / d, startSec: at });
  }
  return out;
}

export interface CurvePoint extends PeakPoint {
  /** Id of the workout that set this point (when merged from labelled curves). */
  sourceId?: string;
}

/**
 * Athlete curve over a range: pointwise max across workouts, keeping the source id,
 * then a backward pass so the curve is non-increasing in duration (§4.1).
 * When the backward pass lifts a point, its source is that of the longer effort.
 */
export function mergeCurves(curves: ReadonlyArray<{ id?: string; points: readonly PeakPoint[] }>): CurvePoint[] {
  const best = new Map<number, CurvePoint>();
  for (const c of curves) {
    for (const p of c.points) {
      if (!Number.isFinite(p.value)) continue;
      const cur = best.get(p.durationSec);
      if (!cur || p.value > cur.value) best.set(p.durationSec, { ...p, sourceId: c.id });
    }
  }
  const pts = [...best.values()].sort((a, b) => a.durationSec - b.durationSec);
  for (let i = pts.length - 2; i >= 0; i--) {
    if (pts[i + 1].value > pts[i].value) pts[i] = { ...pts[i + 1], durationSec: pts[i].durationSec };
  }
  return pts;
}

/** Value of a curve at exactly `durationSec`, or null. */
export function curveAt(curve: readonly PeakPoint[], durationSec: number): number | null {
  for (const p of curve) if (p.durationSec === durationSec) return p.value;
  return null;
}

// ───────────────────────────── critical power ─────────────────────────────

export interface CriticalPowerFit {
  /** W */
  cp: number;
  /** J */
  wPrime: number;
  r2: number;
  /** False when a rejection rule fired (CP ≤ 0, W′ ≤ 0, W′ > 60 kJ, R² < 0.95). */
  valid: boolean;
  reason?: string;
  points: number;
}

/**
 * 2-parameter critical power by OLS on work = CP·t + W′ (§4.3), using points
 * with `minSec ≤ t ≤ maxSec` (default 120–1200 s). Null with < 2 usable points.
 */
export function fitCriticalPower(
  points: ReadonlyArray<{ durationSec: number; value: number }>,
  opts: { minSec?: number; maxSec?: number } = {},
): CriticalPowerFit | null {
  const lo = opts.minSec ?? 120;
  const hi = opts.maxSec ?? 1200;
  const use = points.filter((p) => p.durationSec >= lo && p.durationSec <= hi && p.value > 0 && Number.isFinite(p.value));
  const fit = linearFit(
    use.map((p) => p.durationSec),
    use.map((p) => p.value * p.durationSec),
  );
  if (!fit) return null;
  const cp = fit.slope;
  const wPrime = fit.intercept;
  let reason: string | undefined;
  if (cp <= 0) reason = 'cp<=0';
  else if (wPrime <= 0) reason = "w'<=0";
  else if (wPrime > 60_000) reason = "w'>60kJ";
  else if (fit.r2 < 0.95) reason = 'r2<0.95';
  return { cp, wPrime, r2: fit.r2, valid: reason === undefined, reason, points: use.length };
}

/** Two-point CP closed form (W): (P1·t1 − P2·t2)/(t1 − t2). */
export function criticalPowerTwoPoint(t1: number, p1: number, t2: number, p2: number): number | null {
  if (t1 === t2) return null;
  return (p1 * t1 - p2 * t2) / (t1 - t2);
}

/** Power (W) predicted by the CP model for duration t (s): CP + W′/t. */
export function cpPredict(cp: number, wPrime: number, t: number): number {
  return cp + wPrime / t;
}

/**
 * W′ balance (J) per second, Skiba differential form (§4.4), starting at W′.
 * May go negative (CP/W′ underestimated).
 */
export function wPrimeBalance(p: NumSeries, cp: number, wPrime: number): Float64Array {
  const out = new Float64Array(p.length);
  let w = wPrime;
  for (let i = 0; i < p.length; i++) {
    const v = num0(p[i]);
    if (v < cp) w += ((cp - v) * (wPrime - w)) / wPrime;
    else w -= v - cp;
    out[i] = w;
  }
  return out;
}

// ───────────────────────────── threshold estimates ─────────────────────────────

export interface FtpEstimate {
  /** W */
  value: number;
  basis: '0.95x20min' | '60min';
}

/**
 * eFTP (ours, §4.5): max(0.95 × MMP(1200 s), MMP(3600 s)) from a (90-day) curve.
 * Suggestion only — never auto-applied. Null without either point.
 */
export function estimateFtp(curve: readonly PeakPoint[]): FtpEstimate | null {
  const p20 = curveAt(curve, 1200);
  const p60 = curveAt(curve, 3600);
  const a = p20 != null ? 0.95 * p20 : -1;
  const b = p60 ?? -1;
  if (a <= 0 && b <= 0) return null;
  return a >= b ? { value: a, basis: '0.95x20min' } : { value: b, basis: '60min' };
}

/** VO2max estimate (ml·kg⁻¹·min⁻¹) from 5-min power (ACSM leg cycling, §4.7): 10.8·P/kg + 7. */
export function vo2maxFromPower(p5minW: number, weightKg: number): number | null {
  if (!(weightKg > 0) || !(p5minW > 0)) return null;
  return (10.8 * p5minW) / weightKg + 7;
}
