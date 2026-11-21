/**
 * Random-access deterministic noise. High-frequency stream noise is zero-sum within each 5 s
 * grid block, so block means (and therefore activity averages) equal the coarse simulation.
 */
import { mixSeed } from './prng';

export const CH = { power: 1, hr: 2, cad: 3, speed: 4, gpsX: 5, gpsY: 6, temp: 7 } as const;

export function noiseKey(seed: number, id: number, ch: number): number {
  return mixSeed(seed, 'noise', id, ch);
}

function u(key: number, i: number): number {
  let h = (key ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Triangular noise in (−1, 1), sd ≈ 0.408. */
export function tri(key: number, i: number): number {
  return u(key, 2 * i) + u(key, 2 * i + 1) - 1;
}

/** Zero-sum noise for block k with m (1..5) samples, scaled to sd ≈ 1. */
export function blockZ(key: number, k: number, m: number, out: Float64Array): void {
  let s = 0;
  for (let j = 0; j < m; j++) {
    const v = tri(key, k * 5 + j) * 2.45;
    out[j] = v;
    s += v;
  }
  const mean = s / m;
  for (let j = 0; j < m; j++) out[j] = out[j]! - mean;
}
