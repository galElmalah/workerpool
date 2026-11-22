import { beforeAll, describe, expect, it } from 'vitest';
import { ActivityFacts, Lap, SwimLength } from '@cadence/core/domain';
import { deviceFacts, garminProductName, leftBalancePct, parseFit } from '../../src/fit';
import { mapActivitySummary } from '../../src/mapping';
import { activityDetail, activityListItem } from '../../src/mock/wire';
import { encodeFit, generateActivityDetail, generateAthlete } from '../../src/synth';
import type { SynthActivity, SynthAthlete } from '../../src/synth/types';

let athlete: SynthAthlete;
const last = (f: (a: SynthActivity) => boolean) => [...athlete.activities].reverse().find(f)!;

beforeAll(() => {
  athlete = generateAthlete({ today: '2026-11-21', months: 2 });
});

describe('synthetic athlete detail extras', () => {
  it('outdoor sessions have a Girona-area place name and start position; indoor ones have neither', () => {
    const names = new Set(athlete.activities.filter((a) => a.hasGps).map((a) => a.locationName));
    expect(names.has('Girona')).toBe(true);
    for (const n of names) expect(['Girona', 'Banyoles', "Castell-Platja d'Aro", 'Queralbs', 'Quart', 'Lisboa']).toContain(n);
    for (const a of athlete.activities.filter((x) => !x.hasGps)) {
      expect(a.locationName).toBeUndefined();
      expect(a.startLat).toBeUndefined();
    }
    const ride = last((a) => a.sport === 'bike' && a.hasGps);
    expect(ride.startLat).toBeCloseTo(41.98, 1);
  });

  it('runs carry running dynamics in a plausible range', () => {
    for (const r of athlete.activities.filter((a) => a.sport === 'run' && a.avgSpeedMps! > 2)) {
      expect(r.avgGroundContactMs).toBeGreaterThan(180);
      expect(r.avgGroundContactMs).toBeLessThan(340);
      expect(r.avgVerticalOscillationCm).toBeGreaterThan(6);
      expect(r.avgVerticalOscillationCm).toBeLessThan(12);
      expect(r.avgStrideLengthM).toBeGreaterThan(0.6);
      expect(r.avgStrideLengthM).toBeLessThan(1.8);
      expect(r.avgVerticalRatioPct).toBeGreaterThan(4);
      expect(r.avgVerticalRatioPct).toBeLessThan(13);
    }
    expect(last((a) => a.sport === 'bike').avgGroundContactMs).toBeUndefined();
  });

  it('elevation range, descent and temperature are consistent', () => {
    for (const a of athlete.activities.filter((x) => x.minElevationM !== undefined)) {
      expect(a.minElevationM!).toBeLessThanOrEqual(a.maxElevationM!);
      expect(a.elevationLossM!).toBeGreaterThanOrEqual(0);
    }
    for (const a of athlete.activities.filter((x) => x.avgTempC !== undefined)) {
      expect(a.minTempC!).toBeLessThanOrEqual(a.avgTempC!);
      expect(a.maxTempC!).toBeGreaterThanOrEqual(a.avgTempC!);
    }
  });
});

describe('FIT → facts round trip', () => {
  it('a run: dynamics, device, HRM, timer, laps with dynamics and maxima, the watch RPE', () => {
    const run = last((a) => a.sport === 'run' && a.hasGps && a.rpe !== undefined);
    const r = parseFit(encodeFit(generateActivityDetail(athlete, run.garminActivityId)));
    const f = r.facts!;
    expect(ActivityFacts.safeParse(f).success).toBe(true);
    expect(f.deviceName).toBe('Forerunner 965');
    expect(f.deviceSoftware).toBe('25.24');
    expect(f.sensors).toEqual([{ kind: 'Heart rate', name: 'HRM-Pro' }]);
    expect(f.avgGroundContactMs).toBe(run.avgGroundContactMs);
    expect(f.avgVerticalOscillationCm).toBeCloseTo(run.avgVerticalOscillationCm!, 1);
    expect(f.avgStrideLengthM).toBeCloseTo(run.avgStrideLengthM!, 2);
    expect(f.avgGroundContactBalanceLeftPct).toBeCloseTo(run.avgGroundContactBalancePct!, 1);
    expect(f.startLat).toBeCloseTo(run.startLat!, 3);
    expect(f.maxCadence).toBeGreaterThan(150);
    expect(f.avgTempC).toBe(run.avgTempC);
    expect(f.elevationLossM).toBe(run.elevationLossM);
    expect(f.sportProfile).toBeTruthy();
    expect(r.rpe).toBe(run.rpe);
    const withDyn = r.laps.filter((l) => l.avgGroundContactMs !== undefined);
    expect(withDyn.length).toBeGreaterThan(0);
    for (const l of r.laps) expect(Lap.safeParse(l).success).toBe(true);
    expect(r.laps.some((l) => l.maxSpeedMps !== undefined && l.elevationLossM !== undefined)).toBe(true);
  });

  it('an outdoor ride: Edge 840, power pedals, left/right balance', () => {
    const ride = last((a) => a.sport === 'bike' && a.hasGps && !!a.avgPower);
    const f = parseFit(encodeFit(generateActivityDetail(athlete, ride.garminActivityId))).facts!;
    expect(f.deviceName).toBe('Edge 840');
    expect(f.sensors?.find((s) => s.kind === 'Power')?.name).toBe('Rally XC200');
    expect(f.powerBalanceLeftPct).toBeCloseTo(ride.powerBalanceLeftPct!, 0);
  });

  it('a pool swim: every length with stroke, strokes, rate and SWOLF', () => {
    const swim = last((a) => a.sport === 'swim' && a.subSport === 'pool');
    const r = parseFit(encodeFit(generateActivityDetail(athlete, swim.garminActivityId)));
    expect(r.swimLengths?.length).toBe(r.facts?.activeLengths);
    for (const l of r.swimLengths!) expect(SwimLength.safeParse(l).success).toBe(true);
    const l = r.swimLengths!.find((x) => x.strokes)!;
    expect(l.swolf).toBe(Math.round(l.strokes! + l.durationSec));
    expect(l.lapIndex).toBeTypeOf('number');
    expect(r.facts?.startLat).toBeUndefined();
  });

  it('an indoor row: stroke count and distance per stroke', () => {
    const row = last((a) => a.sport === 'row');
    const f = parseFit(encodeFit(generateActivityDetail(athlete, row.garminActivityId))).facts!;
    expect(f.totalStrokes).toBeGreaterThan(100);
    expect(f.avgDistancePerStrokeM).toBeGreaterThan(5);
    expect(f.avgDistancePerStrokeM).toBeLessThan(15);
  });

  it('is tolerant: a file without device_info / session extras yields no facts, not errors', () => {
    expect(deviceFacts({})).toEqual({});
    expect(parseFit(new Uint8Array([1, 2, 3])).facts).toBeUndefined();
  });
});

describe('Garmin summary → facts', () => {
  it('maps location, coordinates, elevation range, dynamics and Garmin labels from list items and details', () => {
    const run = last((a) => a.sport === 'run' && a.hasGps);
    for (const json of [activityListItem(run), activityDetail(run, 'Europe/Madrid')]) {
      const n = mapActivitySummary(json);
      expect(n.locationName).toBe(run.locationName);
      expect(n.startLat).toBeCloseTo(run.startLat!, 5);
      expect(n.facts?.minAltitudeM).toBeCloseTo(run.minElevationM!, 1);
      expect(n.facts?.avgStrideLengthM).toBeCloseTo(run.avgStrideLengthM!, 2);
      expect(n.facts?.avgGroundContactMs).toBe(run.avgGroundContactMs);
      expect(n.facts?.trainingEffectLabel).toBe(run.trainingEffectLabel);
      expect(n.facts?.deviceLoad).toBe(run.deviceLoad);
    }
    expect(mapActivitySummary(activityDetail(run, 'Europe/Madrid')).facts?.timezone).toBe('Europe/Madrid');
  });

  it('indoor items carry no location; elevation in cm is converted; unknown labels dropped', () => {
    const n = mapActivitySummary({ activityId: 1, beginTimestamp: 1_700_000_000_000, activityType: { typeKey: 'running' }, minElevation: 12345, maxElevation: 50, trainingEffectLabel: 'UNKNOWN' });
    expect(n.locationName).toBeUndefined();
    expect(n.facts?.minAltitudeM).toBe(123.5);
    expect(n.facts?.maxAltitudeM).toBe(50);
    expect(n.facts?.trainingEffectLabel).toBeUndefined();
  });
});

describe('helpers', () => {
  it('garminProductName', () => {
    expect(garminProductName('fr965')).toBe('Forerunner 965');
    expect(garminProductName('edge840')).toBe('Edge 840');
    expect(garminProductName('fenix7xPro')).toBe('fēnix 7 x Pro');
    expect(garminProductName('hrmPro')).toBe('HRM-Pro');
    expect(garminProductName('4062')).toBeUndefined();
  });
  it('leftBalancePct reads the right-side flag', () => {
    expect(leftBalancePct(0x8000 | 5080)).toBe(49.2);
    expect(leftBalancePct(5080)).toBeUndefined(); // side unknown
    expect(leftBalancePct(undefined)).toBeUndefined();
  });
});
