import { describe, expect, it } from 'vitest';
import { generateActivityDetail, generateAthlete } from '../../src/synth';
import { TODAY } from './fixtures';

describe('determinism', () => {
  it('same seed → deep-equal athlete', () => {
    const a = generateAthlete({ seed: 11, today: TODAY, months: 4 });
    const b = generateAthlete({ seed: 11, today: TODAY, months: 4 });
    expect(b).toEqual(a);
  });

  it('defaults to seed 7 and 12 months', () => {
    const a = generateAthlete({ today: TODAY, months: 2 });
    expect(a.seed).toBe(7);
    const full = generateAthlete({ today: TODAY });
    expect(full.wellness[0]!.date <= '2025-11-24').toBe(true);
  });

  it('different seeds produce different histories', () => {
    const a = generateAthlete({ seed: 1, today: TODAY, months: 3 });
    const b = generateAthlete({ seed: 2, today: TODAY, months: 3 });
    expect(a.activities.map((x) => x.garminActivityId)).not.toEqual(b.activities.map((x) => x.garminActivityId));
    expect(a.wellness.map((w) => w.hrvMs)).not.toEqual(b.wellness.map((w) => w.hrvMs));
    expect(a.activities.map((x) => x.avgHr)).not.toEqual(b.activities.map((x) => x.avgHr));
  });

  it('detail regenerates identically, also from a JSON round-tripped athlete', () => {
    const a = generateAthlete({ seed: 5, today: TODAY, months: 2 });
    const ids = [a.activities[0]!, a.activities[Math.floor(a.activities.length / 2)]!, a.activities.at(-1)!].map((x) => x.garminActivityId);
    const revived = JSON.parse(JSON.stringify(a));
    for (const id of ids) {
      const d1 = generateActivityDetail(a, id);
      const d2 = generateActivityDetail(a, id);
      const d3 = generateActivityDetail(revived, id);
      expect(d2).toEqual(d1);
      expect(d3.streams).toEqual(d1.streams);
      expect(d3.laps).toEqual(d1.laps);
    }
  });

  it('unknown id throws', () => {
    const a = generateAthlete({ seed: 5, today: TODAY, months: 1 });
    expect(() => generateActivityDetail(a, 123)).toThrow();
  });
});
