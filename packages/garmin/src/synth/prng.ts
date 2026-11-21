/**
 * Small, fast, deterministic PRNG utilities (mulberry32 + string hashing).
 * Everything in the synthetic athlete is derived from `rngFor(seed, ...keys)` so that
 * any single activity can be regenerated in isolation from (seed, id).
 */

/** 32-bit FNV-1a followed by a murmur3-style finaliser. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix(h);
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine a seed with any number of keys into a new 32-bit seed. */
export function mixSeed(seed: number, ...keys: (string | number)[]): number {
  let h = fmix((seed >>> 0) ^ 0x9e3779b9);
  for (const k of keys) {
    const kh = typeof k === 'number' && Number.isInteger(k) && Math.abs(k) < 2 ** 31 ? fmix(k ^ 0x27d4eb2d) : hashString(String(k));
    h = fmix(Math.imul(h ^ kh, 0x9e3779b1) + 0x7f4a7c15);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x6d2b79f5;
  }

  /** Uniform [0, 1). mulberry32. */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  /** Standard normal (Box–Muller, cached spare). */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + sd * v;
    }
    let u = 0;
    while (u <= 1e-12) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  /** Normal clipped to ±k standard deviations. */
  clippedNormal(mean: number, sd: number, k = 2.5): number {
    const z = Math.max(-k, Math.min(k, this.normal()));
    return mean + sd * z;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1]![0];
  }
}

export function rngFor(seed: number, ...keys: (string | number)[]): Rng {
  return new Rng(mixSeed(seed, ...keys));
}
