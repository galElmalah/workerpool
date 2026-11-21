import type { SynthActivity, SynthAthlete } from '../../src/synth';
import { generateAthlete } from '../../src/synth';

export const TODAY = '2026-11-21';

let cached: SynthAthlete | undefined;
/** The default 12-month athlete (seed 7), generated once per test file. */
export function athlete(): SynthAthlete {
  cached ??= generateAthlete({ seed: 7, today: TODAY });
  return cached;
}

export function mondayOf(d: string): string {
  const t = Date.parse(`${d}T00:00:00Z`);
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - wd * 86_400_000).toISOString().slice(0, 10);
}

/** A spread of activities across every sport/sub-sport plus all races and tests. */
export function sample(a: SynthAthlete, every = 9): SynthActivity[] {
  const seen = new Set<string>();
  const out: SynthActivity[] = [];
  a.activities.forEach((x, i) => {
    const k = `${x.sport}/${x.subSport}`;
    const p = x.plannedKey ? a.plan.find((q) => q.key === x.plannedKey) : undefined;
    if (!seen.has(k) || i % every === 0 || p?.tags.includes('race') || p?.tags.includes('test')) {
      seen.add(k);
      out.push(x);
    }
  });
  return out;
}

export const nums = (arr: (number | null)[] | undefined): number[] => (arr ?? []).filter((v): v is number => v !== null && v !== undefined);
export const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

export function weightedPower(p: number[]): number {
  if (p.length < 30) return mean(p);
  let s = 0;
  for (let i = 0; i < 30; i++) s += p[i]!;
  let acc = (s / 30) ** 4;
  let c = 1;
  for (let i = 30; i < p.length; i++) {
    s += p[i]! - p[i - 30]!;
    acc += (s / 30) ** 4;
    c++;
  }
  return (acc / c) ** 0.25;
}
