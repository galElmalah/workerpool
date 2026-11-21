import { describe, expect, it } from 'vitest';
import type { Threshold, WellnessDay } from '../../src/domain';
import {
  bodyMassTrend,
  defaultThresholds,
  estimateThresholds,
  hrvBaseline,
  hrvNormalRange,
  hrvStatus,
  lookupThreshold,
  readiness,
  resolveThresholds,
  restingHrTrend,
  sleepShort,
} from '../../src/metrics';
import { addDays } from '../../src/time';
import { near } from './helpers';

const T = (kind: Threshold['kind'], sport: Threshold['sport'], value: number, effectiveFrom: string, id = `${kind}-${sport}-${effectiveFrom}`): Threshold => ({
  id,
  kind,
  sport,
  value,
  effectiveFrom,
  source: 'manual',
});

describe('resolveThresholds', () => {
  const list: Threshold[] = [
    T('ftp', 'bike', 250, '2026-01-01'),
    T('ftp', 'bike', 265, '2026-06-01'),
    T('lthr', 'all', 165, '2026-01-01'),
    T('lthr', 'run', 172, '2026-03-01'),
    T('hr_max', 'all', 190, '2025-01-01'),
    T('hr_rest', 'all', 48, '2025-01-01'),
    T('run_threshold', 'run', 4.2, '2026-02-01'),
    T('swim_css', 'swim', 1.2, '2026-02-01'),
    T('row_threshold', 'row', 240, '2026-02-01'),
    T('weight', 'all', 70, '2026-01-01'),
  ];
  it('effective-dated lookup, inclusive', () => {
    expect(resolveThresholds(list, '2026-05-31', 'bike').ftp).toBe(250);
    expect(resolveThresholds(list, '2026-06-01', 'bike').ftp).toBe(265);
    expect(resolveThresholds(list, '2025-12-31', 'bike').ftp).toBeUndefined();
  });
  it('sport-specific LTHR falls back to all', () => {
    expect(resolveThresholds(list, '2026-04-01', 'run').lthr).toBe(172);
    expect(resolveThresholds(list, '2026-02-01', 'run').lthr).toBe(165);
    expect(resolveThresholds(list, '2026-04-01', 'bike').lthr).toBe(165);
  });
  it('full snapshot', () => {
    expect(resolveThresholds(list, '2026-07-01', 'swim')).toEqual({
      ftp: 265,
      runThresholdMps: 4.2,
      swimCssMps: 1.2,
      rowThresholdW: 240,
      lthr: 165,
      hrMax: 190,
      hrRest: 48,
      weightKg: 70,
    });
  });
  it('same-day duplicates resolve deterministically; empty list', () => {
    const dup = [T('ftp', 'bike', 200, '2026-01-01', 'a'), T('ftp', 'bike', 210, '2026-01-01', 'b')];
    expect(lookupThreshold(dup, 'ftp', 'bike', '2026-01-02')!.value).toBe(210);
    expect(resolveThresholds([], '2026-01-01', 'run')).toEqual({});
  });
  it('cold-start defaults', () => {
    const d = defaultThresholds({}, { sport: 'bike', age: 40 });
    expect(d.snapshot).toEqual({ hrMax: 180, hrRest: 60, lthr: 0.87 * 180, ftp: 175 });
    expect(d.defaulted).toEqual(['hrMax', 'hrRest', 'lthr', 'ftp']);
    expect(defaultThresholds({ weightKg: 80 }, { sport: 'run' }).snapshot).toMatchObject({ hrMax: 185, lthr: 0.9 * 185, ftp: 200 });
    expect(defaultThresholds({ hrMax: 200 }, { sport: 'swim' }).snapshot.lthr).toBe(170);
    expect(resolveThresholds(list, '2026-07-01', 'run', { defaults: true }).lthr).toBe(172);
    expect(resolveThresholds([], '2026-07-01', 'run', { defaults: true }).runThresholdMps).toBeUndefined();
  });
});

describe('estimateThresholds (suggestions)', () => {
  it('derives suggestions from curves and efforts', () => {
    const s = estimateThresholds({
      bikePowerCurve: [{ durationSec: 1200, value: 300 }, { durationSec: 3600, value: 270 }],
      rowEfforts: [{ distanceM: 2000, timeSec: 390 }],
      runEfforts: [{ distanceM: 5000, timeSec: 1200 }, { distanceM: 1000, timeSec: 200 }],
      swimEfforts: [{ distanceM: 200, timeSec: 190 }, { distanceM: 400, timeSec: 400 }],
      hrCurves: { run: [{ durationSec: 1200, value: 175 }] },
      maxHrSamples: [188, 192, 240],
      restingHr: [52, 49, 51],
    });
    const by = (k: string) => s.find((x) => x.kind === k)!;
    near(by('ftp').value, 285);
    near(by('row_threshold').value, 283.2145);
    near(by('run_threshold').value, 14095.6269 / 3600); // 1 k effort (< 12 min) ignored
    near(by('swim_css').value, 0.952381, 1e-6);
    expect(by('hr_max').value).toBe(192);
    expect(by('hr_rest').value).toBe(49);
    expect(by('lthr')).toMatchObject({ sport: 'run' });
    near(by('lthr').value, 166.25);
    expect(estimateThresholds({})).toEqual([]);
  });
});

describe('wellness', () => {
  const date = '2026-03-31';
  const hrv7 = [62, 58, 65, 55, 60, 52, 50];
  const days: WellnessDay[] = hrv7.map((h, i) => ({ date: addDays(date, i - 6), hrvMs: h }));

  it('TV-22 HRV baseline and normal range', () => {
    const b = hrvBaseline(days, date);
    near(b.b7!, 4.046701, 1e-6);
    near(b.b7Ms!, 57.21, 0.01);
    near(b.cv7!, 2.345);
    expect(b.m60).toBeNull(); // < 14 values
    expect(b.status).toBeNull();
    const r = hrvNormalRange(4.1, 0.12);
    near(r.low, 4.04, 1e-9);
    near(r.high, 4.16, 1e-9);
    expect(hrvStatus(b.b7!, r.low, r.high)).toBe('normal');
    expect(hrvStatus(3.9, r.low, r.high)).toBe('suppressed');
    expect(hrvStatus(4.2, r.low, r.high)).toBe('elevated');
  });

  it('baseline needs ≥ 4 values; first record of a day wins', () => {
    expect(hrvBaseline(days.slice(0, 3), addDays(date, -4)).b7).toBeNull();
    const dup = [{ date, hrvMs: 50 }, { date, hrvMs: 90 }, ...days.slice(0, 6)];
    near(hrvBaseline(dup, date).b7!, 4.046701, 1e-6);
  });

  it('60-day range and status with enough history', () => {
    const long: WellnessDay[] = Array.from({ length: 60 }, (_, i) => ({ date: addDays(date, i - 59), hrvMs: i >= 53 ? 40 : i % 2 ? 60 : 70 }));
    const b = hrvBaseline(long, date);
    expect(b.m60).not.toBeNull();
    expect(b.status).toBe('suppressed');
  });

  it('resting HR trend', () => {
    const d: WellnessDay[] = Array.from({ length: 60 }, (_, i) => ({ date: addDays(date, i - 59), restingHr: i >= 53 ? 58 : 50 + (i % 2) }));
    const r = restingHrTrend(d, date);
    expect(r.elevated).toBe(true);
    expect(restingHrTrend([], date)).toEqual({ rhr7: null, rhr60: null, sd60: null, elevated: null });
  });

  it('sleep and body mass', () => {
    expect(sleepShort([{ date, sleepSec: 5.5 * 3600 }], date).short).toBe(true);
    const ok = [0, 1, 2].map((i) => ({ date: addDays(date, -i), sleepSec: 7.5 * 3600 }));
    expect(sleepShort(ok, date).short).toBe(false);
    expect(sleepShort([], date).short).toBeNull();
    const w = Array.from({ length: 28 }, (_, i) => ({ date: addDays(date, i - 27), weightKg: 70 + i * (0.5 / 7) }));
    const m = bodyMassTrend(w, date);
    near(m.kgPerWeek!, 0.5, 1e-9);
    near(m.mass7!, 70 + (24 * 0.5) / 7, 1e-9);
    expect(bodyMassTrend([], date)).toEqual({ mass7: null, kgPerWeek: null });
  });

  it('readiness heuristic counts flags and lists inputs', () => {
    const g = readiness([{ date, sleepSec: 8 * 3600 }], date, { formPct: -5 });
    expect(g).toMatchObject({ state: 'green', reasons: [], inputs: ['sleep', 'form'] });
    expect(g.label).toMatch(/Heuristic/);
    expect(readiness([{ date, sleepSec: 5 * 3600 }], date).state).toBe('amber');
    const r = readiness([{ date, sleepSec: 5 * 3600, soreness: 4 }], date, { formPct: -40 });
    expect(r.state).toBe('red');
    expect(r.reasons).toHaveLength(3);
    expect(readiness([], date)).toMatchObject({ state: 'green', inputs: [] });
  });
});
