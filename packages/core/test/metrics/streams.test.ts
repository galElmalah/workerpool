import { describe, expect, it } from 'vitest';
import { effortSparkline, lttb, prepareStreams, rollingMean, SPARKLINE_BUCKETS } from '../../src/metrics';
import { near } from './helpers';

describe('prepareStreams', () => {
  it('sorts, dedupes (keep last) and resamples irregular samples to 1 Hz', () => {
    const p = prepareStreams({ t: [4, 0, 2, 2], power: [400, 100, 999, 300] }, { sport: 'bike' });
    expect([...p.elapsed.t]).toEqual([0, 1, 2, 3, 4]);
    expect([...p.elapsed.power!]).toEqual([100, 200, 300, 350, 400]);
    expect(p.elapsedSec).toBe(4);
    expect(p.movingSec).toBe(5);
    expect(p.timerSec).toBe(5);
  });

  it('gaps > 10 s are pauses: power 0 / HR missing in elapsed, excluded from active', () => {
    const p = prepareStreams({ t: [0, 1, 2, 20, 21], power: [200, 200, 200, 300, 300], hr: [120, 121, 122, 130, 131] }, { sport: 'bike' });
    expect(p.elapsed.t.length).toBe(22);
    expect(p.elapsed.paused[3]).toBe(1);
    expect(p.elapsed.paused[19]).toBe(1);
    expect(p.elapsed.paused[20]).toBe(0);
    expect(p.elapsed.power![10]).toBe(0);
    expect(Number.isNaN(p.elapsed.hr![10])).toBe(true);
    expect([...p.active.power!]).toEqual([200, 200, 200, 300, 300]);
    expect(p.timerSec).toBe(5);
    expect(p.movingSec).toBe(5);
  });

  it('a 10 s gap is interpolated, not paused', () => {
    const p = prepareStreams({ t: [0, 10], power: [100, 200] }, { sport: 'bike' });
    expect(p.movingSec).toBe(11);
    near(p.active.power![5], 150);
  });

  it('invalid values become missing and are interpolated inside short gaps', () => {
    const t = Array.from({ length: 30 }, (_, i) => i);
    const power = t.map((i) => (i === 5 ? 3000 : i === 6 ? -5 : 200));
    const hr = t.map((i) => (i < 20 ? 140 : 300)); // last 10 s invalid, no right neighbour
    const p = prepareStreams({ t, power, hr }, { sport: 'bike' });
    expect(p.active.power![5]).toBe(200);
    expect(p.active.power![6]).toBe(200);
    expect(Number.isNaN(p.active.hr![25])).toBe(true);
    expect(p.active.hr![10]).toBe(140);
  });

  it('removes ≥ 60 s stops (zero power, no speed) for cycling; keeps short coasting', () => {
    const n = 300;
    const t = Array.from({ length: n }, (_, i) => i);
    const power = t.map((i) => (i >= 100 && i < 170 ? 0 : i >= 200 && i < 230 ? 0 : 200));
    const speed = t.map((i) => (i >= 100 && i < 170 ? 0 : 8));
    const p = prepareStreams({ t, power, speed }, { sport: 'bike' });
    expect(p.movingSec).toBe(n - 70);
    expect(p.timerSec).toBe(n);
    // without speed, zero power alone defines the stop
    expect(prepareStreams({ t, power }, { sport: 'bike' }).movingSec).toBe(n - 70);
  });

  it('running: samples below 0.5 m/s are stopped; speed derived from distance if absent', () => {
    const t = Array.from({ length: 100 }, (_, i) => i);
    const distance = t.map((i) => (i < 50 ? i * 3 : 147)); // stands still after 50 s
    const p = prepareStreams({ t, distance }, { sport: 'run' });
    expect(p.elapsed.speed).toBeDefined();
    expect(p.movingSec).toBe(50);
  });

  it('distance is clamped monotonic; speed caps per sport', () => {
    const p = prepareStreams({ t: [0, 1, 2, 3], distance: [0, 10, 5, 20], speed: [3, 13, 3, 3] }, { sport: 'run' });
    expect([...p.elapsed.distance!]).toEqual([0, 10, 10, 20]);
    near(p.elapsed.speed![1], 3);
  });

  it('explicit timer pauses', () => {
    const t = Array.from({ length: 20 }, (_, i) => i);
    const p = prepareStreams({ t, power: t.map(() => 100) }, { sport: 'bike', pauses: [[5, 10]] });
    expect(p.timerSec).toBe(15);
    expect(p.elapsed.power![7]).toBe(0);
  });

  it('never throws on empty / garbage input', () => {
    expect(prepareStreams(null).movingSec).toBe(0);
    expect(prepareStreams({ t: [] }).movingSec).toBe(0);
    expect(prepareStreams({ t: [NaN, NaN] }).movingSec).toBe(0);
    const p = prepareStreams({ t: [0, 1, 2], power: [null, null, null], hr: [] }, { sport: 'bike' });
    expect(p.movingSec).toBe(3);
    expect(p.active.power).toBeUndefined();
    expect(p.active.hr).toBeUndefined();
  });
});

describe('series helpers', () => {
  it('rollingMean trailing and centred, ignoring NaN', () => {
    expect([...rollingMean([1, 2, 3, 4], 2)]).toEqual([1, 1.5, 2.5, 3.5]);
    expect([...rollingMean([1, 2, 3, 4, 5], 3, 'centered')]).toEqual([1.5, 2, 3, 4, 4.5]);
    expect([...rollingMean([1, null, 3] as never, 2)]).toEqual([1, 1, 3]);
    expect(Number.isNaN(rollingMean([null] as never, 3)[0])).toBe(true);
  });

  it('lttb keeps endpoints, returns n points, preserves peaks', () => {
    const x = Array.from({ length: 1000 }, (_, i) => i);
    const y = x.map((i) => (i === 500 ? 100 : Math.sin(i / 50)));
    const d = lttb(x, y, 50);
    expect(d.x.length).toBe(50);
    expect(d.x[0]).toBe(0);
    expect(d.x[49]).toBe(999);
    expect(d.y).toContain(100);
    for (let i = 1; i < d.x.length; i++) expect(d.x[i]).toBeGreaterThan(d.x[i - 1]);
    expect(lttb([1, 2], [3, 4], 10)).toEqual({ x: [1, 2], y: [3, 4] });
    expect(lttb([1, 2, 3], [1, null, 3] as never, 5)).toEqual({ x: [1, 3], y: [1, 3] });
    expect(lttb(x, y, 0)).toEqual({ x: [], y: [] });
    expect(lttb(x, y, 2).x).toEqual([0, 999]);
  });

  it('effortSparkline: 48 buckets in 0..1 from power, HR fallback, [] without data', () => {
    const t = Array.from({ length: 4800 }, (_, i) => i);
    const s = effortSparkline({ t, power: t.map((i) => (i < 2400 ? 100 : 200)) }, 'bike');
    expect(s).toHaveLength(SPARKLINE_BUCKETS);
    near(s[0], 0.5);
    expect(s[47]).toBe(1);
    const h = effortSparkline({ t, hr: t.map((i) => 120 + i / 100) }, 'run');
    expect(h).toHaveLength(48);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...h)).toBe(1);
    expect(effortSparkline({ t: [0, 1, 2] }, 'bike')).toEqual([]);
    expect(effortSparkline(null, 'bike')).toEqual([]);
    expect(effortSparkline({ t: [0, 1, 2], power: [100, 100, 100] }, 'bike')).toHaveLength(3);
  });
});
