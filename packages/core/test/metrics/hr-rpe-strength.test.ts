import { describe, expect, it } from 'vitest';
import {
  bestE1rmByExercise,
  durationLoad,
  e1rmBrzycki,
  e1rmEpley,
  edwardsTrimp,
  estimate1RM,
  hrLoad,
  hrLoadFromAverage,
  hrZoneLoad,
  plannedLoadFromIntensity,
  raceIntensity,
  rpeIntensity,
  rpeIntensityClass,
  rpeLoad,
  rpePointsPerHour,
  sessionRpe,
  tanakaHrMax,
  trimpConstants,
  trimpLt1h,
  volumeLoad,
} from '../../src/metrics';
import { blocks, near } from './helpers';

const base = { hrRest: 50, hrMax: 190, lthr: 170 };

describe('HR Load (HRSS)', () => {
  it('TV-4a male 60 min @ 150', () => {
    const r = hrLoad(blocks([3600, 150]), { ...base, sex: 'male' })!;
    near(r.trimp, 108.0954);
    near(trimpLt1h({ ...base, sex: 'male' }), 170.6511);
    near(r.load, 63.3429);
  });
  it('TV-4b female', () => {
    const r = hrLoad(blocks([3600, 150]), { ...base, sex: 'female' })!;
    near(r.trimp, 121.4991);
    near(trimpLt1h({ ...base, sex: 'female' }), 185.0821);
    near(r.load, 65.646);
  });
  it('TV-4c per-sample vs average-HR shortcut', () => {
    const r = hrLoad(blocks([1800, 140], [1800, 165]), { ...base, sex: 'male' })!;
    near(r.load, 69.5924);
    near(hrLoadFromAverage(152.5, 3600, { ...base, sex: 'male' })!.load, 67.1911);
  });
  it('TV-4d one hour at LTHR = 100 for any sex', () => {
    for (const sex of ['male', 'female', 'unspecified'] as const) near(hrLoad(blocks([3600, 170]), { ...base, sex })!.load, 100);
  });
  it('unspecified sex averages the constants', () => {
    expect(trimpConstants('unspecified')).toEqual({ a: 0.75, b: 1.795 });
    expect(trimpConstants(undefined)).toEqual({ a: 0.75, b: 1.795 });
  });
  it('edge cases: missing samples, invalid params, clamping', () => {
    expect(hrLoad([150], { hrRest: 50, hrMax: 190 })).toBeNull();
    expect(hrLoad([150], { hrRest: 60, hrMax: 50, lthr: 55 })).toBeNull();
    const r = hrLoad([null, NaN, 170] as never, { ...base, sex: 'male' })!;
    expect(r.validSec).toBe(1);
    near(r.load, 100 / 3600, 1e-9);
    // below rest clamps to 0, above max clamps to 1
    expect(hrLoad([30], { ...base, sex: 'male' })!.load).toBe(0);
    near(hrLoad([250], { ...base })!.load, hrLoad([190], { ...base })!.load, 1e-12);
    expect(hrLoad([], { ...base })!.load).toBe(0);
    expect(hrLoadFromAverage(0, 3600, base)).toBeNull();
  });
  it('TV-5 zone-time method', () => {
    near(hrZoneLoad([1200, 1800, 0, 600]), 51.6667);
    expect(hrZoneLoad([])).toBe(0);
  });
  it('TV-18 Edwards TRIMP', () => {
    const hr = blocks([600, 110], [1200, 130], [1200, 150], [600, 170]);
    near(edwardsTrimp(hr, 200)!, 150);
    expect(edwardsTrimp(hr, 0)).toBeNull();
  });
  it('Tanaka HRmax', () => {
    near(tanakaHrMax(40), 180);
  });
});

describe('RPE load and duration estimates', () => {
  it('TV-8 session RPE', () => {
    near(sessionRpe(7, 2700), 315);
    near(rpeLoad(7, 2700), 60);
    near(rpePointsPerHour(6.5), 75);
    near(rpeLoad(6.5, 2700), 56.25);
  });
  it('table anchors and interpolation', () => {
    near(rpeLoad(8, 3600), 100);
    near(rpeIntensity(8), 1);
    near(rpeIntensity(4), 0.7071);
    expect(rpePointsPerHour(12)).toBe(140);
    expect(rpePointsPerHour(-1)).toBe(0);
    expect(rpePointsPerHour(NaN)).toBe(0);
    expect(rpeLoad(0, 3600)).toBe(0);
    expect(rpeLoad(5, 0)).toBe(0);
    near(rpeLoad(7, 3600, 0.5), 40);
    expect(rpeIntensityClass(2)).toBe('recovery');
    expect(rpeIntensityClass(4)).toBe('endurance');
    expect(rpeIntensityClass(6)).toBe('tempo');
    expect(rpeIntensityClass(7)).toBe('threshold');
    expect(rpeIntensityClass(10)).toBe('high');
  });
  it('duration × intensity-class estimate', () => {
    near(durationLoad('bike', 3600), 50);
    near(durationLoad('yoga', 1800), 10);
    near(durationLoad('strength', 3600, 'threshold'), 64);
    expect(durationLoad('run', 0)).toBe(0);
  });
  it('TV-17 label-only planned load and race IF', () => {
    near(plannedLoadFromIntensity(5400, 'endurance'), 69.36);
    near(raceIntensity(7200), 0.933);
    near(raceIntensity(4 * 3600), 0.8706);
    near(raceIntensity(10 * 3600), 0.7943);
    near(raceIntensity(3600), 1);
    near(raceIntensity(600), 1.05);
    near(plannedLoadFromIntensity(3600, 'race'), 100);
    expect(plannedLoadFromIntensity(0, 'tempo')).toBe(0);
  });
});

describe('strength', () => {
  it('TV-16 e1RM and volume', () => {
    near(e1rmEpley(100, 5), 116.6667);
    near(e1rmBrzycki(100, 5)!, 112.5);
    expect(volumeLoad([{ sets: 3, reps: 5, weightKg: 100 }])).toBe(1500);
  });
  it('edge cases', () => {
    expect(e1rmEpley(100, 1)).toBe(100);
    expect(e1rmBrzycki(100, 1)).toBe(100);
    expect(e1rmBrzycki(100, 37)).toBeNull();
    expect(estimate1RM(100, 13)).toBeNull();
    expect(estimate1RM(undefined, 5)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
    expect(volumeLoad([{ reps: 10 }, { reps: 5, weightKg: 50, isRest: true }, { reps: 5, weightKg: 20 }])).toBe(100);
    expect(volumeLoad([])).toBe(0);
    const best = bestE1rmByExercise([
      { index: 0, exercise: 'squat', reps: 5, weightKg: 100 },
      { index: 1, exercise: 'squat', reps: 3, weightKg: 110 },
      { index: 2, exercise: 'bench', reps: 20, weightKg: 60 },
    ]);
    near(best.get('squat')!, 121);
    expect(best.has('bench')).toBe(false);
  });
});
