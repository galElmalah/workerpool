import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { WorkoutStructure } from '@cadence/core/domain';
import {
  EXERCISE_CATALOG,
  buildWorkoutDictionary,
  camelToUpperSnake,
  fromGarminWorkout,
  makeWorkoutTag,
  parseWorkoutTag,
  resolveExercise,
  toGarminWorkout,
  workoutFingerprint,
  type GarminExecutableStep,
  type GarminRepeatGroup,
} from '../src';
import { EXAMPLE_A, EXAMPLE_B, EXAMPLE_C } from './fixtures/workouts';
import { innerRepeat, planned, repeat, step } from './helpers/planned';

const TH = { ftp: 260, runThresholdMps: 4.0, swimCssMps: 1.25, lthr: 172, rowThresholdW: 230 };

const planA = planned(
  { sport: 'run', title: '5x1k @ T pace', description: 'Threshold kilometres', plannedDurationSec: 3300 },
  [
    step({ role: 'warmup', measure: { type: 'time', sec: 900 } }),
    repeat(5, [
      step({ role: 'active', measure: { type: 'distance', m: 1000 }, target: { type: 'pace', lowMps: 1000 / 260, highMps: 1000 / 250 }, cue: '4:20 -> 4:10 /km' }),
      step({ role: 'recovery', measure: { type: 'time', sec: 120 } }),
    ]),
    step({ role: 'cooldown', measure: { type: 'time', sec: 600 } }),
  ],
);

const planB = planned({ sport: 'bike', title: '4x8 sweet spot' }, [
  step({ role: 'warmup', measure: { type: 'time', sec: 600 }, target: { type: 'hr_zone', zone: 2 } }),
  repeat(4, [
    step({ role: 'active', measure: { type: 'time', sec: 480 }, target: { type: 'power_w', low: 250, high: 265 }, secondary: { type: 'cadence', low: 85, high: 95 } }),
    step({ role: 'recovery', measure: { type: 'time', sec: 240 }, target: { type: 'power_pct', low: 40, high: 55 } }),
  ]),
  step({ role: 'cooldown', measure: { type: 'lap_button' } }),
]);

const planC = planned(
  { sport: 'swim', subSport: 'pool', title: 'CSS 8x100', plannedDurationSec: 2700 },
  [
    step({ role: 'warmup', measure: { type: 'distance', m: 400 } }),
    repeat(8, [
      step({ role: 'active', measure: { type: 'distance', m: 100 }, target: { type: 'pace', lowMps: 100 / 83, highMps: 100 / 83 }, swim: { stroke: 'free' } }),
      step({ role: 'rest', measure: { type: 'time', sec: 15 } }),
    ]),
    step({ role: 'active', measure: { type: 'distance', m: 200 }, swim: { stroke: 'free', equipment: ['pull_buoy'] }, cue: 'pull' }),
    step({ role: 'cooldown', measure: { type: 'distance', m: 100 } }),
  ],
  25,
);

describe('toGarminWorkout — golden payloads (garmin.md §5.3)', () => {
  it('A: run, pace range in m/s, repeat group numbering', () => {
    expect(toGarminWorkout(planA, TH)).toStrictEqual(EXAMPLE_A);
  });

  it('B: bike, HR zone, power watts + cadence secondary, lap button cooldown', () => {
    // The domain has no "power zone N" target; %FTP is sent as a custom watt range instead.
    const expected = structuredClone(EXAMPLE_B);
    const rec = expected.workoutSegments[0].workoutSteps[1].workoutSteps[1];
    delete rec.zoneNumber;
    rec.targetValueOne = 104; // 40 % of 260 W
    rec.targetValueTwo = 143; // 55 %
    expect(toGarminWorkout(planB, TH)).toStrictEqual(expected);
  });

  it('C: pool swim, pool length, stroke/equipment ids, CSS offset secondary, rest step', () => {
    expect(toGarminWorkout(planC, TH)).toStrictEqual(EXAMPLE_C);
  });

  it('C via pace_pct and swim.restSec produces the same steps', () => {
    const alt = planned({ sport: 'swim', title: 'CSS 8x100', plannedDurationSec: 2700 }, [
      planC.structure!.steps[0]!,
      repeat(8, [step({ role: 'active', measure: { type: 'distance', m: 100 }, target: { type: 'pace_pct', low: (80 / 83) * 100, high: (80 / 83) * 100 }, swim: { stroke: 'free', restSec: 15 } })]),
      planC.structure!.steps[2]!,
      planC.structure!.steps[3]!,
    ], 25);
    expect(toGarminWorkout(alt, TH)).toStrictEqual(EXAMPLE_C);
  });
});

const steps = (w: ReturnType<typeof toGarminWorkout>) => w.workoutSegments[0]!.workoutSteps;
const exec = (s: unknown) => s as GarminExecutableStep;

describe('targets and conversions', () => {
  it('%FTP → watts, %LTHR → bpm, pace_pct → m/s, rpe → note', () => {
    const w = toGarminWorkout(
      planned({ sport: 'run', title: 't' }, [
        step({ role: 'active', measure: { type: 'time', sec: 600 }, target: { type: 'pace_pct', low: 95, high: 100 } }),
        step({ role: 'active', measure: { type: 'time', sec: 600 }, target: { type: 'hr_pct_lthr', low: 90, high: 95 } }),
        step({ role: 'active', measure: { type: 'time', sec: 600 }, target: { type: 'rpe', low: 6, high: 7 } }),
        step({ role: 'active', measure: { type: 'time', sec: 600 }, target: { type: 'power_pct', low: 0.9, high: 1.0 } }),
      ]),
      TH,
    );
    const [a, b, c, d] = steps(w).map(exec);
    expect(a).toMatchObject({ targetType: { workoutTargetTypeKey: 'pace.zone' }, targetValueOne: 3.8, targetValueTwo: 4 });
    expect(b).toMatchObject({ targetType: { workoutTargetTypeKey: 'heart.rate.zone' }, targetValueOne: 155, targetValueTwo: 163 });
    expect(c).toMatchObject({ targetType: { workoutTargetTypeKey: 'no.target' }, description: 'RPE 6–7' });
    expect(d).toMatchObject({ targetType: { workoutTargetTypeKey: 'power.zone' }, targetValueOne: 234, targetValueTwo: 260 }); // fractions accepted
  });

  it('missing thresholds fall back to notes, never to wrong numbers', () => {
    const w = toGarminWorkout(planned({ sport: 'bike', title: 't' }, [step({ role: 'active', measure: { type: 'time', sec: 600 }, target: { type: 'power_pct', low: 88, high: 94 } })]), {});
    expect(exec(steps(w)[0])).toMatchObject({ targetType: { workoutTargetTypeKey: 'no.target' }, description: '88%–94% FTP' });
  });

  it('ramps become stepped sub-steps whose ranges tile the ramp', () => {
    const w = toGarminWorkout(
      planned({ sport: 'bike', title: 'ramp' }, [step({ role: 'warmup', measure: { type: 'time', sec: 600 }, target: { type: 'ramp', basis: 'power_pct', from: 50, to: 75 }, cue: 'easy' })]),
      TH,
    );
    const s = steps(w).map(exec);
    expect(s).toHaveLength(5);
    expect(s.map((x) => x.endConditionValue)).toEqual([120, 120, 120, 120, 120]);
    expect(s.map((x) => [x.targetValueOne, x.targetValueTwo])).toEqual([[130, 143], [143, 156], [156, 169], [169, 182], [182, 195]]);
    expect(s[0]!.description).toBe('easy · ramp 1/5');
    expect(s.every((x) => x.stepType.stepTypeKey === 'warmup')).toBe(true);
    expect(s.map((x) => x.stepOrder)).toEqual([1, 2, 3, 4, 5]);
    // lap-button ramp: one step with the covering range
    const lb = toGarminWorkout(planned({ sport: 'bike', title: 'r' }, [step({ role: 'active', measure: { type: 'lap_button' }, target: { type: 'ramp', basis: 'power_pct', from: 80, to: 60 } })]), TH);
    expect(exec(steps(lb)[0])).toMatchObject({ targetValueOne: 156, targetValueTwo: 208, description: 'ramp 80%→60%' });
  });

  it('sports without a Garmin workout type: row → cardio_training, hike → other, targets → notes', () => {
    const row = toGarminWorkout(
      planned({ sport: 'row', subSport: 'erg', title: 'Erg 4x1k' }, [
        repeat(4, [step({ role: 'active', measure: { type: 'distance', m: 1000 }, target: { type: 'power_pct', low: 95, high: 100 }, row: { strokeRateLow: 26, strokeRateHigh: 28 } })]),
      ]),
      TH,
    );
    expect(row.sportType.sportTypeKey).toBe('cardio_training');
    expect(row.description).toBe('ROW session');
    const inner = exec((steps(row)[0] as GarminRepeatGroup).workoutSteps[0]);
    expect(inner).toMatchObject({ targetType: { workoutTargetTypeKey: 'no.target' }, description: '219–230 W · stroke rate 26–28 spm' });
    const hike = toGarminWorkout(planned({ sport: 'hike', title: 'Hike', plannedDurationSec: 7200 }), TH);
    expect(hike.sportType.sportTypeKey).toBe('other');
    expect(exec(steps(hike)[0])).toMatchObject({ endCondition: { conditionTypeKey: 'time' }, endConditionValue: 7200 });
  });

  it('HR targets are kept for any sport; reps measure outside strength → lap button + note', () => {
    const w = toGarminWorkout(planned({ sport: 'walk', title: 'w' }, [step({ role: 'active', measure: { type: 'reps', n: 10 }, target: { type: 'hr_zone', zone: 2 } })]), TH);
    expect(exec(steps(w)[0])).toMatchObject({ zoneNumber: 2, endCondition: { conditionTypeKey: 'lap.button' }, description: '10 reps' });
  });
});

describe('strength', () => {
  it('sets → repeat group with exercise (reps, grams) + rest; catalog mapping', () => {
    const w = toGarminWorkout(
      planned({ sport: 'strength', subSport: 'gym', title: 'Gym A' }, [
        step({ role: 'active', measure: { type: 'reps', n: 8 }, strength: { exercise: 'Back squat', sets: 3, reps: 8, weightKg: 80, restSec: 120 } }),
        step({ role: 'active', measure: { type: 'lap_button' }, strength: { exercise: 'Plank', exerciseKey: 'plank', sets: 1, durationSec: 60 } }),
        step({ role: 'active', measure: { type: 'reps', n: 12 }, strength: { exercise: 'Zercher carry thing', sets: 1, reps: 12 } }),
        step({ role: 'active', measure: { type: 'reps', n: 5 }, strength: { exercise: 'Mystery lift', sets: 1, rpe: 8 } }),
      ]),
      TH,
    );
    expect(w.sportType.sportTypeKey).toBe('strength_training');
    const [grp, plank, carry, mystery] = steps(w);
    const g = grp as GarminRepeatGroup;
    expect(g).toMatchObject({ type: 'RepeatGroupDTO', numberOfIterations: 3, childStepId: 1 });
    expect(exec(g.workoutSteps[0])).toMatchObject({
      stepType: { stepTypeKey: 'interval' },
      endCondition: { conditionTypeId: 10, conditionTypeKey: 'reps' },
      endConditionValue: 8,
      category: 'SQUAT',
      exerciseName: 'BARBELL_BACK_SQUAT',
      weightValue: 80000,
      weightUnit: { unitId: 8, unitKey: 'kilogram', factor: 1000.0 },
      childStepId: 1,
    });
    expect(exec(g.workoutSteps[1])).toMatchObject({ stepType: { stepTypeKey: 'rest' }, endConditionValue: 120 });
    expect(exec(plank)).toMatchObject({ category: 'PLANK', exerciseName: 'PLANK', endCondition: { conditionTypeKey: 'time' }, endConditionValue: 60 });
    expect(exec(carry)).toMatchObject({ category: 'CARRY', exerciseName: '', description: 'Zercher carry thing' });
    expect(exec(mystery).category).toBeUndefined();
    expect(exec(mystery).description).toBe('Mystery lift · RPE 8');
  });

  it('supersets alternate inside one repeat group, rest after the last exercise', () => {
    const w = toGarminWorkout(
      planned({ sport: 'strength', title: 'SS' }, [
        step({ role: 'active', measure: { type: 'reps', n: 10 }, strength: { exercise: 'Bench press', sets: 3, reps: 10, restSec: 30, supersetGroup: 'A' } }),
        step({ role: 'active', measure: { type: 'reps', n: 10 }, strength: { exercise: 'Barbell row', sets: 3, reps: 10, restSec: 90, supersetGroup: 'A' } }),
      ]),
      TH,
    );
    const g = steps(w)[0] as GarminRepeatGroup;
    expect(steps(w)).toHaveLength(1);
    expect(g.numberOfIterations).toBe(3);
    expect(g.workoutSteps.map((s) => [exec(s).exerciseName ?? exec(s).stepType.stepTypeKey, exec(s).endConditionValue])).toEqual([
      ['BARBELL_BENCH_PRESS', 10],
      ['BARBELL_ROW', 10],
      ['rest', 90],
    ]);
  });

  it('every catalog entry exists in the FIT SDK exercise profile', () => {
    const cats = new Set(Object.values(Profile.types.exerciseCategory!).map(camelToUpperSnake));
    for (const [key, e] of Object.entries(EXERCISE_CATALOG)) {
      expect(cats.has(e.category), `${key}: category ${e.category}`).toBe(true);
      const table = Object.entries(Profile.types).find(([k]) => k === `${Object.values(Profile.types.exerciseCategory!).find((c) => camelToUpperSnake(c) === e.category)}ExerciseName`)?.[1];
      const names = new Set(Object.values(table ?? {}).map(camelToUpperSnake));
      expect(names.has(e.exerciseName), `${key}: ${e.category}/${e.exerciseName}`).toBe(true);
    }
  });

  it('resolveExercise: key, alias, Garmin pair, keyword fallback, unknown', () => {
    expect(resolveExercise('x', 'deadlift')).toEqual({ category: 'DEADLIFT', exerciseName: 'BARBELL_DEADLIFT', exact: true });
    expect(resolveExercise('RDL')).toMatchObject({ exerciseName: 'ROMANIAN_DEADLIFT' });
    expect(resolveExercise('x', 'LUNGE/WALKING_LUNGE')).toEqual({ category: 'LUNGE', exerciseName: 'WALKING_LUNGE', exact: true });
    expect(resolveExercise('Cossack squat')).toEqual({ category: 'SQUAT', exerciseName: '', exact: false });
    expect(resolveExercise('Juggling')).toBeUndefined();
  });
});

describe('nested repeats', () => {
  const nested = planned({ sport: 'run', title: 'Sets' }, [
    repeat(2, [innerRepeat(3, [step({ role: 'active', measure: { type: 'time', sec: 60 } }), step({ role: 'recovery', measure: { type: 'time', sec: 60 } })]), step({ role: 'rest', measure: { type: 'time', sec: 180 } })]),
  ]);

  it("default 'unroll' expands the outer repeat (nested RepeatGroupDTO is UNVERIFIED)", () => {
    const s = steps(toGarminWorkout(nested, TH));
    expect(s.map((x) => x.type)).toEqual(['RepeatGroupDTO', 'ExecutableStepDTO', 'RepeatGroupDTO', 'ExecutableStepDTO']);
    expect(s.map((x) => x.stepOrder)).toEqual([1, 4, 5, 8]);
    expect((s[2] as GarminRepeatGroup).childStepId).toBe(2);
    expect((s[2] as GarminRepeatGroup).workoutSteps.map((x) => x.childStepId)).toEqual([2, 2]);
  });

  it("'nest' emits nested groups with depth-first stepOrder and per-group childStepId", () => {
    const s = steps(toGarminWorkout(nested, TH, { nestedRepeats: 'nest' }));
    const outer = s[0] as GarminRepeatGroup;
    expect(outer).toMatchObject({ stepOrder: 1, childStepId: 1, numberOfIterations: 2 });
    const inner = outer.workoutSteps[0] as GarminRepeatGroup;
    expect(inner).toMatchObject({ stepOrder: 2, childStepId: 2, numberOfIterations: 3 });
    expect(inner.workoutSteps.map((x) => [x.stepOrder, x.childStepId])).toEqual([[3, 2], [4, 2]]);
    expect(outer.workoutSteps[1]).toMatchObject({ stepOrder: 5, childStepId: 1 });
  });
});

describe('swim details', () => {
  it('send-off uses fixed.rest only when the live dictionary confirms it; extra equipment → note', () => {
    const p = planned({ sport: 'swim', title: 's' }, [step({ role: 'active', measure: { type: 'distance', m: 100 }, swim: { stroke: 'back', equipment: ['fins', 'snorkel'], sendOffSec: 105 } })], 25);
    const def = steps(toGarminWorkout(p, TH)).map(exec);
    expect(def[0]).toMatchObject({ strokeType: { strokeTypeKey: 'backstroke' }, equipmentType: { equipmentTypeKey: 'fins' }, description: '+ snorkel · send-off 1:45' });
    expect(def[1]).toMatchObject({ stepType: { stepTypeKey: 'rest' }, endCondition: { conditionTypeKey: 'lap.button' } });
    const dict = buildWorkoutDictionary({ workoutConditionTypes: [{ conditionTypeId: 8, conditionTypeKey: 'fixed.rest' }], workoutStrokeTypes: [{ strokeTypeId: 22, strokeTypeKey: 'backstroke' }] });
    const live = steps(toGarminWorkout(p, TH, { dictionary: dict })).map(exec);
    expect(live[0]!.strokeType).toEqual({ strokeTypeId: 22, strokeTypeKey: 'backstroke' });
    expect(live[1]).toMatchObject({ endCondition: { conditionTypeKey: 'fixed.rest' }, endConditionValue: 105 });
  });

  it('25 yd pools are encoded in yards', () => {
    const w = toGarminWorkout(planned({ sport: 'swim', title: 'y' }, [step({ role: 'active', measure: { type: 'distance', m: 100 } })], 22.86), TH);
    expect(w.poolLength).toBe(25);
    expect(w.poolLengthUnit).toEqual({ unitId: 2, unitKey: 'yard', factor: 91.44 });
  });
});

describe('fromGarminWorkout (best effort)', () => {
  it('round-trips example A into a valid domain structure', () => {
    const p = fromGarminWorkout(EXAMPLE_A);
    expect(WorkoutStructure.safeParse(p.structure).success).toBe(true);
    expect(p).toMatchObject({ title: '5x1k @ T pace', description: 'Threshold kilometres', sport: 'run', estimatedDurationSec: 3300 });
    const [wu, rep, cd] = p.structure.steps;
    expect(wu).toMatchObject({ role: 'warmup', measure: { type: 'time', sec: 900 } });
    expect(rep).toMatchObject({ kind: 'repeat', count: 5 });
    expect((rep as { steps: unknown[] }).steps[0]).toMatchObject({ role: 'active', measure: { type: 'distance', m: 1000 }, target: { type: 'pace', lowMps: 3.8462, highMps: 4 }, cue: '4:20 -> 4:10 /km' });
    expect(cd).toMatchObject({ role: 'cooldown' });
    // and back again
    const again = toGarminWorkout(planned({ sport: 'run', title: p.title, description: p.description!, plannedDurationSec: 3300 }, p.structure.steps), TH);
    expect(again).toStrictEqual(EXAMPLE_A);
  });

  it('example B/C: zones, power watts, CSS offset (with/without CSS), strokes, pool length', () => {
    const b = fromGarminWorkout(EXAMPLE_B);
    expect(b.structure.steps[0]).toMatchObject({ target: { type: 'hr_zone', zone: 2 } });
    const bRep = b.structure.steps[1] as { steps: unknown[] };
    expect(bRep.steps[0]).toMatchObject({ target: { type: 'power_w', low: 250, high: 265 }, secondary: { type: 'cadence', low: 85, high: 95 } });
    expect(bRep.steps[1]).toMatchObject({ cue: 'power zone 1' });
    expect(b.structure.steps[2]).toMatchObject({ measure: { type: 'lap_button' } });
    const c = fromGarminWorkout(EXAMPLE_C, { swimCssMps: 1.25 });
    expect(c.structure.poolLengthM).toBe(25);
    const cRep = c.structure.steps[1] as { steps: unknown[] };
    expect(cRep.steps[0]).toMatchObject({ target: { type: 'pace', lowMps: 1.2048 }, swim: { stroke: 'free' } });
    expect(c.structure.steps[2]).toMatchObject({ swim: { stroke: 'free', equipment: ['pull_buoy'] }, cue: 'pull' });
    const cNoCss = fromGarminWorkout(EXAMPLE_C);
    expect((cNoCss.structure.steps[1] as { steps: unknown[] }).steps[0]).toMatchObject({ cue: 'CSS +3s/100m' });
  });

  it('strength steps map back to prescriptions; tags are parsed and stripped', () => {
    const w = toGarminWorkout(planned({ sport: 'strength', title: 'G' }, [step({ role: 'active', measure: { type: 'reps', n: 8 }, strength: { exercise: 'Deadlift', sets: 2, reps: 8, weightKg: 100 } })]), TH, { tag: '[cadence:pw_9:0badc0de]' });
    const back = fromGarminWorkout(w);
    expect(back.tag).toEqual({ plannedId: 'pw_9', fingerprint: '0badc0de' });
    expect(back.description).toBeUndefined();
    const rep = back.structure.steps[0] as { count: number; steps: { strength: unknown }[] };
    expect(rep.count).toBe(2);
    expect(rep.steps[0]!.strength).toEqual({ exercise: 'Barbell Deadlift', exerciseKey: 'deadlift', sets: 1, reps: 8, weightKg: 100 });
  });

  it('repeats deeper than 2 levels are unrolled into the inner repeat', () => {
    const deep = { sportType: { sportTypeKey: 'running' }, workoutName: 'deep', workoutSegments: [{ workoutSteps: [
      { type: 'RepeatGroupDTO', stepOrder: 1, numberOfIterations: 2, workoutSteps: [
        { type: 'RepeatGroupDTO', stepOrder: 2, numberOfIterations: 2, workoutSteps: [
          { type: 'RepeatGroupDTO', stepOrder: 3, numberOfIterations: 3, workoutSteps: [{ type: 'ExecutableStepDTO', stepOrder: 4, stepType: { stepTypeKey: 'interval' }, endCondition: { conditionTypeKey: 'time' }, endConditionValue: 30 }] },
        ] },
      ] },
    ] }] };
    const p = fromGarminWorkout(deep);
    expect(WorkoutStructure.safeParse(p.structure).success).toBe(true);
    const inner = (p.structure.steps[0] as { steps: { steps: unknown[] }[] }).steps[0]!;
    expect(inner.steps).toHaveLength(3);
  });
});

describe('tags and fingerprints', () => {
  it('fingerprint ignores ids and tag; changes with content', () => {
    const w = toGarminWorkout(planA, TH);
    const fp = workoutFingerprint(w);
    const tagged = toGarminWorkout(planA, TH, { tag: makeWorkoutTag('pw_1', fp) });
    expect(workoutFingerprint({ ...tagged, workoutId: 5 })).toBe(fp);
    expect(parseWorkoutTag(tagged.description)).toEqual({ plannedId: 'pw_1', fingerprint: fp });
    expect(workoutFingerprint(toGarminWorkout({ ...planA, title: 'other' }, TH))).not.toBe(fp);
    expect(makeWorkoutTag('a b/c', 'ffffffffff')).toBe('[cadence:a_b_c:ffffffff]');
  });

  it('a structure-less plan still yields a valid one-step workout', () => {
    const w = toGarminWorkout(planned({ sport: 'run', title: 'Easy 45', plannedDurationSec: 2700, preNote: 'conversational' }), TH);
    expect(steps(w)).toEqual([
      expect.objectContaining({ stepOrder: 1, endConditionValue: 2700, description: 'conversational', stepType: expect.objectContaining({ stepTypeKey: 'interval' }) }),
    ]);
  });
});
