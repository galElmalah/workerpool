import { describe, expect, it } from 'vitest';
import type { ActivityStreams, Lap } from '../../src/domain';
import { ActivityDetail, ActivityFacts } from '../../src/domain';
import { elevationLossOf, enrichLaps, mergeFacts, streamFacts, sustainedGrade } from '../../src/metrics';

const ramp = (n: number, f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i));

describe('elevationLossOf', () => {
  it('sums descents with a 2 m hysteresis and ignores nulls', () => {
    expect(elevationLossOf([100, 99, 98, 97, null, 96, 100, 90])).toBe(14);
    expect(elevationLossOf([100, 101, 100.5, 101.5])).toBe(0); // jitter under 2 m
    expect(elevationLossOf([null, null])).toBeUndefined();
    expect(elevationLossOf(undefined)).toBeUndefined();
  });
});

describe('sustainedGrade', () => {
  it('finds the steepest climb and descent over a distance window', () => {
    // 0–1000 m flat, 1000–1500 m +8 %, 1500–2000 m −5 %
    const d = ramp(2001, (i) => i);
    const a = d.map((x) => (x! <= 1000 ? 100 : x! <= 1500 ? 100 + (x! - 1000) * 0.08 : 140 - (x! - 1500) * 0.05));
    const g = sustainedGrade(d, a, 200)!;
    expect(g.max).toBeCloseTo(8, 0);
    expect(g.min).toBeCloseTo(-5, 0);
  });
  it('needs enough distance', () => {
    expect(sustainedGrade([0, 10, 20], [1, 2, 3])).toBeUndefined();
  });
});

describe('streamFacts', () => {
  const s: ActivityStreams = {
    t: [0, 1, 2, 3, 10, 11, 12, 13, 30, 31],
    hr: [null, 110, 120, 130, 140, 150, 0, 145, 140, 135],
    speed: [0, 3, 3.5, 4, 4.2, 5.1, 4, 4, 3, 2],
    cadence: [0, 80, 85, 90, 92, 95, 0, 88, 86, 84],
    altitude: [100, 102, 104, 106, 104, 101, 99, 98, 97, 96],
    temp: [10, 10, 11, 11, 12, 12, 13, 13, 14, 14],
    lat: [null, 41.98, 41.981, 41.982, 41.983, 41.984, 41.985, 41.986, 41.987, null],
    lng: [null, 2.82, 2.821, 2.822, 2.823, 2.824, 2.825, 2.826, 2.827, null],
  };
  it('derives pauses, position, elevation range, temperature and maxima', () => {
    const f = streamFacts(s, { sport: 'bike' });
    expect(f.pauseCount).toBe(2);
    expect(f.pausedSec).toBe(6 + 16);
    expect([f.startLat, f.startLng]).toEqual([41.98, 2.82]);
    expect([f.endLat, f.endLng]).toEqual([41.987, 2.827]);
    expect(f.minAltitudeM).toBe(96);
    expect(f.maxAltitudeM).toBe(106);
    expect(f.elevationLossM).toBe(9); // the last 1 m step is under the hysteresis
    expect(f.avgTempC).toBe(12);
    expect([f.minTempC, f.maxTempC]).toEqual([10, 14]);
    expect(f.maxCadence).toBe(95);
    expect(f.maxSpeedMps).toBe(5.1);
    expect(f.minHr).toBe(110);
    expect(f.totalStrokes).toBeUndefined();
    expect(ActivityFacts.safeParse(f).success).toBe(true);
  });
  it('gives nothing for missing channels', () => {
    expect(streamFacts({ t: [0, 1, 2], hr: [100, 101, 102] }, { sport: 'strength' })).toEqual({ minHr: 100 });
    expect(streamFacts(null, { sport: 'run' })).toEqual({});
  });
  it('counts rowing strokes and distance per stroke from the stroke rate', () => {
    const n = 600;
    const rs: ActivityStreams = { t: ramp(n, (i) => i) as number[], cadence: ramp(n, () => 24), distance: ramp(n, (i) => i * 4) };
    const f = streamFacts(rs, { sport: 'row' });
    expect(f.totalStrokes).toBe(240);
    expect(f.avgDistancePerStrokeM).toBeCloseTo((599 * 4) / 240, 2);
  });
  it('does not report a swim max speed (pool speed is per length)', () => {
    expect(streamFacts({ t: [0, 1], speed: [1, 1.2] }, { sport: 'swim' }).maxSpeedMps).toBeUndefined();
  });
});

describe('enrichLaps', () => {
  const s: ActivityStreams = {
    t: ramp(20, (i) => i) as number[],
    power: ramp(20, (i) => (i < 10 ? 100 + i : 300 + i)),
    speed: ramp(20, (i) => (i < 10 ? 8 : 10)),
    altitude: ramp(20, (i) => (i < 10 ? 100 : 100 - (i - 9) * 3)),
    temp: ramp(20, () => 15),
  };
  const laps: Lap[] = [
    { index: 0, startSec: 0, durationSec: 10 },
    { index: 1, startSec: 10, durationSec: 10, maxPower: 999 },
  ];
  it('fills missing per-lap maxima and keeps device values', () => {
    const out = enrichLaps(laps, s, { sport: 'bike' });
    expect(out[0]!.maxPower).toBe(109);
    expect(out[0]!.maxSpeedMps).toBe(8);
    expect(out[1]!.maxPower).toBe(999);
    expect(out[1]!.elevationLossM).toBeGreaterThan(20);
    expect(out[0]!.avgTempC).toBe(15);
    expect(laps[0]!.maxPower).toBeUndefined(); // input untouched
  });
  it('is a no-op without streams', () => {
    expect(enrichLaps(laps, null, { sport: 'bike' })).toEqual(laps);
  });
});

describe('mergeFacts', () => {
  it('earlier sources win; empty values are skipped', () => {
    expect(mergeFacts({ avgTempC: 12, sensors: [] }, { avgTempC: 14, minTempC: 9, sensors: [{ kind: 'Heart rate' }] }, undefined)).toEqual({
      avgTempC: 12,
      minTempC: 9,
      sensors: [{ kind: 'Heart rate' }],
    });
  });
});

describe('ActivityDetail schema', () => {
  it('accepts the new optional detail fields and still accepts payloads without them', () => {
    const base = {
      id: 'act_1', source: 'garmin', startedAt: '2026-11-21T08:00:00Z', utcOffsetMin: 60, localDate: '2026-11-21', sport: 'run', title: 'Run',
      durationSec: 3600, movingSec: 3500, load: 50, loadSource: 'pace', intensityAuto: 'endurance', intensity: 'endurance', isKey: false, tags: [],
      hasStreams: true, createdAt: '2026-11-21T09:00:00Z', updatedAt: '2026-11-21T09:00:00Z', laps: [], zones: {}, peaks: {}, thresholdsUsed: {},
    };
    expect(ActivityDetail.safeParse(base).success).toBe(true);
    const rich = { ...base, locationName: 'Girona', facts: { avgGroundContactMs: 240, deviceName: 'Forerunner 965' }, swimLengths: [{ index: 0, startSec: 0, durationSec: 30 }] };
    expect(ActivityDetail.safeParse(rich).success).toBe(true);
  });
});
