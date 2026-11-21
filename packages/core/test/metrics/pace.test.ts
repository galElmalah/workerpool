import { describe, expect, it } from 'vitest';
import {
  adjustedSpeedSeries,
  bestEffort,
  bestEfforts,
  fitCriticalSpeed,
  gradeFactor,
  gradeSeries,
  minettiCost,
  MILE_M,
  normalizedSpeed,
  paceLoad,
  paceToSpeed,
  riegelTime,
  runEfficiency,
  speedToPace,
  thresholdSpeedFromEffort,
  vdot,
} from '../../src/metrics';
import { blocks, near } from './helpers';

describe('Minetti grade adjustment', () => {
  it('reference table (§2.2.1, TV-6c)', () => {
    const table: Array<[number, number, number]> = [
      [-0.2, 1.800032, 0.500009],
      [-0.1, 2.151706, 0.597696],
      [-0.05, 2.745924, 0.762757],
      [0, 3.6, 1],
      [0.05, 4.685196, 1.301443],
      [0.1, 5.968214, 1.657837],
      [0.2, 9.006688, 2.501858],
    ];
    for (const [g, cr, f] of table) {
      near(minettiCost(g), cr, 1e-5);
      near(gradeFactor(g), f, 1e-5);
    }
  });
  it('clamps grade to ±45 % and supports an optional downhill floor', () => {
    expect(minettiCost(0.9)).toBe(minettiCost(0.45));
    expect(minettiCost(-0.9)).toBe(minettiCost(-0.45));
    expect(gradeFactor(-0.2, 0.75)).toBe(0.75);
    expect(gradeFactor(NaN)).toBe(1);
  });
  it('grade series from altitude & distance', () => {
    const n = 200;
    const dist = Array.from({ length: n }, (_, i) => i * 3); // 3 m/s
    const alt = dist.map((d) => 100 + 0.05 * d); // 5 % climb
    const g = gradeSeries(alt, dist);
    near(g[100], 0.05, 1e-9);
    // stationary: distance delta < 10 m → previous grade (0 at start)
    const g2 = gradeSeries([100, 101, 102], [0, 0, 0]);
    expect([...g2]).toEqual([0, 0, 0]);
  });
});

describe('Pace Load', () => {
  const thr = 1000 / 240; // 4:00/km
  it('TV-6a constant +5 %', () => {
    const adj = adjustedSpeedSeries(blocks([1800, 3]), blocks([1800, 0.05]));
    near(adj[0], 3.90433, 1e-5);
    const r = paceLoad(adj, thr)!;
    near(r.intensity, 0.937039, 1e-5);
    near(r.load, 43.9021);
  });
  it('TV-6b flat then climb', () => {
    const adj = adjustedSpeedSeries(blocks([900, 3.5], [900, 3]), blocks([900, 0], [900, 0.05]));
    const r = paceLoad(adj, thr)!;
    near(r.normalizedSpeed, 3.718438, 1e-5);
    near(r.intensity, 0.892425, 1e-5);
    near(r.load, 39.8211);
    near(speedToPace(r.normalizedSpeed)!, 268.9, 0.05); // 4:28.9/km
  });
  it('edge cases', () => {
    expect(paceLoad([], thr)).toBeNull();
    expect(paceLoad([3, 3], undefined)).toBeNull();
    expect(normalizedSpeed([])).toBeNull();
    near(normalizedSpeed([3, 4])!, 3.5);
    const adj = adjustedSpeedSeries([3, null, 3] as never);
    expect(Number.isNaN(adj[1])).toBe(true);
    expect(adj[0]).toBe(3);
    near(runEfficiency(3, 150)!, 1.2);
    expect(runEfficiency(3, null)).toBeNull();
    expect(speedToPace(0)).toBeNull();
    near(paceToSpeed(240)!, thr);
  });
});

describe('best efforts', () => {
  it('TV-20 fastest 1000 m inside the 4 m/s block', () => {
    const v = blocks([200, 3], [300, 4], [200, 3]);
    const D = [0];
    for (const s of v) D.push(D[D.length - 1] + s);
    const e = bestEffort(D, 1000)!;
    near(e.timeSec, 250);
    expect(e.startSec).toBeGreaterThanOrEqual(200);
  });
  it('interpolates inside the final second and skips uncovered targets', () => {
    const D = Array.from({ length: 401 }, (_, i) => i * 2.5); // 1000 m at 2.5 m/s
    const all = bestEfforts(D);
    expect(all.map((e) => e.distanceM)).toEqual([400, 1000]);
    near(all[0].timeSec, 160);
    near(all[1].timeSec, 400);
    const D2 = Array.from({ length: 700 }, (_, i) => i * 3);
    near(bestEffort(D2, MILE_M)!.timeSec, MILE_M / 3);
    expect(bestEffort([0, 10], 400)).toBeNull();
    expect(bestEffort([], 400)).toBeNull();
  });
  it('carries missing distance forward and tolerates small decreases', () => {
    // null → 5 (carried), 14 → 15 (clamped): 10 m covered from index 2 to 3 in 1 s
    const D = [0, 5, null, 15, 14, 20, 25] as never;
    near(bestEffort(D, 10)!.timeSec, 1);
    near(bestEffort(D, 20)!.timeSec, 4);
  });
});

describe('performance models', () => {
  it('TV-14 Riegel, threshold pace, VDOT', () => {
    near(riegelTime(2700, 10000, 21097.5), 5957.2883);
    near(riegelTime(2700, 10000, 42195), 12420.5382);
    const v = thresholdSpeedFromEffort(5000, 1200)!;
    near(v * 3600, 14095.6269);
    near(1000 / v, 255.3984);
    const d = vdot(5000, 1200)!;
    near(d.vo2, 47.4645);
    near(d.pctMax, 0.952983, 1e-5);
    near(d.vdot, 49.8062);
    expect(vdot(0, 100)).toBeNull();
    expect(thresholdSpeedFromEffort(5000, 0)).toBeNull();
  });
  it('critical speed fit', () => {
    // D = 4.0·t + 200 exactly
    const efforts = [180, 420, 900, 1200].map((t) => ({ timeSec: t, distanceM: 4 * t + 200 }));
    const f = fitCriticalSpeed(efforts)!;
    near(f.cs, 4, 1e-9);
    near(f.dPrime, 200, 1e-6);
    expect(fitCriticalSpeed([{ timeSec: 300, distanceM: 1000 }])).toBeNull();
  });
});
