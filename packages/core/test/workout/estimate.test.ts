import { describe, expect, it } from 'vitest';
import type { Step, Target, WorkoutStructure } from '../../src/domain';
import {
  DEFAULT_THRESHOLDS,
  derivePlannedTotals,
  estimateStep,
  estimateUnstructured,
  estimateWorkout,
  parseWorkoutText,
  profileSparkline,
  resolveTargetIntensity,
} from '../../src/workout';

const step = (measure: Step['measure'], target?: Target, extra: Partial<Step> = {}): Step => ({
  kind: 'step',
  id: Math.random().toString(36),
  role: 'active',
  measure,
  ...(target ? { target } : {}),
  ...extra,
});
const pct = (low: number, high = low): Target => ({ type: 'power_pct', low, high });

describe('resolveTargetIntensity', () => {
  const th = { ftp: 250, lthr: 170, runThresholdMps: 1000 / 240, swimCssMps: 1, rowThresholdW: 200 };
  it('power targets', () => {
    expect(resolveTargetIntensity(pct(95, 100), 'bike', th)).toMatchObject({ ifLow: 0.95, ifHigh: 1, ifMid: 0.975, level: 4, source: 'target' });
    expect(resolveTargetIntensity({ type: 'power_w', low: 200, high: 300 }, 'bike', th)).toMatchObject({ ifLow: 0.8, ifHigh: 1.2, ifMid: 1 });
    const d = resolveTargetIntensity({ type: 'power_w', low: 250, high: 250 }, 'bike', {});
    expect(d.ifMid).toBeCloseTo(250 / DEFAULT_THRESHOLDS.ftp);
    expect(d.usedDefaults).toBe(true);
    expect(resolveTargetIntensity({ type: 'power_w', low: 200, high: 200 }, 'row', th).ifMid).toBe(1);
  });
  it('HR targets map %LTHR through the documented table', () => {
    expect(resolveTargetIntensity({ type: 'hr_pct_lthr', low: 90, high: 90 }, 'run', th).ifMid).toBeCloseTo(0.76);
    expect(resolveTargetIntensity({ type: 'hr_pct_lthr', low: 100, high: 100 }, 'bike', th).ifMid).toBeCloseTo(1);
    const z2 = resolveTargetIntensity({ type: 'hr_zone', zone: 2 }, 'run', th);
    expect(z2.ifMid).toBeCloseTo(0.66); // 85.5 % LTHR
    expect(z2.level).toBe(2);
    expect(resolveTargetIntensity({ type: 'hr_zone', zone: 5 }, 'run', th).level).toBe(5);
    expect(resolveTargetIntensity({ type: 'hr_bpm', low: 153, high: 153 }, 'run', th).ifMid).toBeCloseTo(0.76); // 90 %
    // no LTHR: 0.9 × HRmax
    expect(resolveTargetIntensity({ type: 'hr_bpm', low: 162, high: 162 }, 'run', { hrMax: 200 }).ifMid).toBeCloseTo(0.76);
  });
  it('pace targets per sport', () => {
    expect(resolveTargetIntensity({ type: 'pace', lowMps: 1000 / 240, highMps: 1000 / 240 }, 'run', th).ifMid).toBeCloseTo(1);
    expect(resolveTargetIntensity({ type: 'pace', lowMps: 0.95, highMps: 1.05 }, 'swim', th)).toMatchObject({ ifLow: 0.95, ifHigh: 1.05 });
    // row: 1:45/500 m = 302.34 W (Concept2) vs 200 W threshold
    const row = resolveTargetIntensity({ type: 'pace', lowMps: 500 / 105, highMps: 500 / 105 }, 'row', th);
    expect(row.ifMid).toBeCloseTo(302.34 / 200, 3);
    expect(resolveTargetIntensity({ type: 'pace_pct', low: 95, high: 100 }, 'run', th).ifMid).toBeCloseTo(0.975);
    expect(resolveTargetIntensity({ type: 'pace_pct', low: 100, high: 100 }, 'row', th).ifMid).toBeCloseTo(1);
    expect(resolveTargetIntensity({ type: 'pace_pct', low: 90, high: 90 }, 'row', th).ifMid).toBeCloseTo(0.729);
  });
  it('RPE uses product.md §4.4 table, swim converts to a CSS fraction', () => {
    expect(resolveTargetIntensity({ type: 'rpe', low: 7, high: 7 }, 'bike', {}).ifMid).toBeCloseTo(0.88);
    expect(resolveTargetIntensity({ type: 'rpe', low: 6, high: 8 }, 'bike', {})).toMatchObject({ ifLow: 0.82, ifHigh: 0.95, level: 4 });
    expect(resolveTargetIntensity({ type: 'rpe', low: 7.5, high: 7.5 }, 'run', {}).ifMid).toBeCloseTo(0.915);
    const sw = resolveTargetIntensity({ type: 'rpe', low: 8, high: 8 }, 'swim', {});
    expect(Math.pow(sw.ifMid, 3)).toBeCloseTo(0.95 * 0.95); // same load as IF 0.95 on land
  });
  it('ramp, open, cadence and missing targets', () => {
    const r = resolveTargetIntensity({ type: 'ramp', basis: 'power_pct', from: 75, to: 50 }, 'bike', {});
    expect(r).toMatchObject({ rampFrom: 0.75, rampTo: 0.5, ifLow: 0.5, ifHigh: 0.75, ifMid: 0.625 });
    expect(resolveTargetIntensity({ type: 'open' }, 'bike', {}, 'recovery')).toMatchObject({ ifMid: 0.5, source: 'role_default' });
    expect(resolveTargetIntensity(undefined, 'bike', {}, 'rest').ifMid).toBe(0);
    expect(resolveTargetIntensity({ type: 'cadence', low: 90, high: 95 }, 'bike', {}, 'warmup').ifMid).toBe(0.6);
    expect(resolveTargetIntensity(undefined, 'run', {}, 'active').ifMid).toBe(0.8);
  });
});

describe('estimateStep', () => {
  it('time step: load = h × IF² × 100', () => {
    const e = estimateStep(step({ type: 'time', sec: 3600 }, pct(100)), 'bike', {});
    expect(e.durationSec).toBe(3600);
    expect(e.load).toBeCloseTo(100);
    expect(e.durationEstimated).toBe(false);
  });
  it('ramp integrates IF² linearly: 10′ 50→70 % = 6.0556', () => {
    const e = estimateStep(step({ type: 'time', sec: 600 }, { type: 'ramp', basis: 'power_pct', from: 50, to: 70 }), 'bike', {});
    expect(e.load).toBeCloseTo(((0.25 + 0.35 + 0.49) / 3) * 100 / 6, 6);
  });
  it('run distance from target pace and from % threshold speed', () => {
    const th = { runThresholdMps: 1000 / 240 };
    const a = estimateStep(step({ type: 'distance', m: 1000 }, { type: 'pace', lowMps: 1000 / 300, highMps: 1000 / 300 }), 'run', th);
    expect(a.durationSec).toBeCloseTo(300);
    expect(a.load).toBeCloseTo((300 / 3600) * 0.64 * 100);
    expect(a.distanceM).toBe(1000);
    expect(a.durationEstimated).toBe(true);
    const b = estimateStep(step({ type: 'distance', m: 1000 }, { type: 'pace_pct', low: 100, high: 100 }), 'run', th);
    expect(b.durationSec).toBeCloseTo(240);
    expect(b.load).toBeCloseTo(6.667, 2);
  });
  it('row distance at a split: 2000 m at 1:45/500 m = 420 s, IF from Concept2 watts', () => {
    const e = estimateStep(step({ type: 'distance', m: 2000 }, { type: 'pace', lowMps: 500 / 105, highMps: 500 / 105 }), 'row', { rowThresholdW: 200 });
    expect(e.durationSec).toBeCloseTo(420);
    expect(e.load).toBeCloseTo((420 / 3600) * Math.pow(302.34 / 200, 2) * 100, 1);
  });
  it('swim: send-off, rest, IF³ on moving time', () => {
    const th = { swimCssMps: 1 };
    const a = estimateStep(step({ type: 'distance', m: 100 }, { type: 'pace_pct', low: 100, high: 100 }, { swim: { sendOffSec: 110 } }), 'swim', th);
    expect(a).toMatchObject({ durationSec: 110, movingSec: 100 });
    expect(a.load).toBeCloseTo((100 / 3600) * 100);
    const b = estimateStep(step({ type: 'distance', m: 100 }, { type: 'pace_pct', low: 80, high: 80 }, { swim: { restSec: 20 } }), 'swim', th);
    expect(b.movingSec).toBeCloseTo(125);
    expect(b.durationSec).toBeCloseTo(145);
    expect(b.load).toBeCloseTo((125 / 3600) * 0.512 * 100);
    // open kick is slower than open free
    const kick = estimateStep(step({ type: 'distance', m: 100 }, undefined, { swim: { stroke: 'kick' } }), 'swim', th);
    const free = estimateStep(step({ type: 'distance', m: 100 }, undefined, { swim: { stroke: 'free' } }), 'swim', th);
    expect(kick.durationSec).toBeGreaterThan(free.durationSec);
  });
  it('strength: sets × (reps × 4 s + rest), RPE load', () => {
    const e = estimateStep(
      step({ type: 'reps', n: 6 }, undefined, { strength: { exercise: 'Back squat', sets: 4, reps: 6, rpe: 8, restSec: 120 } }),
      'strength',
      {},
    );
    expect(e.durationSec).toBe(4 * (24 + 120));
    expect(e.load).toBeCloseTo((576 / 3600) * 0.95 * 0.95 * 100);
    const d = estimateStep(step({ type: 'time', sec: 45 }, undefined, { strength: { exercise: 'Plank', sets: 3, durationSec: 45 } }), 'strength', {});
    expect(d.durationSec).toBe(3 * (45 + 90)); // default rest 90 s
    expect(d.intensity.ifMid).toBeCloseTo(0.82); // default RPE 6
  });
  it('lap button uses role defaults; rest steps carry no load', () => {
    expect(estimateStep(step({ type: 'lap_button' }), 'run', {}).durationSec).toBe(300);
    expect(estimateStep({ ...step({ type: 'lap_button' }), role: 'warmup' }, 'run', {}).durationSec).toBe(600);
    expect(estimateStep({ ...step({ type: 'time', sec: 60 }), role: 'rest' }, 'bike', {}).load).toBe(0);
  });
});

describe('estimateWorkout', () => {
  // 20′ WU @ 60 %, 2×20′ @ 100 %, 20′ CD @ 60 %
  const s: WorkoutStructure = {
    steps: [
      { ...step({ type: 'time', sec: 1200 }, pct(60)), role: 'warmup' },
      { kind: 'repeat', id: 'R', count: 2, steps: [step({ type: 'time', sec: 1200 }, pct(100))] },
      { ...step({ type: 'time', sec: 1200 }, pct(60)), role: 'cooldown' },
    ],
  };
  it('2×20′ @ 100 % + 20′ WU/CD @ 60 %: 80 min, load 90.67, IF 0.8246', () => {
    const e = estimateWorkout(s, 'bike', { ftp: 250 });
    expect(e.durationSec).toBe(4800);
    // 40′ @ 1.00 → 66.667 ; 40′ @ 0.60 → 0.667 h × 0.36 × 100 = 24.0
    expect(e.load).toBeCloseTo(66.6667 + 24, 3);
    expect(e.intensityFactor).toBeCloseTo(Math.sqrt(90.6667 / 133.3333), 4);
    expect(e.timeByZoneLevel).toEqual([0, 2400, 0, 2400, 0]);
    expect(e.profile).toHaveLength(4);
    expect(e.profile.map((b) => b.startSec)).toEqual([0, 1200, 2400, 3600]);
    expect(e.profile[1]).toMatchObject({ isRepeatChild: true, repeatId: 'R', iteration: 0, level: 4, intensity: 1, role: 'active' });
    expect(e.profile[2].iteration).toBe(1);
    expect(e.profile.reduce((a, b) => a + b.load, 0)).toBeCloseTo(e.load);
    expect(e.distanceM).toBeGreaterThan(30000); // flat-road estimate
    expect(e.estimated).toBe(false);
  });
  it('sparkline: 48 bars, WU/CD 0.5, main 0.833', () => {
    const sp = profileSparkline(s, 'bike', {}, 48);
    expect(sp).toHaveLength(48);
    expect(sp[0]).toBeCloseTo(0.5);
    expect(sp[11]).toBeCloseTo(0.5);
    expect(sp[12]).toBeCloseTo(0.833, 3);
    expect(sp[35]).toBeCloseTo(0.833, 3);
    expect(sp[47]).toBeCloseTo(0.5);
    expect(profileSparkline({ steps: [] }, 'bike')).toEqual([]);
  });
  it('sparkline follows ramps', () => {
    const sp = profileSparkline({ steps: [step({ type: 'time', sec: 600 }, { type: 'ramp', basis: 'power_pct', from: 0, to: 120 })] }, 'bike', {}, 4);
    expect(sp).toEqual([0.125, 0.375, 0.625, 0.875]);
  });
  it('swim workout IF uses moving time and IF³', () => {
    const sw = parseWorkoutText(`4x\n  - 100m css on 1:50`, 'swim').structure;
    const e = estimateWorkout(sw, 'swim', { swimCssMps: 1 });
    expect(e.durationSec).toBeCloseTo(440);
    expect(e.movingSec).toBeCloseTo(400);
    expect(e.distanceM).toBeCloseTo(400);
    expect(e.load).toBeCloseTo((400 / 3600) * 100);
    expect(e.intensityFactor).toBeCloseTo(1);
  });
  it('flags default thresholds and estimated durations', () => {
    const run = parseWorkoutText(`- 5km 4:30/km`, 'run').structure;
    const e = estimateWorkout(run, 'run', {});
    expect(e.durationSec).toBeCloseTo(1350);
    expect(e.estimated).toBe(true);
    expect(e.usedDefaults).toBe(true);
    expect(estimateWorkout(run, 'run', { runThresholdMps: 4 }).usedDefaults).toBe(false);
  });
  it('strength workouts have no distance', () => {
    const st = parseWorkoutText('Back squat 4x6 rpe8 r2m', 'strength').structure;
    expect(estimateWorkout(st, 'strength', {}).distanceM).toBeUndefined();
  });
});

describe('estimateUnstructured', () => {
  it('uses the label session IF', () => {
    expect(estimateUnstructured(3600, 'endurance', 'bike').load).toBeCloseTo(46.24);
    expect(estimateUnstructured(3600, 'threshold', 'run').load).toBeCloseTo(77.44);
    expect(estimateUnstructured(1800, 'recovery', 'bike').load).toBeCloseTo(0.5 * 0.3025 * 100);
  });
  it('race IF depends on duration; swim cubes; strength uses RPE', () => {
    const r = estimateUnstructured(7200, 'race', 'run');
    expect(r.intensityFactor).toBeCloseTo(Math.pow(0.5, 0.1));
    expect(r.load).toBeCloseTo(2 * Math.pow(0.5, 0.2) * 100);
    expect(estimateUnstructured(3600, 'race', 'bike').intensityFactor).toBeCloseTo(1);
    expect(estimateUnstructured(3600, 'endurance', 'swim').load).toBeCloseTo(Math.pow(0.88, 3) * 100);
    expect(estimateUnstructured(3600, 'tempo', 'strength').load).toBeCloseTo(0.82 * 0.82 * 100);
    expect(estimateUnstructured(3600, 'tempo', 'strength', { rpe: 8 }).load).toBeCloseTo(0.95 * 0.95 * 100);
  });
  it('derives duration from distance when missing', () => {
    const u = estimateUnstructured(undefined, 'endurance', 'swim', { distanceM: 3000, thresholds: { swimCssMps: 1 } });
    expect(u.durationSec).toBeCloseTo(3000 / 0.88);
    expect(u.distanceM).toBe(3000);
  });
});

describe('derivePlannedTotals', () => {
  it('rounds structured totals', () => {
    const s = parseWorkoutText('- 15m 60%\n2x\n  - 20m 100%\n  - 5m 50%\n- 10m 50%', 'bike').structure;
    const t = derivePlannedTotals({ sport: 'bike', intensity: 'threshold', structure: s }, { ftp: 250 });
    expect(t.plannedDurationSec).toBe(4500);
    expect(t.plannedLoad).toBeCloseTo(9 + 66.7 + 4.2 + 4.2, 0);
  });
  it('falls back to the unstructured model', () => {
    const t = derivePlannedTotals({ sport: 'run', intensity: 'endurance', plannedDurationSec: 3600 }, {});
    expect(t).toMatchObject({ plannedDurationSec: 3600, plannedLoad: 46.2, plannedIntensityFactor: 0.68 });
  });
});
