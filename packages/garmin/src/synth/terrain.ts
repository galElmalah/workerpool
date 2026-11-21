/**
 * Procedural terrain: altitude as a smooth function of the position `p` (metres along the course).
 * Sum of sines (wavelength ≥ 1.2 km) + an optional sustained climb, rescaled to a target
 * elevation gain. Loops use whole-number cycles so altitude is continuous at the finish.
 */
import type { Rng } from './prng';

export interface Terrain {
  base: number;
  /** amplitude, wavenumber (rad/m), phase */
  a: Float64Array;
  k: Float64Array;
  ph: Float64Array;
  sinPh: Float64Array;
  climb?: { p0: number; len: number; gain: number };
}

export interface TerrainOpts {
  /** Course length over which p ranges (loop length, or one-way length for out-and-back). */
  L: number;
  periodic: boolean;
  base: number;
  /** Target total ascent over p ∈ [0, L]. */
  gain: number;
  climb?: { len: number; gain: number; endAt?: number };
}

export function makeTerrain(rng: Rng, o: TerrainOpts): Terrain {
  const n = 4;
  const a = new Float64Array(n);
  const k = new Float64Array(n);
  const ph = new Float64Array(n);
  const sinPh = new Float64Array(n);
  const minWl = 1200;
  for (let i = 0; i < n; i++) {
    let wl = minWl * (1.6 + i * 1.7 + rng.range(0, 1.5)) * (i === n - 1 ? 3 : 1);
    if (o.periodic) {
      const cycles = Math.max(1, Math.round(o.L / wl));
      wl = o.L / cycles;
    }
    k[i] = (2 * Math.PI) / wl;
    a[i] = rng.range(0.5, 1) * (i === n - 1 ? 2 : 1);
    ph[i] = rng.range(0, 2 * Math.PI);
    sinPh[i] = fsin(ph[i]!);
  }
  const t: Terrain = { base: o.base, a, k, ph, sinPh };
  let climbGain = 0;
  if (o.climb && o.L > o.climb.len * 1.1) {
    const end = o.climb.endAt ?? o.L;
    t.climb = { p0: Math.max(0, end - o.climb.len), len: o.climb.len, gain: o.climb.gain };
    climbGain = o.climb.gain;
  }
  // rescale the rolling component to hit the remaining target gain
  const want = o.gain <= 0 ? 0 : Math.max(o.gain - climbGain, o.L * 0.002);
  const saved = t.climb;
  delete t.climb;
  const g = ascent(t, o.L);
  const s = g > 0 ? want / g : 0;
  for (let i = 0; i < n; i++) a[i] = a[i]! * s;
  if (saved) t.climb = saved;
  return t;
}

const TWO_PI = 2 * Math.PI;
/** Fast sine (range-reduced, 7th-order odd polynomial on [-π/2, π/2]; |err| < 2e-4). */
function fsin(x: number): number {
  x -= TWO_PI * Math.floor(x / TWO_PI + 0.5); // [-π, π]
  if (x > Math.PI / 2) x = Math.PI - x;
  else if (x < -Math.PI / 2) x = -Math.PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-0.16666 + x2 * (0.0083143 - x2 * 0.00018542)));
}

/** Altitude and grade (dAlt/dp) at position p. */
export function altGrade(t: Terrain, p: number, out: { alt: number; grade: number }): void {
  let alt = t.base;
  let gr = 0;
  const { a, k, ph, sinPh } = t;
  for (let i = 0; i < a.length; i++) {
    const arg = k[i]! * p + ph[i]!;
    alt += a[i]! * (fsin(arg) - sinPh[i]!);
    gr += a[i]! * k[i]! * fsin(arg + Math.PI / 2);
  }
  const c = t.climb;
  if (c && p > c.p0) {
    const s = Math.min(1, (p - c.p0) / c.len);
    alt += (c.gain * (1 - Math.cos(Math.PI * s))) / 2;
    if (s < 1) gr += (c.gain * Math.PI * Math.sin(Math.PI * s)) / (2 * c.len);
  }
  out.alt = alt;
  out.grade = gr;
}

const tmp = { alt: 0, grade: 0 };

export function altAt(t: Terrain, p: number): number {
  altGrade(t, p, tmp);
  return tmp.alt;
}

/** Total ascent over [0, L] sampled every ~40 m. */
export function ascent(t: Terrain, L: number): number {
  const steps = Math.max(10, Math.ceil(L / 40));
  let prev = altAt(t, 0);
  let up = 0;
  for (let i = 1; i <= steps; i++) {
    const v = altAt(t, (L * i) / steps);
    if (v > prev) up += v - prev;
    prev = v;
  }
  return up;
}
