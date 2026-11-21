import { describe, expect, it } from 'vitest';
import {
  acwr,
  autoSeed,
  buildFitnessSeries,
  ewmaWeight,
  formZoneOf,
  monotony,
  rampBand,
  strain,
} from '../../src/metrics';
import { addDays } from '../../src/time';
import { near } from './helpers';

const LOADS = [100, 0, 60, 80, 0, 120, 50, 0, 90, 70, 0, 150, 40, 0];
const D0 = '2026-01-01';
const toMap = (loads: number[], start = D0) => {
  const m = new Map<string, number>();
  loads.forEach((l, i) => m.set(addDays(start, i), l));
  return m;
};
// Day, Fitness, Fatigue, FormY, FormT
const TV10: Array<[number, number, number, number]> = [
  [2.3528, 13.3122, 0.0, -10.9594],
  [2.2975, 11.5401, -10.9594, -9.2426],
  [3.6551, 17.9911, -9.2426, -14.336],
  [5.4514, 26.2459, -14.336, -20.7945],
  [5.3231, 22.752, -20.7945, -17.4289],
  [8.0213, 35.6978, -17.4289, -27.6766],
  [9.009, 37.6018, -27.6766, -28.5928],
  [8.797, 32.5962, -28.5928, -23.7992],
  [10.7076, 40.2379, -23.7992, -29.5303],
  [12.1026, 44.1999, -29.5303, -32.0973],
  [11.8179, 38.3159, -32.0973, -26.498],
  [15.0691, 53.1835, -26.498, -38.1145],
  [15.6556, 51.4285, -38.1145, -35.7729],
  [15.2873, 44.5822, -35.7729, -29.2949],
];

describe('fitness series (TV-10)', () => {
  const series = buildFitnessSeries({ dailyLoad: toMap(LOADS), from: D0, to: addDays(D0, 13), today: addDays(D0, 13) });

  it('constants', () => {
    near(ewmaWeight(42), 0.0235283133, 1e-10);
    near(ewmaWeight(7), 0.1331221002, 1e-10);
    near(ewmaWeight(7, 'simple'), 1 / 7, 1e-12);
  });

  it('a) exponential Fitness/Fatigue/Form match the table', () => {
    expect(series).toHaveLength(14);
    series.forEach((d, i) => {
      const [F, A, FormY, FormT] = TV10[i];
      near(d.fitness, F);
      near(d.fatigue, A);
      near(d.form, FormY);
      near(d.fitness - d.fatigue, FormT);
      expect(d.load).toBe(LOADS[i]);
      expect(d.projected).toBe(false);
    });
    expect(series[0].formPct).toBeNull(); // yesterday's fitness < 1
  });

  it('b) simple 1/τ form', () => {
    const s = buildFitnessSeries({ dailyLoad: toMap(LOADS), from: D0, to: addDays(D0, 13), today: addDays(D0, 13), pmcForm: 'simple' });
    near(s[0].fitness, 2.381);
    near(s[0].fatigue, 14.2857);
    near(s[13].fitness, 15.4415);
    near(s[13].fatigue, 45.3551);
  });

  it('c) linearity: per-sport fitness sums to combined', () => {
    const bike = [100, 0, 60, 0, 0, 120, 50, 0, 90, 0, 0, 150, 40, 0];
    const run = [0, 0, 0, 80, 0, 0, 0, 0, 0, 70, 0, 0, 0, 0];
    const args = { from: D0, to: addDays(D0, 13), today: addDays(D0, 13) };
    const fb = buildFitnessSeries({ ...args, dailyLoad: toMap(bike) })[13].fitness;
    const fr = buildFitnessSeries({ ...args, dailyLoad: toMap(run) })[13].fitness;
    near(fb, 12.3065);
    near(fr, 2.9808);
    near(fb + fr, series[13].fitness, 1e-9);
  });

  it('d) ramp and e) form % / zone', () => {
    near(series[13].ramp!, 6.2783);
    near(series[13].formPct!, -228.5, 0.05);
    expect(series[13].formZone).toBe('overreaching');
    // zone suppressed while yesterday's fitness < 5
    expect(series[3].formZone).toBeNull();
    expect(series[4].formZone).not.toBeNull();
  });

  it('f) monotony & strain (population SD)', () => {
    const wk = [0, 90, 70, 0, 150, 40, 0];
    near(monotony(wk)!, 0.9449);
    near(strain(wk)!, 330.7189);
    expect(monotony([50, 50, 50])).toBeNull();
    expect(strain([])).toBeNull();
  });

  it('g) EWMA ACWR raw value, invalid with < 28 days', () => {
    const r = acwr(LOADS);
    near(r.acute, 46.4959);
    near(r.chronic, 33.5779);
    near(r.ratio!, 1.3847);
    expect(r.valid).toBe(false);
    const long = acwr(Array.from({ length: 35 }, () => 50), 'rolling');
    near(long.ratio!, 1);
    expect(long.valid).toBe(true);
    expect(acwr(Array.from({ length: 35 }, (_, i) => (i >= 28 ? 100 : 50)), 'uncoupled').ratio).toBe(2);
    expect(acwr([]).ratio).toBeNull();
  });

  it('h) auto seed from the first 7 days', () => {
    near(autoSeed(LOADS.slice(0, 7)), 58.5714);
    expect(autoSeed([])).toBe(0);
    const s = buildFitnessSeries({ dailyLoad: toMap(LOADS.slice(0, 7)), from: D0, to: addDays(D0, 6), today: addDays(D0, 6), seed: 'auto' });
    near(s[0].form, 0); // F = A = seed going into day 1
    const k = ewmaWeight(42);
    near(s[0].fitness, 58.5714 + (100 - 58.5714) * k);
  });
});

describe('fitness series: seeds, ranges, projection', () => {
  it('iterates history before `from` and outputs only [from, to]', () => {
    const s = buildFitnessSeries({ dailyLoad: toMap(LOADS), from: addDays(D0, 10), to: addDays(D0, 13), today: addDays(D0, 13) });
    expect(s.map((d) => d.date)).toEqual([addDays(D0, 10), addDays(D0, 11), addDays(D0, 12), addDays(D0, 13)]);
    near(s[3].fitness, 15.2873);
  });

  it('explicit seed resets state at the end of its date', () => {
    const s = buildFitnessSeries({
      dailyLoad: {},
      from: D0,
      to: addDays(D0, 2),
      today: addDays(D0, 2),
      seed: { date: addDays(D0, -1), fitness: 50, fatigue: 60 },
    });
    near(s[0].form, -10);
    near(s[0].formPct!, -20);
    expect(s[0].formZone).toBe('productive');
    near(s[0].fitness, 50 * (1 - ewmaWeight(42)));
  });

  it('projects future days from planned load; today = done + planned', () => {
    const today = addDays(D0, 1);
    const s = buildFitnessSeries({
      dailyLoad: { [D0]: 100, [today]: 40 },
      plannedLoad: { [D0]: 999, [today]: 60, [addDays(D0, 2)]: 80 },
      from: D0,
      to: addDays(D0, 3),
      today,
    });
    const k = ewmaWeight(42);
    const f0 = 100 * k;
    const f1 = f0 + (100 - f0) * k; // 40 done + 60 planned
    const f2 = f1 + (80 - f1) * k;
    near(s[0].fitness, f0, 1e-9); // past planned ignored
    near(s[1].fitness, f1, 1e-9);
    near(s[2].fitness, f2, 1e-9);
    expect(s.map((d) => d.projected)).toEqual([false, false, true, true]);
    expect(s[1].load).toBe(40);
    expect(s[1].plannedLoad).toBe(60);
  });

  it('empty input and inverted ranges', () => {
    const s = buildFitnessSeries({ dailyLoad: new Map(), from: D0, to: addDays(D0, 8), today: D0 });
    expect(s).toHaveLength(9);
    expect(s.every((d) => d.fitness === 0 && d.formPct === null && d.formZone === null)).toBe(true);
    expect(s[0].ramp).toBeNull(); // no state 7 days earlier
    expect(s[6].ramp).toBe(0); // F[d] − F[d−7] against the 0 seed
    expect(buildFitnessSeries({ dailyLoad: {}, from: D0, to: addDays(D0, -1), today: D0 })).toEqual([]);
  });
});

describe('form zones and ramp bands', () => {
  it('lower-inclusive boundaries', () => {
    expect(formZoneOf(25)).toBe('transition');
    expect(formZoneOf(20)).toBe('transition');
    expect(formZoneOf(5)).toBe('fresh');
    expect(formZoneOf(0)).toBe('neutral');
    expect(formZoneOf(-10)).toBe('neutral');
    expect(formZoneOf(-10.01)).toBe('productive');
    expect(formZoneOf(-30)).toBe('productive');
    expect(formZoneOf(-30.01)).toBe('overreaching');
  });
  it('ramp bands with the stricter table at Fitness ≤ 45', () => {
    expect(rampBand(-1, 60)).toBe('detraining');
    expect(rampBand(5, 60)).toBe('sustainable');
    expect(rampBand(7, 60)).toBe('aggressive');
    expect(rampBand(9, 60)).toBe('high_risk');
    expect(rampBand(4, 40)).toBe('aggressive');
    expect(rampBand(7, 40)).toBe('high_risk');
  });
});
