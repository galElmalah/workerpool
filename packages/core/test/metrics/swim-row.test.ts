import { describe, expect, it } from 'vitest';
import {
  c2SpeedToWatts,
  c2SplitToWatts,
  c2WattsToSplit,
  criticalSwimSpeed,
  ergPowerFromSpeed,
  p2kFromTime,
  powerLoad,
  rowThresholdFromP2k,
  swimBestEfforts,
  swimLoad,
} from '../../src/metrics';
import { blocks, near } from './helpers';

describe('swim', () => {
  it('TV-7 CSS and Swim Load', () => {
    const css = criticalSwimSpeed(400, 190)!;
    near(css, 0.952381, 1e-6);
    near(100 / css, 105); // 1:45.0/100 m
    const a = swimLoad({ distanceM: 2000, movingSec: 2400, elapsedSec: 2700, cssMps: css })!;
    near(a.speedMps, 0.833333, 1e-6);
    near(a.intensity, 0.875, 1e-6);
    near(a.load, 44.6615);
    expect(a.restUnknown).toBe(false);
    const b = swimLoad({ distanceM: 2000, movingSec: 2400, elapsedSec: 2700, cssMps: css, mode: 'elapsed' })!;
    near(b.intensity, 0.777778, 1e-6);
    near(b.load, 35.2881);
  });
  it('flags unknown rest and rejects invalid inputs', () => {
    const r = swimLoad({ distanceM: 2000, elapsedSec: 2700, cssMps: 1 })!;
    expect(r.restUnknown).toBe(true);
    expect(swimLoad({ distanceM: 0, movingSec: 100, cssMps: 1 })).toBeNull();
    expect(swimLoad({ distanceM: 100, movingSec: 100, cssMps: undefined })).toBeNull();
    expect(swimLoad({ distanceM: 100, cssMps: 1 })).toBeNull();
    expect(criticalSwimSpeed(190, 400)).toBeNull(); // swapped
    expect(criticalSwimSpeed(400, 210)).toBeNull(); // 200 not faster per metre
  });
  it('pool best efforts over contiguous active lengths', () => {
    const L = (t: number, rest = false) => ({ distanceM: rest ? 0 : 25, durationSec: t, isRest: rest });
    const lengths = [L(20), L(20), L(30, true), L(18), L(17), L(19), L(18)];
    const e = swimBestEfforts(lengths, [50, 100, 200]);
    expect(e).toEqual([
      { distanceM: 50, timeSec: 35, startSec: 70 },
      { distanceM: 100, timeSec: 72, startSec: 70 },
    ]);
    expect(swimBestEfforts([], [50])).toEqual([]);
  });
});

describe('row (Concept2)', () => {
  it('TV-9 conversions and load', () => {
    near(c2SplitToWatts(120)!, 202.5463);
    near(c2SplitToWatts(125)!, 179.2);
    near(c2SplitToWatts(105)!, 302.3432);
    near(c2WattsToSplit(202.5463)!, 120);
    // steady 2:05/500 m = 4 m/s, per-second conversion before normalization
    const p = ergPowerFromSpeed(blocks([1800, 4]));
    near(p[0], 179.2);
    const r = powerLoad(p, 200)!;
    near(r.intensity, 0.896);
    near(r.load, 40.1408);
    const p2k = p2kFromTime(390)!;
    near(p2k, 377.6193);
    const ftp = rowThresholdFromP2k(p2k);
    near(ftp, 283.2145);
    near(c2WattsToSplit(ftp)!, 107.3, 0.05);
  });
  it('edge cases', () => {
    expect(c2SplitToWatts(0)).toBeNull();
    expect(c2WattsToSplit(-1)).toBeNull();
    expect(c2SpeedToWatts(0)).toBe(0);
    expect(Number.isNaN(ergPowerFromSpeed([null] as never)[0])).toBe(true);
  });
});
