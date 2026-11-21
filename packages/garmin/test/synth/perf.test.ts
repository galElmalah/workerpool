import { describe, expect, it } from 'vitest';
import { generateActivityDetail, generateAthlete } from '../../src/synth';
import { athlete, TODAY } from './fixtures';

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function hasTypedArrays(v: unknown, depth = 0): boolean {
  if (ArrayBuffer.isView(v)) return true;
  if (depth > 6 || v === null || typeof v !== 'object') return false;
  for (const x of Array.isArray(v) ? v : Object.values(v)) if (hasTypedArrays(x, depth + 1)) return true;
  return false;
}

describe('performance & memory', () => {
  it('generates 12 months fast (target < 150 ms warm)', () => {
    generateAthlete({ seed: 7, today: TODAY });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      generateAthlete({ seed: 7 + i, today: TODAY });
      times.push(performance.now() - t0);
    }
    const m = median(times);
    console.log(`generateAthlete(12 months) median ${m.toFixed(0)} ms`);
    // generous CI bound; typical ~100–140 ms on a laptop-class core
    expect(m).toBeLessThan(400);
  });

  it('renders a 3 h+ activity detail in < 100 ms', () => {
    const a = athlete();
    const long = [...a.activities].filter((x) => x.sport === 'bike').sort((p, q) => q.durationSec - p.durationSec)[0]!;
    expect(long.durationSec).toBeGreaterThan(3 * 3600);
    generateActivityDetail(a, long.garminActivityId);
    const t0 = performance.now();
    const d = generateActivityDetail(a, long.garminActivityId);
    const ms = performance.now() - t0;
    console.log(`detail ${Math.round(long.durationSec / 60)} min → ${ms.toFixed(1)} ms, ${d.streams!.t.length} samples`);
    expect(ms).toBeLessThan(100);
  });

  it('holds no streams: compact, JSON-safe, no typed arrays', () => {
    const a = athlete();
    const json = JSON.stringify(a);
    expect(json.length).toBeLessThan(2_500_000);
    expect(json).not.toContain('"streams"');
    expect(json).not.toContain('"lat"');
    expect(hasTypedArrays(a)).toBe(false);
    expect(JSON.parse(json)).toEqual(a);
  });
});
