import { expect } from 'vitest';

/** Absolute-tolerance comparison (spec Appendix A uses 1e-3). */
export function near(actual: number | null | undefined, expected: number, tol = 1e-3): void {
  expect(actual, `expected ≈ ${expected}, got ${actual}`).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect(Math.abs((actual as number) - expected), `expected ≈ ${expected}, got ${actual}`).toBeLessThanOrEqual(tol);
}

/** Build a 1 Hz series from [seconds, value] blocks. */
export function blocks(...parts: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [n, v] of parts) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** High-resolution clock without DOM/Node typings (lib is ES2023 only). */
export function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}
