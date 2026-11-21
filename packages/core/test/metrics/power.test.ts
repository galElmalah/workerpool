import { describe, expect, it } from 'vitest';
import {
  cpPredict,
  criticalPowerTwoPoint,
  curveAt,
  decoupling,
  efficiencyFactor,
  estimateFtp,
  fitCriticalPower,
  intensityFactor,
  loadFromIntensity,
  meanMaximal,
  meanPower,
  mergeCurves,
  MMP_DURATIONS,
  powerLoad,
  vo2maxFromPower,
  weightedPower,
  workKj,
  wPrimeBalance,
} from '../../src/metrics';
import { blocks, near, now, rng } from './helpers';

describe('weighted power & power load', () => {
  it('TV-1 constant power', () => {
    const p = blocks([3600, 200]);
    const r = powerLoad(p, 250)!;
    near(r.weightedPower, 200);
    near(r.intensity, 0.8);
    near(r.load, 64);
    near(r.variability!, 1);
    near(r.workKj, 720);
    expect(r.wpFallback).toBe(false);
  });

  it('TV-2 short series uses full windows only', () => {
    const p = blocks([30, 100], [30, 300]);
    near(weightedPower(p), 223.0695);
    const r = powerLoad(p, 250)!;
    near(r.meanPower, 200);
    near(r.variability!, 1.1153);
    near(r.intensity, 0.8923);
    near(r.load, 1.3269);
  });

  it('TV-3 variable 1 h ride', () => {
    const p: number[] = [];
    for (let k = 0; k < 4; k++) p.push(...blocks([300, 300], [600, 150]));
    const r = powerLoad(p, 250)!;
    near(r.weightedPower, 233.2275);
    near(r.meanPower, 200);
    near(r.variability!, 1.1661);
    near(r.intensity, 0.9329);
    near(r.load, 87.0321);
    near(r.workKj, 720);
  });

  it('TV-17 planned structured workout through the same routine', () => {
    const p = blocks([600, 150]);
    for (let k = 0; k < 3; k++) p.push(...blocks([480, 262.5], [240, 125]));
    p.push(...blocks([600, 125]));
    expect(p.length).toBe(3360);
    const r = powerLoad(p, 250)!;
    near(r.weightedPower, 216.5646);
    near(r.meanPower, 188.3929);
    near(r.intensity, 0.8663);
    near(r.load, 70.0377);
  });

  it('property: constant power → WP = power, VI = 1, for many levels', () => {
    for (const w of [0.5, 37, 150, 333.3, 1200]) {
      const p = blocks([1000, w]);
      near(weightedPower(p), w, 1e-9 * Math.max(1, w));
    }
  });

  it('property: WP ≥ mean power; load scales linearly with duration at fixed IF', () => {
    const r = rng(7);
    const p = Array.from({ length: 5000 }, () => 100 + 250 * r());
    expect(weightedPower(p)!).toBeGreaterThanOrEqual(meanPower(p)!);
    near(loadFromIntensity(7200, 0.8), 2 * loadFromIntensity(3600, 0.8), 1e-9);
  });

  it('edge cases: short / empty / missing / zeros', () => {
    expect(weightedPower([])).toBeNull();
    expect(weightedPower(blocks([29, 200]))).toBeNull();
    const short = powerLoad(blocks([20, 200]), 250)!;
    expect(short.wpFallback).toBe(true);
    near(short.weightedPower, 200);
    expect(powerLoad([], 250)).toBeNull();
    expect(powerLoad([100, 200], undefined)).toBeNull();
    expect(powerLoad([100, 200], 0)).toBeNull();
    // null/NaN samples count as 0 W
    near(meanPower([100, null, NaN, 300] as never)!, 100);
    const zeros = powerLoad(blocks([100, 0]), 250)!;
    expect(zeros.load).toBe(0);
    expect(zeros.variability).toBeNull();
    expect(intensityFactor(200, null)).toBeNull();
    expect(efficiencyFactor(200, 0)).toBeNull();
    near(efficiencyFactor(200, 140)!, 1.428571);
    near(workKj([1000, 1000, null] as never), 2);
  });
});

describe('decoupling', () => {
  it('TV-21', () => {
    const p = blocks([1800, 200], [1800, 200]);
    const hr = blocks([1800, 140], [1800, 147]);
    near(decoupling(p, hr), 4.7619);
  });
  it('ignores samples without HR and returns null when undefined', () => {
    expect(decoupling([], [])).toBeNull();
    expect(decoupling([200, 200], [0, 0])).toBeNull();
    near(decoupling([200, 999, 200, 200], [140, 0, 140, 140])!, 0);
  });
});

describe('mean-maximal curve', () => {
  it('TV-19', () => {
    const c = meanMaximal([100, 200, 300, 400, 300, 200, 100]);
    const expected = [400, 350, 333.3333, 300, 280, 250, 228.5714];
    expect(c.map((p) => p.durationSec)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    c.forEach((p, i) => near(p.value, expected[i]));
    expect(c[0].startSec).toBe(3);
  });

  it('ladder follows the spec step rules', () => {
    expect(MMP_DURATIONS[0]).toBe(1);
    expect(MMP_DURATIONS[MMP_DURATIONS.length - 1]).toBe(18000);
    expect(MMP_DURATIONS).toContain(65);
    expect(MMP_DURATIONS).toContain(1230);
    expect(MMP_DURATIONS).toContain(3660);
    expect(MMP_DURATIONS).not.toContain(61);
    for (let i = 1; i < MMP_DURATIONS.length; i++) expect(MMP_DURATIONS[i]).toBeGreaterThan(MMP_DURATIONS[i - 1]);
  });

  it('exact curve need not be monotone; merged curve is; long durations omitted', () => {
    // Counter-example to "exact MMPs are non-increasing": 3 s beats 2 s here.
    const tiny = meanMaximal([10, 0, 10]);
    expect(tiny[2].value).toBeGreaterThan(tiny[1].value);
    const r = rng(1);
    const p = Array.from({ length: 2000 }, () => 300 * r());
    const c = meanMaximal(p);
    const m = mergeCurves([{ points: c }]);
    for (let i = 1; i < m.length; i++) expect(m[i].value).toBeLessThanOrEqual(m[i - 1].value);
    for (const pt of c) expect(pt.value).toBeLessThanOrEqual(c[0].value);
    expect(c[c.length - 1].durationSec).toBeLessThanOrEqual(2000);
    expect(meanMaximal([])).toEqual([]);
  });

  it("'skip' mode ignores windows that contain missing samples", () => {
    const hr = [150, 160, NaN, 170, 171];
    const c = meanMaximal(hr, [1, 2, 3], { missing: 'skip' });
    near(curveAt(c, 2)!, 170.5);
    expect(curveAt(c, 3)).toBeNull();
  });

  it('merges curves pointwise with a monotone backward pass', () => {
    const a = { id: 'a', points: [{ durationSec: 1, value: 500 }, { durationSec: 60, value: 300 }] };
    const b = { id: 'b', points: [{ durationSec: 1, value: 450 }, { durationSec: 5, value: 280 }, { durationSec: 60, value: 320 }] };
    const m = mergeCurves([a, b]);
    expect(m.map((p) => [p.durationSec, p.value, p.sourceId])).toEqual([
      [1, 500, 'a'],
      [5, 320, 'b'],
      [60, 320, 'b'],
    ]);
  });

  it('performance: 5 h at 1 Hz over the full ladder is fast', () => {
    const r = rng(42);
    const n = 5 * 3600;
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) p[i] = 150 + 150 * r() + (i % 600 < 60 ? 250 : 0);
    meanMaximal(p.subarray(0, 3000)); // warm-up JIT
    const t0 = now();
    const c = meanMaximal(p);
    const ms = now() - t0;
    expect(c.length).toBe(MMP_DURATIONS.length);
    // Target < 150 ms; generous bound for slow CI machines.
    expect(ms).toBeLessThan(750);
  });
});

describe('critical power, W′ balance, estimates', () => {
  const pts = [
    { durationSec: 180, value: 400 },
    { durationSec: 420, value: 330 },
    { durationSec: 1200, value: 290 },
  ];
  it('TV-11 OLS fit', () => {
    const f = fitCriticalPower(pts)!;
    near(f.cp, 270.0633);
    near(f.wPrime, 24162.03, 0.01);
    expect(f.valid).toBe(true);
    near(cpPredict(f.cp, f.wPrime, 180), 404.2968);
    near(cpPredict(f.cp, f.wPrime, 420), 327.5919);
    near(cpPredict(f.cp, f.wPrime, 1200), 290.1983);
    near(cpPredict(f.cp, f.wPrime, 300), 350.6034);
    near(cpPredict(f.cp, f.wPrime, 3600), 276.775);
    near(criticalPowerTwoPoint(180, 400, 1200, 290)!, 270.5882);
  });
  it('rejects non-physical fits and ignores points outside 120–1200 s', () => {
    expect(fitCriticalPower([{ durationSec: 60, value: 600 }, { durationSec: 3600, value: 250 }])).toBeNull();
    const bad = fitCriticalPower([
      { durationSec: 180, value: 300 },
      { durationSec: 1200, value: 400 },
    ])!;
    expect(bad.valid).toBe(false);
    expect(criticalPowerTwoPoint(100, 1, 100, 2)).toBeNull();
  });
  it('TV-12 W′ balance differential form', () => {
    const w = wPrimeBalance(blocks([60, 400], [60, 200]), 280, 20000);
    near(w[59], 12800);
    near(w[119], 14339.0046);
    expect(Math.min(...w)).toBe(12800);
  });
  it('eFTP = max(0.95 × MMP20, MMP60)', () => {
    expect(estimateFtp([{ durationSec: 1200, value: 300 }])).toEqual({ value: 285, basis: '0.95x20min' });
    expect(estimateFtp([{ durationSec: 1200, value: 300 }, { durationSec: 3600, value: 290 }])).toEqual({ value: 290, basis: '60min' });
    expect(estimateFtp([])).toBeNull();
  });
  it('TV-23 VO2max from 5-min power', () => {
    near(vo2maxFromPower(350, 70)!, 61.0);
    expect(vo2maxFromPower(350, 0)).toBeNull();
  });
});
