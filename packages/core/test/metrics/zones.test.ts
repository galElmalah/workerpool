import { describe, expect, it } from 'vitest';
import {
  autoIntensity,
  classifyDistribution,
  HR_ZONES_COGGAN,
  HR_ZONES_FRIEL_BIKE,
  HR_ZONES_FRIEL_RUN,
  intensityBucket,
  intensityLevelSeconds,
  PACE_ZONES_FRIEL,
  polarizationIndex,
  POWER_ZONES_COGGAN,
  resolveZones,
  ROW_ZONES,
  SWIM_ZONES_CSS,
  threeZoneSeconds,
  timeInZones,
  zoneDisplayRanges,
  zoneIndex,
} from '../../src/metrics';
import { blocks, near } from './helpers';

const rng = (r: ReturnType<typeof zoneDisplayRanges>) => r.map((z) => [z.low, z.high]);

describe('zone tables', () => {
  it('TV-13 Friel bike / run and Coggan 5 from LTHR 165', () => {
    expect(rng(zoneDisplayRanges(HR_ZONES_FRIEL_BIKE, 165))).toEqual([
      [null, 133], [134, 148], [149, 155], [156, 164], [165, 169], [170, 176], [177, null],
    ]);
    expect(rng(zoneDisplayRanges(HR_ZONES_FRIEL_RUN, 165))).toEqual([
      [null, 140], [141, 148], [149, 156], [157, 164], [165, 169], [170, 176], [177, null],
    ]);
    expect(rng(zoneDisplayRanges(HR_ZONES_COGGAN, 165))).toEqual([
      [null, 113], [114, 138], [139, 156], [157, 174], [175, null],
    ]);
    const z = resolveZones(HR_ZONES_FRIEL_BIKE, 165)!;
    expect(zoneIndex(148.5, z.lows)).toBe(2); // Z3
    expect(zoneIndex(148, z.lows)).toBe(1); // Z2
    expect(zoneIndex(null, z.lows)).toBe(-1);
  });
  it('power Coggan 7 and Friel pace speed fractions', () => {
    expect(POWER_ZONES_COGGAN.bounds).toEqual([0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5]);
    const expected = [0, 0.7752, 0.8772, 0.9434, 1, 1.0309, 1.1111];
    PACE_ZONES_FRIEL.bounds.forEach((b, i) => near(b, expected[i], 1e-4));
    // boundary speed belongs to the faster zone
    const z = resolveZones(PACE_ZONES_FRIEL, 4)!;
    expect(zoneIndex(4, z.lows)).toBe(4);
  });
  it('swim CSS example: CSS 1:45/100 m', () => {
    const z = resolveZones(SWIM_ZONES_CSS, 100 / 105)!;
    near(z.lows[1], 0.8857, 1e-4);
    near(z.lows[3], 0.9429, 1e-4);
    near(z.lows[4], 0.9714, 1e-4);
  });
  it('rowing scheme B against the rowing threshold', () => {
    const p2k = 400;
    const z = resolveZones(ROW_ZONES, 0.75 * p2k)!;
    [0, 0.45, 0.6, 0.7, 0.8, 1.05].forEach((f, i) => near(z.lows[i], f * p2k, 1e-9));
  });
  it('resolveZones requires a threshold', () => {
    expect(resolveZones(POWER_ZONES_COGGAN, undefined)).toBeNull();
    expect(resolveZones(POWER_ZONES_COGGAN, 0)).toBeNull();
  });
});

describe('time in zones', () => {
  it('counts seconds, skips missing samples, reports absolute bounds', () => {
    const z = resolveZones(POWER_ZONES_COGGAN, 200)!;
    const t = timeInZones([0, 100, 120, 200, 400, null, NaN] as never, z);
    expect(t.map((x) => x.seconds)).toEqual([2, 1, 0, 1, 0, 0, 1]);
    expect(t[0]).toMatchObject({ zone: 1, name: 'Active Recovery', low: null });
    near(t[0].high!, 110, 1e-9);
    expect(t[6]).toMatchObject({ zone: 7, low: 300, high: null });
    expect(timeInZones([], z).every((x) => x.seconds === 0)).toBe(true);
  });
  it('3-zone seconds and buckets', () => {
    expect(threeZoneSeconds([100, 160, 199, 200, 300], 200, 'power')).toEqual({ easy: 1, moderate: 2, hard: 2 });
    expect(threeZoneSeconds([100], 0, 'hr')).toEqual({ easy: 0, moderate: 0, hard: 0 });
    expect(intensityBucket('tempo')).toBe('moderate');
    expect(intensityBucket('race')).toBe('hard');
  });
});

describe('distribution', () => {
  it('TV-15 polarization index & classification', () => {
    near(polarizationIndex(0.8, 0.05, 0.15)!, 2.3802);
    expect(classifyDistribution(0.8, 0.05, 0.15)).toBe('polarized');
    near(polarizationIndex(0.75, 0.2, 0.05)!, 1.273);
    expect(classifyDistribution(0.75, 0.2, 0.05)).toBe('pyramidal');
    near(polarizationIndex(0.8, 0, 0.2)!, 3.1818);
    expect(classifyDistribution(0.8, 0, 0.2)).toBe('polarized');
    expect(classifyDistribution(0.3, 0.5, 0.2)).toBe('threshold');
  });
  it('accepts seconds, handles ties and empties', () => {
    near(polarizationIndex(8000, 500, 1500)!, 2.3802);
    expect(classifyDistribution(0.2, 0.3, 0.5)).toBe('high_intensity');
    expect(classifyDistribution(0.5, 0.5, 0)).toBe('mixed');
    expect(classifyDistribution(0, 0, 0)).toBe('mixed');
    expect(polarizationIndex(1, 0, 0)).toBeNull();
    // z1 > z3 > z2 but PI ≤ 2 → not polarized
    expect(classifyDistribution(0.4, 0.29, 0.31)).toBe('mixed');
  });
});

describe('auto intensity (product.md §4.3)', () => {
  const lv = (ftp: number, series: number[]) => intensityLevelSeconds(series, ftp, 'power');
  it('time-in-level rules', () => {
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3000, 150], [300, 300])) }).intensity).toBe('high');
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3000, 150], [700, 250])) }).intensity).toBe('threshold');
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3000, 150], [1000, 210])) }).intensity).toBe('tempo');
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3600, 160])) }).intensity).toBe('endurance');
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3600, 100])) }).intensity).toBe('recovery');
    expect(autoIntensity({ levelSeconds: lv(250, blocks([3600, 100])), intensityFactor: 0.62 }).intensity).toBe('endurance');
    // 8 % of moving time in L5 on a short session
    const r = autoIntensity({ levelSeconds: lv(250, blocks([1000, 150], [100, 300])), movingSec: 1100 });
    expect(r.intensity).toBe('high');
    expect(r.reason).toMatch(/above threshold/);
  });
  it('falls back to RPE, then IF, then default', () => {
    expect(autoIntensity({ rpe: 7 }).intensity).toBe('threshold');
    expect(autoIntensity({ intensityFactor: 0.8 }).intensity).toBe('tempo');
    expect(autoIntensity({ intensityFactor: 0.5 }).intensity).toBe('recovery');
    expect(autoIntensity({}).intensity).toBe('endurance');
    expect(autoIntensity({ fallback: 'recovery' })).toEqual({ intensity: 'recovery', reason: 'default' });
    expect(autoIntensity({ levelSeconds: [0, 0, 0, 0, 0], rpe: 3 }).intensity).toBe('endurance');
  });
});
