/** Gym sessions with progressive overload driven by the training block. */
import type { StrengthPrescription } from '@cadence/core/domain';
import { SB, strengthStep } from '../structure';
import { clamp, lerp } from '../util';
import { draft, type SessionCtx, type SessionDraft } from './common';

export interface ExerciseDef {
  name: string;
  key: string; // Garmin-style exercise key
  category: string; // Garmin exercise category (FIT exercise_category, upper snake)
  fit: string; // FIT profile exerciseCategory value name
}

export const EXERCISES: Record<string, ExerciseDef> = {
  squat: { name: 'Back squat', key: 'BARBELL_BACK_SQUAT', category: 'SQUAT', fit: 'squat' },
  rdl: { name: 'Romanian deadlift', key: 'ROMANIAN_DEADLIFT', category: 'DEADLIFT', fit: 'deadlift' },
  bench: { name: 'DB bench press', key: 'DUMBBELL_BENCH_PRESS', category: 'BENCH_PRESS', fit: 'benchPress' },
  row: { name: 'Bent-over row', key: 'BENT_OVER_ROW_WITH_BARBELL', category: 'ROW', fit: 'row' },
  plank: { name: 'Plank', key: 'PLANK', category: 'PLANK', fit: 'plank' },
  calf: { name: 'Calf raise', key: 'STANDING_CALF_RAISE', category: 'CALF_RAISE', fit: 'calfRaise' },
  bss: { name: 'Bulgarian split squat', key: 'DUMBBELL_BULGARIAN_SPLIT_SQUAT', category: 'LUNGE', fit: 'lunge' },
  deadlift: { name: 'Deadlift', key: 'BARBELL_DEADLIFT', category: 'DEADLIFT', fit: 'deadlift' },
  pullup: { name: 'Pull-up', key: 'PULL_UP', category: 'PULL_UP', fit: 'pullUp' },
  stepup: { name: 'Step-up', key: 'DUMBBELL_STEP_UP', category: 'LUNGE', fit: 'lunge' },
  pallof: { name: 'Pallof press', key: 'PALLOF_PRESS', category: 'CORE', fit: 'core' },
  sideplank: { name: 'Side plank', key: 'SIDE_PLANK', category: 'PLANK', fit: 'plank' },
  deadbug: { name: 'Dead bug', key: 'DEAD_BUG', category: 'CORE', fit: 'core' },
  bridge: { name: 'Glute bridge', key: 'GLUTE_BRIDGE', category: 'HIP_RAISE', fit: 'hipRaise' },
  birddog: { name: 'Bird dog', key: 'BIRD_DOG', category: 'CORE', fit: 'core' },
  copenhagen: { name: 'Copenhagen plank', key: 'COPENHAGEN_PLANK', category: 'PLANK', fit: 'plank' },
  warmup: { name: 'Warm-up', key: 'WARM_UP', category: 'WARM_UP', fit: 'warmUp' },
};

export function exerciseByName(name: string): ExerciseDef | undefined {
  for (const e of Object.values(EXERCISES)) if (e.name === name) return e;
  return undefined;
}

/** Strength "level" 0..1.1 by week relative to the A race (progressive overload, then maintenance). */
export function strengthLevel(rel: number): number {
  if (rel <= -40) return clamp(0.2 + (rel + 45) * 0.03, 0.15, 0.35);
  if (rel <= -24) return lerp(0.4, 1.0, (rel + 39) / 15);
  if (rel <= -12) return lerp(1.0, 1.08, (rel + 23) / 11);
  if (rel <= 0) return 0.95;
  if (rel <= 3) return 0.6;
  return lerp(0.65, 0.85, clamp((rel - 4) / 6, 0, 1));
}

const bar = (kg: number) => Math.round(kg / 2.5) * 2.5;
const db = (kg: number) => Math.round(kg / 2) * 2;

function rx(ex: string, sets: number, reps: number | undefined, weightKg: number | undefined, restSec: number, durationSec?: number): StrengthPrescription {
  const e = EXERCISES[ex]!;
  const p: StrengthPrescription = { exercise: e.name, exerciseKey: e.key, sets, restSec };
  if (reps !== undefined) p.reps = reps;
  if (durationSec !== undefined) p.durationSec = durationSec;
  if (weightKg !== undefined) p.weightKg = weightKg;
  return p;
}

export function strengthA(c: SessionCtx): SessionDraft {
  const l = strengthLevel(c.week.rel);
  const maint = c.week.rel > -12 && c.week.rel <= 0;
  const s = maint ? 3 : 4;
  const b = new SB();
  for (const p of [
    rx('squat', s, maint ? 5 : 6, bar(55 + 40 * l), 150),
    rx('rdl', 3, 8, bar(45 + 35 * l), 120),
    rx('bench', 3, 8, db(16 + 10 * l), 90),
    rx('row', 3, 10, bar(40 + 22 * l), 90),
    rx('plank', 3, undefined, undefined, 45, 45),
    rx('calf', 3, 15, bar(20 + 20 * l), 60),
  ])
    b.nodes.push(strengthStep(b, p));
  return draft(
    {
      sport: 'strength',
      subSport: 'gym',
      title: maint ? 'Full-body strength A (maint.)' : 'Full-body strength A',
      description: 'Heavy and slow on the way down. Leave 1–2 reps in the tank.',
      structure: b.build(),
      isKey: false,
      intensity: 'tempo',
      tags: ['strength'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function strengthB(c: SessionCtx): SessionDraft {
  const l = strengthLevel(c.week.rel);
  const b = new SB();
  for (const p of [
    rx('bss', 3, 8, db(10 + 12 * l), 90),
    rx('deadlift', 3, 5, bar(80 + 45 * l), 150),
    rx('pullup', 3, 6, l > 0.9 ? 5 : 0, 120),
    rx('stepup', 3, 10, db(10 + 10 * l), 75),
    rx('pallof', 3, 12, 8 + Math.round(6 * l), 45),
    rx('sideplank', 2, undefined, undefined, 30, 40),
  ])
    b.nodes.push(strengthStep(b, p));
  return draft(
    {
      sport: 'strength',
      subSport: 'gym',
      title: 'Strength B — single leg & core',
      structure: b.build(),
      isKey: false,
      intensity: 'tempo',
      tags: ['strength'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function mobility(c: SessionCtx): SessionDraft {
  const b = new SB();
  for (const p of [
    rx('deadbug', 3, 12, undefined, 30),
    rx('bridge', 3, 15, undefined, 30),
    rx('birddog', 3, 10, undefined, 30),
    rx('copenhagen', 2, undefined, undefined, 30, 20),
  ])
    b.nodes.push(strengthStep(b, p));
  return draft(
    {
      sport: 'strength',
      subSport: 'mobility',
      title: 'Mobility & core 30′',
      structure: b.build(),
      plannedDurationSec: 1800,
      isKey: false,
      intensity: 'recovery',
      tags: ['mobility', 'core'],
      environment: 'indoor',
    },
    c.thr,
  );
}
