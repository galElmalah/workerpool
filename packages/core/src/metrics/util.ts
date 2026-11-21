/**
 * Small numeric helpers shared by the metrics engine. Pure, allocation-light,
 * isomorphic (no Node APIs). `NaN` is the internal "missing sample" marker.
 */

/** A numeric series; `null`/`undefined`/non-finite entries are treated as missing. */
export type NumSeries = ArrayLike<number | null | undefined>;

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Copy into a Float64Array, mapping null / undefined / ±Infinity to NaN. */
export function toF64(x: NumSeries): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    out[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  }
  return out;
}

/** Mean of finite values; null when there are none. */
export function mean(x: NumSeries): number | null {
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      s += v;
      c++;
    }
  }
  return c ? s / c : null;
}

/** Standard deviation of finite values (population by default, `sample` divides by n − 1). */
export function stdDev(x: NumSeries, sample = false): number | null {
  const m = mean(x);
  if (m === null) return null;
  let ss = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      ss += (v - m) ** 2;
      c++;
    }
  }
  const d = sample ? c - 1 : c;
  return d > 0 ? Math.sqrt(ss / d) : null;
}

/** Fraction (0..1) of entries that are finite numbers; 0 for an empty series. */
export function coverage(x: NumSeries | undefined): number {
  if (!x || x.length === 0) return 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) if (isNum(x[i])) c++;
  return c / x.length;
}

/** Display rounding: half away from zero (JS Math.round rounds −2.5 to −2). */
export function roundHalfAway(v: number, dp = 0): number {
  const f = 10 ** dp;
  return (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
}

/** Linear interpolation in an ascending (x, y) table; clamps outside the table. */
export function interpTable(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let i = 1;
  while (xs[i] < x) i++;
  const x0 = xs[i - 1];
  const x1 = xs[i];
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - x0)) / (x1 - x0);
}

/** Ordinary least squares y = slope·x + intercept, with R². Null with < 2 distinct x. */
export function linearFit(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; r2: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Accepts Map or Record keyed by string; returns a lookup function (missing → 0). */
export function lookupOf(src: Map<string, number> | Record<string, number> | undefined): (k: string) => number {
  if (!src) return () => 0;
  if (src instanceof Map) return (k) => (isNum(src.get(k)) ? (src.get(k) as number) : 0);
  return (k) => (isNum(src[k]) ? src[k] : 0);
}

export function keysOf(src: Map<string, number> | Record<string, number> | undefined): string[] {
  if (!src) return [];
  return src instanceof Map ? [...src.keys()] : Object.keys(src);
}
