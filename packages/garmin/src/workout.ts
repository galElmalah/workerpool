/**
 * Domain PlannedWorkout ⇄ Garmin workout-service JSON (garmin.md §5.2–5.3).
 *
 * Enum ids come from python-garminconnect 0.3.20 (VERIFIED for sport/step/
 * condition/target types). Swim stroke/equipment ids and the `fixed.rest`
 * condition key are UNVERIFIED: defaults below are consistent with the doc's
 * example (free = 6, pull_buoy = 4 — i.e. alphabetical order) and are replaced
 * by `/workout-service/workout/types` when the client could fetch it
 * (`buildWorkoutDictionary`). `fixed.rest` is only used when that dictionary
 * confirms it; otherwise send-off rests become lap-button rests with a note.
 */
import type {
  PlannedWorkout,
  Sport,
  Step,
  StepMeasure,
  StrengthPrescription,
  StructureNode,
  SubSport,
  Target,
  ThresholdSnapshot,
  WorkoutStructure,
} from '@cadence/core/domain';
import { catalogKeyFor, humanizeExercise, resolveExercise } from './exercises';
import { asArray, asObject, compact, fnv1a, isObject, num, round, stableStringify, str, type JsonObject } from './util';

// ───────────────────────────── wire types ─────────────────────────────

export interface GarminSportType {
  sportTypeId: number;
  sportTypeKey: string;
  displayOrder?: number;
}
export interface GarminStepType {
  stepTypeId: number;
  stepTypeKey: string;
  displayOrder?: number;
}
export interface GarminCondition {
  conditionTypeId: number;
  conditionTypeKey: string;
  displayOrder?: number;
  displayable?: boolean;
}
export interface GarminTargetType {
  workoutTargetTypeId: number;
  workoutTargetTypeKey: string;
  displayOrder?: number;
}
export interface GarminStrokeType {
  strokeTypeId: number;
  strokeTypeKey?: string;
  displayOrder?: number;
}
export interface GarminEquipmentType {
  equipmentTypeId: number;
  equipmentTypeKey?: string;
  displayOrder?: number;
}

export interface GarminExecutableStep {
  type: 'ExecutableStepDTO';
  stepId?: number;
  stepOrder: number;
  childStepId?: number;
  stepType: GarminStepType;
  description?: string;
  endCondition: GarminCondition;
  endConditionValue?: number;
  targetType: GarminTargetType;
  targetValueOne?: number | null;
  targetValueTwo?: number | null;
  zoneNumber?: number | null;
  secondaryTargetType?: GarminTargetType;
  secondaryTargetValueOne?: number;
  secondaryTargetValueTwo?: number;
  secondaryZoneNumber?: number;
  strokeType?: GarminStrokeType;
  equipmentType?: GarminEquipmentType;
  category?: string;
  exerciseName?: string;
  weightValue?: number;
  weightUnit?: { unitId: number; unitKey: string; factor: number };
}

export interface GarminRepeatGroup {
  type: 'RepeatGroupDTO';
  stepId?: number;
  stepOrder: number;
  childStepId?: number;
  stepType: GarminStepType;
  numberOfIterations: number;
  endCondition: GarminCondition;
  endConditionValue: number;
  smartRepeat: boolean;
  skipLastRestStep?: boolean;
  workoutSteps: GarminWorkoutStep[];
}

export type GarminWorkoutStep = GarminExecutableStep | GarminRepeatGroup;

export interface GarminWorkoutSegment {
  segmentOrder: number;
  sportType: GarminSportType;
  workoutSteps: GarminWorkoutStep[];
}

export interface GarminWorkout {
  workoutId?: number;
  ownerId?: number;
  workoutName: string;
  description?: string;
  sportType: GarminSportType;
  estimatedDurationInSecs?: number;
  /** Swim only; field names UNVERIFIED. Value is in `poolLengthUnit` units (25 = 25 m). */
  poolLength?: number;
  poolLengthUnit?: { unitId: number; unitKey: string; factor: number };
  workoutSegments: GarminWorkoutSegment[];
  createdDate?: string;
  updatedDate?: string;
}

// ───────────────────────────── dictionaries ─────────────────────────────

const t = <T>(entries: T[]) => entries;

const SPORT_TYPES = t<GarminSportType>([
  { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 },
  { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
  { sportTypeId: 3, sportTypeKey: 'other', displayOrder: 3 },
  { sportTypeId: 4, sportTypeKey: 'swimming', displayOrder: 4 },
  { sportTypeId: 5, sportTypeKey: 'strength_training', displayOrder: 5 },
  { sportTypeId: 6, sportTypeKey: 'cardio_training', displayOrder: 6 },
  { sportTypeId: 7, sportTypeKey: 'yoga', displayOrder: 7 },
  { sportTypeId: 8, sportTypeKey: 'pilates', displayOrder: 8 },
  { sportTypeId: 9, sportTypeKey: 'hiit', displayOrder: 9 },
  { sportTypeId: 10, sportTypeKey: 'multi_sport', displayOrder: 10 },
  { sportTypeId: 11, sportTypeKey: 'mobility', displayOrder: 11 },
]);
const STEP_TYPES = t<GarminStepType>(
  ['warmup', 'cooldown', 'interval', 'recovery', 'rest', 'repeat', 'other', 'main'].map((k, i) => ({
    stepTypeId: i + 1,
    stepTypeKey: k,
    displayOrder: i + 1,
  })),
);
const CONDITIONS = t<GarminCondition>(
  ['lap.button', 'time', 'distance', 'calories', 'power', 'heart.rate', 'iterations', 'fixed.rest', 'fixed.repetition', 'reps'].map(
    (k, i) => ({ conditionTypeId: i + 1, conditionTypeKey: k, displayOrder: i + 1, displayable: k !== 'iterations' }),
  ),
);
const TARGETS = t<GarminTargetType>([
  { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target', displayOrder: 1 },
  { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone', displayOrder: 2 },
  { workoutTargetTypeId: 3, workoutTargetTypeKey: 'cadence', displayOrder: 3 },
  { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone', displayOrder: 4 },
  { workoutTargetTypeId: 5, workoutTargetTypeKey: 'speed.zone', displayOrder: 5 },
  { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone', displayOrder: 6 },
  { workoutTargetTypeId: 7, workoutTargetTypeKey: 'grade', displayOrder: 7 },
  { workoutTargetTypeId: 8, workoutTargetTypeKey: 'heart.rate.lap', displayOrder: 8 },
  { workoutTargetTypeId: 9, workoutTargetTypeKey: 'power.lap', displayOrder: 9 },
  { workoutTargetTypeId: 15, workoutTargetTypeKey: 'resistance', displayOrder: 15 },
  // secondary-only; displayOrder 2 as in python-garminconnect's live-tested payload (0.3.18)
  { workoutTargetTypeId: 17, workoutTargetTypeKey: 'swim.css.offset', displayOrder: 2 },
]);
// UNVERIFIED (alphabetical guess consistent with free = 6, pull_buoy = 4).
const STROKES = t<GarminStrokeType>(
  ['any_stroke', 'backstroke', 'breaststroke', 'drill', 'fly', 'free', 'individual_medley', 'mixed'].map((k, i) => ({
    strokeTypeId: i + 1,
    strokeTypeKey: k,
  })),
);
const EQUIPMENT = t<GarminEquipmentType>(
  ['fins', 'kickboard', 'paddles', 'pull_buoy', 'snorkel'].map((k, i) => ({ equipmentTypeId: i + 1, equipmentTypeKey: k })),
);

export interface WorkoutDictionary {
  sport(key: string): GarminSportType;
  step(key: string): GarminStepType;
  condition(key: string): GarminCondition;
  target(key: string): GarminTargetType;
  stroke(key: string): GarminStrokeType | undefined;
  equipment(key: string): GarminEquipmentType | undefined;
  /** True when `/workout/types` confirmed this condition key (e.g. 'fixed.rest'). */
  confirmedCondition(key: string): boolean;
  /** True when built from a live dictionary. */
  readonly live: boolean;
}

/**
 * Build lookup tables, overriding defaults with whatever `/workout-service/workout/types`
 * returned (shape UNVERIFIED: every array of objects is scanned and recognised by its id field).
 */
export function buildWorkoutDictionary(typesJson?: unknown): WorkoutDictionary {
  const sports = new Map(SPORT_TYPES.map((x) => [x.sportTypeKey, x]));
  const steps = new Map(STEP_TYPES.map((x) => [x.stepTypeKey, x]));
  const conds = new Map(CONDITIONS.map((x) => [x.conditionTypeKey, x]));
  const targets = new Map(TARGETS.map((x) => [x.workoutTargetTypeKey, x]));
  const strokes = new Map(STROKES.map((x) => [x.strokeTypeKey!, x]));
  const equipment = new Map(EQUIPMENT.map((x) => [x.equipmentTypeKey!, x]));
  const confirmed = new Set<string>();
  let live = false;
  const visit = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const it of v) {
        if (!isObject(it)) continue;
        const pick = (idKey: string, keyKey: string) => {
          const id = num(it, idKey);
          const key = str(it, keyKey);
          return id !== undefined && key ? { id, key, displayOrder: num(it, 'displayOrder') } : undefined;
        };
        let p;
        if ((p = pick('sportTypeId', 'sportTypeKey'))) sports.set(p.key, compact({ sportTypeId: p.id, sportTypeKey: p.key, displayOrder: p.displayOrder }));
        else if ((p = pick('stepTypeId', 'stepTypeKey'))) steps.set(p.key, compact({ stepTypeId: p.id, stepTypeKey: p.key, displayOrder: p.displayOrder }));
        else if ((p = pick('conditionTypeId', 'conditionTypeKey'))) {
          conds.set(
            p.key,
            compact({ conditionTypeId: p.id, conditionTypeKey: p.key, displayOrder: p.displayOrder, displayable: typeof it.displayable === 'boolean' ? it.displayable : p.key !== 'iterations' }),
          );
          confirmed.add(p.key);
        } else if ((p = pick('workoutTargetTypeId', 'workoutTargetTypeKey')))
          targets.set(p.key, compact({ workoutTargetTypeId: p.id, workoutTargetTypeKey: p.key, displayOrder: p.displayOrder }));
        else if ((p = pick('strokeTypeId', 'strokeTypeKey'))) strokes.set(p.key, { strokeTypeId: p.id, strokeTypeKey: p.key });
        else if ((p = pick('equipmentTypeId', 'equipmentTypeKey'))) equipment.set(p.key, { equipmentTypeId: p.id, equipmentTypeKey: p.key });
        else continue;
        live = true;
      }
      return;
    }
    if (isObject(v)) for (const x of Object.values(v)) visit(x, depth + 1);
  };
  visit(typesJson, 0);
  const must = <T>(m: Map<string, T>, k: string, kind: string): T => {
    const v = m.get(k);
    if (!v) throw new Error(`Unknown Garmin ${kind} '${k}'`);
    return { ...v };
  };
  return {
    live,
    sport: (k) => must(sports, k, 'sport type'),
    step: (k) => must(steps, k, 'step type'),
    condition: (k) => must(conds, k, 'condition type'),
    target: (k) => must(targets, k, 'target type'),
    stroke: (k) => (strokes.get(k) ? { ...strokes.get(k)! } : undefined),
    equipment: (k) => (equipment.get(k) ? { ...equipment.get(k)! } : undefined),
    confirmedCondition: (k) => confirmed.has(k),
  };
}

const DEFAULT_DICT = buildWorkoutDictionary();

// ───────────────────────────── sport capabilities ─────────────────────────────

type Cap = 'hr' | 'power' | 'pace' | 'cadence' | 'reps';
interface SportPlan {
  key: string;
  caps: Set<Cap>;
}

/**
 * Garmin has no walking/hiking/rowing/ski workout type (garmin.md §5.2):
 * row → cardio_training, walk/hike/ski/other → other. Targets those sports
 * cannot carry are moved into step notes.
 */
export function garminWorkoutSport(sport: Sport, subSport?: SubSport): SportPlan {
  switch (sport) {
    case 'run':
      return { key: 'running', caps: new Set(['hr', 'power', 'pace', 'cadence']) };
    case 'bike':
      return { key: 'cycling', caps: new Set(['hr', 'power', 'pace', 'cadence']) };
    case 'swim':
      return { key: 'swimming', caps: new Set(['hr', 'pace']) };
    case 'strength':
      if (subSport === 'hiit') return { key: 'hiit', caps: new Set(['hr', 'reps']) };
      if (subSport === 'mobility') return { key: 'mobility', caps: new Set(['hr', 'reps']) };
      return { key: 'strength_training', caps: new Set(['hr', 'reps']) };
    case 'yoga':
      return { key: 'yoga', caps: new Set(['hr']) };
    case 'row':
      return { key: 'cardio_training', caps: new Set(['hr']) };
    default:
      return { key: 'other', caps: new Set(['hr']) };
  }
}

// ───────────────────────────── conversion ─────────────────────────────

export interface ToGarminOptions {
  dictionary?: WorkoutDictionary;
  /** Appended to the description (re-association tag, see makeWorkoutTag). */
  tag?: string;
  /**
   * Nested repeats are allowed by the domain (depth 2) but UNVERIFIED on Garmin.
   * 'unroll' (default) expands the outer repeat when it contains an inner one,
   * unless that exceeds `maxSteps`; 'nest' emits nested RepeatGroupDTOs.
   */
  nestedRepeats?: 'unroll' | 'nest';
  maxSteps?: number;
}

/** % values: 88 → 0.88; values ≤ 3 are taken as fractions already. */
const frac = (v: number) => (v > 3 ? v / 100 : v);
const pct = (v: number) => `${round(frac(v) * 100)}%`;

function fmtPace(mps: number, sport: Sport): string {
  if (mps <= 0) return '–';
  const per = sport === 'swim' ? 100 : sport === 'row' ? 500 : 1000;
  const sec = Math.round(per / mps);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
const paceUnit = (sport: Sport) => (sport === 'swim' ? '/100m' : sport === 'row' ? '/500m' : '/km');

interface Ctx {
  sport: Sport;
  plan: SportPlan;
  th: ThresholdSnapshot;
  dict: WorkoutDictionary;
}

interface TargetFields {
  targetType: GarminTargetType;
  valueOne?: number;
  valueTwo?: number;
  zone?: number;
  /** swim: pace expressed as a CSS offset (secondary-only type). */
  cssOffset?: number;
}
type TargetResult = { fields?: TargetFields; note?: string };

function convertTarget(target: Target | undefined, ctx: Ctx): TargetResult {
  if (!target || target.type === 'open') return {};
  const { sport, plan, th, dict } = ctx;
  const range = (key: string, a: number, b: number, digits = 0): TargetFields => ({
    targetType: dict.target(key),
    valueOne: round(Math.min(a, b), digits),
    valueTwo: round(Math.max(a, b), digits),
  });
  switch (target.type) {
    case 'power_pct': {
      const base = sport === 'row' ? th.rowThresholdW : th.ftp;
      if (!base) return { note: `${pct(target.low)}–${pct(target.high)} ${sport === 'row' ? 'threshold power' : 'FTP'}` };
      const lo = Math.round(base * frac(target.low));
      const hi = Math.round(base * frac(target.high));
      return plan.caps.has('power') ? { fields: range('power.zone', lo, hi) } : { note: `${lo}–${hi} W` };
    }
    case 'power_w':
      return plan.caps.has('power')
        ? { fields: range('power.zone', target.low, target.high) }
        : { note: `${Math.round(target.low)}–${Math.round(target.high)} W` };
    case 'hr_zone':
      return { fields: { targetType: dict.target('heart.rate.zone'), zone: target.zone } };
    case 'hr_pct_lthr':
      if (!th.lthr) return { note: `${pct(target.low)}–${pct(target.high)} LTHR` };
      return { fields: range('heart.rate.zone', th.lthr * frac(target.low), th.lthr * frac(target.high)) };
    case 'hr_bpm':
      return { fields: range('heart.rate.zone', target.low, target.high) };
    case 'pace':
      return paceTarget(target.lowMps, target.highMps, ctx);
    case 'pace_pct': {
      const base = sport === 'swim' ? th.swimCssMps : sport === 'run' || sport === 'walk' || sport === 'hike' ? th.runThresholdMps : undefined;
      if (!base) return { note: `${pct(target.low)}–${pct(target.high)} threshold pace` };
      return paceTarget(base * frac(target.low), base * frac(target.high), ctx);
    }
    case 'rpe':
      return { note: target.low === target.high ? `RPE ${target.low}` : `RPE ${target.low}–${target.high}` };
    case 'cadence':
      return plan.caps.has('cadence')
        ? { fields: range('cadence', target.low, target.high) }
        : { note: `cadence ${target.low}–${target.high}` };
    case 'ramp': {
      // Only reached when the step cannot be split (lap button / reps): use the covering range.
      const lo = Math.min(target.from, target.to);
      const hi = Math.max(target.from, target.to);
      const r = convertTarget({ type: target.basis, low: lo, high: hi } as Target, ctx);
      return { ...r, note: [r.note, `ramp ${pct(target.from)}→${pct(target.to)}`].filter(Boolean).join(' · ') };
    }
  }
}

function paceTarget(a: number, b: number, ctx: Ctx): TargetResult {
  const { sport, plan, th, dict } = ctx;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (sport === 'swim' && th.swimCssMps) {
    // Average of the two paces in s/100 m, relative to CSS (+ = slower). VERIFIED live as a secondary target.
    const pace = (100 / lo + 100 / hi) / 2;
    return { fields: { targetType: dict.target('swim.css.offset'), cssOffset: round(pace - 100 / th.swimCssMps, 1) } };
  }
  const label = `${fmtPace(lo, sport)}–${fmtPace(hi, sport)}${paceUnit(sport)}`;
  if (!plan.caps.has('pace')) return { note: label };
  // pace.zone is in m/s: valueOne = slower (lower m/s), valueTwo = faster.
  return { fields: { targetType: dict.target('pace.zone'), valueOne: round(lo, 4), valueTwo: round(hi, 4) } };
}

// ── intermediate tree

interface IrExec {
  kind: 'exec';
  step: Omit<GarminExecutableStep, 'type' | 'stepOrder' | 'childStepId'>;
}
interface IrRepeat {
  kind: 'repeat';
  count: number;
  children: IrNode[];
}
type IrNode = IrExec | IrRepeat;

const ROLE_STEP: Record<Step['role'], string> = {
  warmup: 'warmup',
  active: 'interval',
  recovery: 'recovery',
  rest: 'rest',
  cooldown: 'cooldown',
  other: 'other',
};

const SWIM_STROKE: Record<string, string> = {
  free: 'free',
  back: 'backstroke',
  breast: 'breaststroke',
  fly: 'fly',
  im: 'individual_medley',
  choice: 'any_stroke',
  drill: 'drill',
  kick: 'drill',
};
const SWIM_EQUIPMENT: Record<string, string> = {
  pull_buoy: 'pull_buoy',
  paddles: 'paddles',
  fins: 'fins',
  kick_board: 'kickboard',
  snorkel: 'snorkel',
};

const joinNotes = (parts: (string | undefined)[]) => {
  const s = parts.filter((p): p is string => !!p && p.trim() !== '').join(' · ');
  return s ? (s.length > 500 ? `${s.slice(0, 497)}…` : s) : undefined;
};

function endCondition(measure: StepMeasure, ctx: Ctx): { endCondition: GarminCondition; endConditionValue?: number; note?: string } {
  switch (measure.type) {
    case 'time':
      return { endCondition: ctx.dict.condition('time'), endConditionValue: measure.sec };
    case 'distance':
      return { endCondition: ctx.dict.condition('distance'), endConditionValue: measure.m };
    case 'reps':
      if (ctx.plan.caps.has('reps')) return { endCondition: ctx.dict.condition('reps'), endConditionValue: measure.n };
      return { endCondition: ctx.dict.condition('lap.button'), note: `${measure.n} reps` };
    case 'lap_button':
      return { endCondition: ctx.dict.condition('lap.button') };
  }
}

function buildExec(step: Step, ctx: Ctx, extraNotes: string[] = [], forceStepType?: string): IrExec {
  const { dict } = ctx;
  const notes: (string | undefined)[] = [];
  const text = step.cue ? (step.label ? `${step.label}: ${step.cue}` : step.cue) : step.label;
  notes.push(text);
  const strength = step.strength;
  let measure = step.measure;
  if (strength && measure.type === 'lap_button') {
    if (strength.reps) measure = { type: 'reps', n: strength.reps };
    else if (strength.durationSec) measure = { type: 'time', sec: strength.durationSec };
  }
  const ec = endCondition(measure, ctx);
  const prim = convertTarget(step.target, ctx);
  let sec = convertTarget(step.secondary, ctx);
  if (!step.secondary && step.row && (step.row.strokeRateLow || step.row.strokeRateHigh)) {
    const lo = step.row.strokeRateLow ?? step.row.strokeRateHigh!;
    const hi = step.row.strokeRateHigh ?? lo;
    sec = ctx.plan.caps.has('cadence') ? convertTarget({ type: 'cadence', low: lo, high: hi }, ctx) : { note: `stroke rate ${lo}–${hi} spm` };
  }
  const out: IrExec['step'] = {
    stepType: dict.step(forceStepType ?? ROLE_STEP[step.role]),
    endCondition: ec.endCondition,
    targetType: dict.target('no.target'),
  };
  if (ec.endConditionValue !== undefined) out.endConditionValue = ec.endConditionValue;

  const p = prim.fields;
  let secondaryFields = sec.fields;
  if (p?.cssOffset !== undefined) {
    // swim.css.offset is secondary-only: primary stays no.target; a domain secondary goes to notes.
    if (secondaryFields) notes.push(describeFields(secondaryFields));
    secondaryFields = p;
  } else if (p) {
    out.targetType = p.targetType;
    if (p.zone !== undefined) out.zoneNumber = p.zone;
    else {
      out.targetValueOne = p.valueOne;
      out.targetValueTwo = p.valueTwo;
    }
  }
  if (secondaryFields) {
    if (secondaryFields.cssOffset !== undefined) {
      out.secondaryTargetType = secondaryFields.targetType;
      out.secondaryTargetValueOne = secondaryFields.cssOffset;
      out.secondaryTargetValueTwo = 0;
    } else if (secondaryFields.targetType.workoutTargetTypeKey === out.targetType.workoutTargetTypeKey) {
      notes.push(describeFields(secondaryFields)); // same type twice is not representable
    } else {
      out.secondaryTargetType = secondaryFields.targetType;
      if (secondaryFields.zone !== undefined) out.secondaryZoneNumber = secondaryFields.zone;
      else {
        if (secondaryFields.valueOne !== undefined) out.secondaryTargetValueOne = secondaryFields.valueOne;
        if (secondaryFields.valueTwo !== undefined) out.secondaryTargetValueTwo = secondaryFields.valueTwo;
      }
    }
  }
  notes.push(prim.note, sec.note, ec.note);

  // swim stroke / equipment (not on rest steps — as in Garmin's stored workouts)
  if (ctx.sport === 'swim' && step.role !== 'rest') {
    const sw = step.swim;
    const strokeKey = sw?.stroke ? SWIM_STROKE[sw.stroke] : undefined;
    const stroke = strokeKey ? dict.stroke(strokeKey) : undefined;
    out.strokeType = stroke ? { strokeTypeId: stroke.strokeTypeId, strokeTypeKey: stroke.strokeTypeKey } : { strokeTypeId: 0, displayOrder: 0 };
    if (sw?.stroke === 'kick') notes.push('kick');
    const eqs = (sw?.equipment ?? []).map((e) => SWIM_EQUIPMENT[e]).filter((e): e is string => !!e);
    const eq = eqs[0] ? dict.equipment(eqs[0]) : undefined;
    out.equipmentType = eq ? { equipmentTypeId: eq.equipmentTypeId, equipmentTypeKey: eq.equipmentTypeKey } : { equipmentTypeId: 0, displayOrder: 0 };
    if (eqs.length > 1) notes.push(`+ ${eqs.slice(1).join(', ')}`);
  }

  if (strength) applyStrength(out, strength, notes);
  notes.push(...extraNotes);
  const description = joinNotes(notes);
  if (description) out.description = description;
  return { kind: 'exec', step: out };
}

function applyStrength(out: IrExec['step'], s: StrengthPrescription, notes: (string | undefined)[]): void {
  const ex = resolveExercise(s.exercise, s.exerciseKey);
  if (ex) {
    out.category = ex.category;
    out.exerciseName = ex.exerciseName;
  }
  if (!ex?.exact) notes.unshift(s.exercise);
  if (s.weightKg !== undefined && s.weightKg > 0) {
    out.weightValue = round(s.weightKg * 1000, 0); // grams
    out.weightUnit = { unitId: 8, unitKey: 'kilogram', factor: 1000.0 };
  }
  if (s.rpe !== undefined) notes.push(`RPE ${s.rpe}`);
}

function describeFields(f: TargetFields): string {
  const k = f.targetType.workoutTargetTypeKey;
  if (f.zone !== undefined) return `${k} ${f.zone}`;
  return `${k} ${f.valueOne}–${f.valueTwo}`;
}

function restStep(ctx: Ctx, sec: number): IrExec {
  return {
    kind: 'exec',
    step: {
      stepType: ctx.dict.step('rest'),
      endCondition: ctx.dict.condition('time'),
      endConditionValue: sec,
      targetType: ctx.dict.target('no.target'),
    },
  };
}

/** Linear ramps → N stepped sub-steps whose ranges tile the ramp. */
function expandRamp(step: Step, ctx: Ctx): IrNode[] | undefined {
  const tgt = step.target;
  if (!tgt || tgt.type !== 'ramp') return undefined;
  const m = step.measure;
  let total: number;
  let n: number;
  if (m.type === 'time') {
    total = m.sec;
    n = Math.max(2, Math.min(6, Math.round(total / 120)));
  } else if (m.type === 'distance') {
    total = m.m;
    const unit = ctx.sport === 'swim' ? 100 : ctx.sport === 'bike' ? 2000 : 400;
    n = Math.max(2, Math.min(6, Math.round(total / unit)));
  } else return undefined;
  const out: IrNode[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const part = i === n - 1 ? round(total - used, 1) : Math.floor(total / n);
    used += part;
    const a = tgt.from + ((tgt.to - tgt.from) * i) / n;
    const b = tgt.from + ((tgt.to - tgt.from) * (i + 1)) / n;
    const sub: Step = {
      ...step,
      measure: m.type === 'time' ? { type: 'time', sec: part } : { type: 'distance', m: part },
      target: { type: tgt.basis, low: round(Math.min(a, b), 2), high: round(Math.max(a, b), 2) } as Target,
    };
    if (i > 0) {
      delete sub.cue;
      delete sub.label;
    }
    out.push(buildExec(sub, ctx, [`ramp ${i + 1}/${n}`]));
  }
  return out;
}

function convertStep(step: Step, ctx: Ctx, insideRepeat: boolean): IrNode[] {
  const ramp = expandRamp(step, ctx);
  const nodes: IrNode[] = ramp ?? [buildExec(step, ctx, [], step.strength && step.role === 'active' ? 'interval' : undefined)];
  const sw = step.swim;
  if (ctx.sport === 'swim' && step.role !== 'rest' && sw) {
    if (sw.sendOffSec) {
      const sendOff = `send-off ${Math.floor(sw.sendOffSec / 60)}:${String(Math.round(sw.sendOffSec % 60)).padStart(2, '0')}`;
      if (ctx.dict.confirmedCondition('fixed.rest')) {
        nodes.push({
          kind: 'exec',
          step: {
            stepType: ctx.dict.step('rest'),
            endCondition: ctx.dict.condition('fixed.rest'),
            endConditionValue: sw.sendOffSec,
            targetType: ctx.dict.target('no.target'),
            description: sendOff,
          },
        });
      } else {
        const last = nodes[nodes.length - 1] as IrExec;
        last.step.description = joinNotes([last.step.description, sendOff]);
        nodes.push({
          kind: 'exec',
          step: { stepType: ctx.dict.step('rest'), endCondition: ctx.dict.condition('lap.button'), targetType: ctx.dict.target('no.target'), description: sendOff },
        });
      }
    } else if (sw.restSec) nodes.push(restStep(ctx, sw.restSec));
  }
  const s = step.strength;
  if (s) {
    if (s.restSec) nodes.push(restStep(ctx, s.restSec));
    if (!insideRepeat && s.sets > 1) return [{ kind: 'repeat', count: s.sets, children: nodes }];
  }
  return nodes;
}

function convertNodes(nodes: (StructureNode | Step | { kind: 'repeat'; count: number; steps: unknown[] })[], ctx: Ctx, insideRepeat: boolean): IrNode[] {
  const out: IrNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.kind === 'repeat') {
      out.push({ kind: 'repeat', count: node.count, children: convertNodes(node.steps as StructureNode[], ctx, true) });
      continue;
    }
    const step = node as Step;
    const group = step.strength?.supersetGroup;
    if (!insideRepeat && group) {
      // Consecutive steps of a superset alternate: one repeat group, rest after the last exercise.
      const members: Step[] = [step];
      while (i + 1 < nodes.length) {
        const nx = nodes[i + 1]!;
        if (nx.kind !== 'step' || (nx as Step).strength?.supersetGroup !== group) break;
        members.push(nx as Step);
        i++;
      }
      if (members.length > 1) {
        const count = Math.max(...members.map((m) => m.strength!.sets));
        const children: IrNode[] = [];
        members.forEach((m, j) => {
          const isLast = j === members.length - 1;
          const s = { ...m.strength!, ...(isLast ? {} : { restSec: undefined }) };
          if (s.restSec === undefined) delete s.restSec;
          children.push(...convertStep({ ...m, strength: s }, ctx, true));
        });
        out.push({ kind: 'repeat', count, children });
        continue;
      }
    }
    out.push(...convertStep(step, ctx, insideRepeat));
  }
  return out;
}

function countIr(nodes: IrNode[]): number {
  return nodes.reduce((a, n) => a + 1 + (n.kind === 'repeat' ? countIr(n.children) : 0), 0);
}

function unrollNested(nodes: IrNode[], maxSteps: number): IrNode[] {
  const out: IrNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'repeat' && n.children.some((c) => c.kind === 'repeat')) {
      const expanded: IrNode[] = [];
      for (let i = 0; i < n.count; i++) expanded.push(...structuredClone(n.children));
      out.push(...expanded);
    } else out.push(n);
  }
  return countIr(out) <= maxSteps ? out : nodes;
}

function numberIr(nodes: IrNode[], ctx: Ctx, state: { order: number; child: number }, childId?: number): GarminWorkoutStep[] {
  return nodes.map((n) => {
    if (n.kind === 'exec') {
      const s: GarminExecutableStep = { type: 'ExecutableStepDTO', stepOrder: ++state.order, ...n.step };
      if (childId !== undefined) s.childStepId = childId;
      return reorder(s);
    }
    const myChild = ++state.child;
    const g: GarminRepeatGroup = {
      type: 'RepeatGroupDTO',
      stepOrder: ++state.order,
      childStepId: myChild,
      stepType: ctx.dict.step('repeat'),
      numberOfIterations: n.count,
      smartRepeat: false,
      endCondition: ctx.dict.condition('iterations'),
      endConditionValue: n.count,
      workoutSteps: [],
    };
    g.workoutSteps = numberIr(n.children, ctx, state, myChild);
    return g;
  });
}

/** Stable key order (readability of logged payloads only). */
function reorder(s: GarminExecutableStep): GarminExecutableStep {
  const { type, stepOrder, childStepId, stepType, ...rest } = s;
  return compact({ type, stepOrder, childStepId, stepType, ...rest }) as GarminExecutableStep;
}

function estimateDuration(nodes: IrNode[]): number {
  let sec = 0;
  for (const n of nodes) {
    if (n.kind === 'repeat') sec += n.count * estimateDuration(n.children);
    else if (n.step.endCondition.conditionTypeKey === 'time' && n.step.endConditionValue) sec += n.step.endConditionValue;
    else if (n.step.endCondition.conditionTypeKey === 'distance' && n.step.endConditionValue) {
      const k = n.step.targetType.workoutTargetTypeKey;
      const speed = (k === 'pace.zone' || k === 'speed.zone') && n.step.targetValueOne && n.step.targetValueTwo ? (n.step.targetValueOne + n.step.targetValueTwo) / 2 : undefined;
      if (speed) sec += n.step.endConditionValue / speed;
    }
  }
  return Math.round(sec);
}

/**
 * Domain PlannedWorkout → Garmin workout JSON (create body; no ids).
 * Power % → watts and pace % → m/s use `thresholds` at upload time.
 */
export function toGarminWorkout(planned: PlannedWorkout, thresholds: ThresholdSnapshot, opts: ToGarminOptions = {}): GarminWorkout {
  const dict = opts.dictionary ?? DEFAULT_DICT;
  const plan = garminWorkoutSport(planned.sport, planned.subSport);
  const ctx: Ctx = { sport: planned.sport, plan, th: thresholds, dict };
  const structure: WorkoutStructure = planned.structure?.steps.length
    ? planned.structure
    : { steps: [fallbackStep(planned)] };
  let ir = convertNodes(structure.steps, ctx, false);
  if ((opts.nestedRepeats ?? 'unroll') === 'unroll') ir = unrollNested(ir, opts.maxSteps ?? 50);
  const sportType = dict.sport(plan.key);
  const steps = numberIr(ir, ctx, { order: 0, child: 0 });

  const nativeSport = ['run', 'bike', 'swim', 'strength', 'yoga'].includes(planned.sport);
  const descParts = [
    nativeSport ? undefined : `${planned.sport.toUpperCase()} session`,
    planned.description,
  ].filter((x): x is string => !!x && x.trim() !== '');
  let description = descParts.join('\n\n');
  if (description.length > 900) description = `${description.slice(0, 897)}…`;
  if (opts.tag) description = description ? `${description}\n\n${opts.tag}` : opts.tag;

  const w: GarminWorkout = {
    workoutName: planned.title.length > 80 ? `${planned.title.slice(0, 79)}…` : planned.title,
    sportType,
    workoutSegments: [{ segmentOrder: 1, sportType: { ...sportType }, workoutSteps: steps }],
  };
  if (description) w.description = description;
  const est = planned.plannedDurationSec ?? estimateDuration(ir);
  if (est > 0) w.estimatedDurationInSecs = est;
  if (planned.sport === 'swim' && structure.poolLengthM) {
    const yards = Math.abs(structure.poolLengthM / 0.9144 - Math.round(structure.poolLengthM / 0.9144)) < 0.01 && Math.abs(structure.poolLengthM - 25) > 0.01 && Math.abs(structure.poolLengthM - 50) > 0.01;
    // UNVERIFIED encoding: value in the unit's units (25.0 m) with factor 100 (meter) / 91.44 (yard).
    w.poolLength = yards ? round(structure.poolLengthM / 0.9144, 2) : structure.poolLengthM;
    w.poolLengthUnit = yards ? { unitId: 2, unitKey: 'yard', factor: 91.44 } : { unitId: 1, unitKey: 'meter', factor: 100.0 };
  }
  return orderWorkout(w);
}

function orderWorkout(w: GarminWorkout): GarminWorkout {
  const { workoutName, description, sportType, poolLength, poolLengthUnit, estimatedDurationInSecs, workoutSegments, ...rest } = w;
  return compact({ workoutName, description, sportType, poolLength, poolLengthUnit, estimatedDurationInSecs, workoutSegments, ...rest });
}

function fallbackStep(p: PlannedWorkout): Step {
  const measure: StepMeasure = p.plannedDurationSec
    ? { type: 'time', sec: p.plannedDurationSec }
    : p.plannedDistanceM
      ? { type: 'distance', m: p.plannedDistanceM }
      : { type: 'lap_button' };
  return { kind: 'step', id: 'main', role: 'active', measure, ...(p.preNote ? { cue: p.preNote } : {}) };
}

// ───────────────────────────── tags & fingerprints ─────────────────────────────

const TAG_RE = /\[cadence:([A-Za-z0-9_\-]+):([0-9a-f]{8})\]/;

/** `[cadence:<plannedId>:<hash8>]` — lets us re-associate after a crash (garmin.md §6.2). */
export function makeWorkoutTag(plannedId: string, fingerprint: string): string {
  return `[cadence:${plannedId.replace(/[^A-Za-z0-9_\-]/g, '_')}:${fingerprint.slice(0, 8)}]`;
}

export function parseWorkoutTag(text: unknown): { plannedId: string; fingerprint: string } | undefined {
  if (typeof text !== 'string') return undefined;
  const m = TAG_RE.exec(text);
  return m ? { plannedId: m[1]!, fingerprint: m[2]! } : undefined;
}

/** Content hash of a workout payload (ignores ids, tag and server fields). */
export function workoutFingerprint(w: GarminWorkout): string {
  const clone = structuredClone(w) as GarminWorkout & Record<string, unknown>;
  for (const k of ['workoutId', 'ownerId', 'createdDate', 'updatedDate']) delete clone[k];
  if (clone.description) clone.description = clone.description.replace(TAG_RE, '').trim();
  return fnv1a(stableStringify(clone));
}

// ───────────────────────────── reverse (best effort) ─────────────────────────────

export interface ParsedGarminWorkout {
  workoutId?: string;
  title: string;
  description?: string;
  tag?: { plannedId: string; fingerprint: string };
  sport: Sport;
  subSport?: SubSport;
  structure: WorkoutStructure;
  estimatedDurationSec?: number;
}

const SPORT_BACK: Record<string, [Sport, SubSport?]> = {
  running: ['run'],
  cycling: ['bike'],
  swimming: ['swim', 'pool'],
  strength_training: ['strength', 'gym'],
  hiit: ['strength', 'hiit'],
  mobility: ['strength', 'mobility'],
  yoga: ['yoga'],
  pilates: ['yoga'],
  cardio_training: ['other'],
  other: ['other'],
};
const STEP_BACK: Record<string, Step['role']> = {
  warmup: 'warmup',
  cooldown: 'cooldown',
  interval: 'active',
  main: 'active',
  recovery: 'recovery',
  rest: 'rest',
  other: 'other',
};
const STROKE_BACK: Record<string, NonNullable<NonNullable<Step['swim']>['stroke']>> = {
  free: 'free',
  backstroke: 'back',
  breaststroke: 'breast',
  fly: 'fly',
  individual_medley: 'im',
  any_stroke: 'choice',
  mixed: 'choice',
  drill: 'drill',
};
const EQUIP_BACK: Record<string, NonNullable<NonNullable<Step['swim']>['equipment']>[number]> = {
  fins: 'fins',
  kickboard: 'kick_board',
  paddles: 'paddles',
  pull_buoy: 'pull_buoy',
  snorkel: 'snorkel',
};

function targetBack(
  type: unknown,
  one: unknown,
  two: unknown,
  zone: unknown,
  css: number | undefined,
): { target?: Target; note?: string } {
  const key = str(type, 'workoutTargetTypeKey') ?? '';
  const a = typeof one === 'number' ? one : undefined;
  const b = typeof two === 'number' ? two : undefined;
  const z = typeof zone === 'number' && zone > 0 ? zone : undefined;
  const lo = a !== undefined && b !== undefined ? Math.min(a, b) : a;
  const hi = a !== undefined && b !== undefined ? Math.max(a, b) : b;
  switch (key) {
    case 'power.zone':
      if (lo !== undefined && hi !== undefined) return { target: { type: 'power_w', low: lo, high: hi } };
      return z ? { note: `power zone ${z}` } : {};
    case 'heart.rate.zone':
      if (lo !== undefined && hi !== undefined) return { target: { type: 'hr_bpm', low: lo, high: hi } };
      return z && z <= 7 ? { target: { type: 'hr_zone', zone: z } } : {};
    case 'pace.zone':
    case 'speed.zone':
      return lo !== undefined && hi !== undefined ? { target: { type: 'pace', lowMps: lo, highMps: hi } } : {};
    case 'cadence':
      return lo !== undefined && hi !== undefined ? { target: { type: 'cadence', low: lo, high: hi } } : {};
    case 'swim.css.offset': {
      if (a === undefined) return {};
      if (css) {
        const mps = round(100 / (100 / css + a), 4);
        return { target: { type: 'pace', lowMps: mps, highMps: mps } };
      }
      return { note: `CSS ${a >= 0 ? '+' : ''}${a}s/100m` };
    }
    default:
      return {};
  }
}

function stepBack(s: JsonObject, css: number | undefined): Step {
  const condKey = str(s.endCondition, 'conditionTypeKey') ?? 'lap.button';
  const v = num(s, 'endConditionValue');
  const measure: StepMeasure =
    condKey === 'time' && v && v > 0
      ? { type: 'time', sec: v }
      : condKey === 'distance' && v && v > 0
        ? { type: 'distance', m: v }
        : condKey === 'reps' && v && v > 0
          ? { type: 'reps', n: Math.round(v) }
          : { type: 'lap_button' };
  const prim = targetBack(s.targetType, s.targetValueOne, s.targetValueTwo, s.zoneNumber, css);
  const sec = targetBack(s.secondaryTargetType, s.secondaryTargetValueOne, s.secondaryTargetValueTwo, s.secondaryZoneNumber, css);
  const cue = [str(s, 'description'), prim.note, sec.note].filter(Boolean).join(' · ');
  const step: Step = {
    kind: 'step',
    id: `g${num(s, 'stepOrder') ?? Math.random().toString(36).slice(2, 8)}`,
    role: STEP_BACK[str(s.stepType, 'stepTypeKey') ?? ''] ?? 'other',
    measure,
  };
  if (cue) step.cue = cue;
  let primary = prim.target;
  let secondary = sec.target;
  if (!primary && secondary) {
    primary = secondary; // e.g. swim css offset carried as secondary
    secondary = undefined;
  }
  if (primary) step.target = primary;
  if (secondary) step.secondary = secondary;
  const strokeKey = str(s.strokeType, 'strokeTypeKey');
  const equipKey = str(s.equipmentType, 'equipmentTypeKey');
  if ((strokeKey && STROKE_BACK[strokeKey]) || (equipKey && EQUIP_BACK[equipKey])) {
    step.swim = {};
    if (strokeKey && STROKE_BACK[strokeKey]) step.swim.stroke = STROKE_BACK[strokeKey];
    if (equipKey && EQUIP_BACK[equipKey]) step.swim.equipment = [EQUIP_BACK[equipKey]!];
  }
  const category = str(s, 'category');
  if (category) {
    const name = typeof s.exerciseName === 'string' ? s.exerciseName : '';
    const w = num(s, 'weightValue');
    const factor = num(s.weightUnit, 'factor') ?? 1000;
    const strength: StrengthPrescription = {
      exercise: humanizeExercise(name || category),
      exerciseKey: catalogKeyFor(category, name) ?? `${category}/${name}`,
      sets: 1,
    };
    if (measure.type === 'reps') strength.reps = measure.n;
    if (measure.type === 'time') strength.durationSec = measure.sec;
    if (w && w > 0) strength.weightKg = round(w / factor, 2);
    step.strength = strength;
  }
  return step;
}

/**
 * Garmin workout JSON → domain pieces (best effort, for reconciliation/import).
 * Repeats deeper than the domain's 2 levels are unrolled. A `swim.css.offset`
 * becomes an absolute pace when `thresholds.swimCssMps` is known, else a cue.
 */
export function fromGarminWorkout(json: unknown, thresholds: ThresholdSnapshot = {}): ParsedGarminWorkout {
  const w = asObject(json);
  const sportKey = str(w.sportType, 'sportTypeKey') ?? 'other';
  const [sport, subSport] = SPORT_BACK[sportKey] ?? ['other'];
  const css = thresholds.swimCssMps;
  const toNodes = (steps: unknown[], depth: number): StructureNode[] => {
    const out: StructureNode[] = [];
    for (const raw of steps) {
      if (!isObject(raw)) continue;
      if (raw.type === 'RepeatGroupDTO' || str(raw.stepType, 'stepTypeKey') === 'repeat') {
        const count = Math.max(1, Math.round(num(raw, 'numberOfIterations', 'endConditionValue') ?? 1));
        const children = toNodes(asArray(raw.workoutSteps), depth + 1);
        if (depth >= 2) {
          // the domain allows outer → inner repeat only: unroll anything deeper into the inner one
          for (let i = 0; i < count; i++)
            for (const c of children) out.push(c.kind === 'step' ? { ...c, id: `${c.id}_${i}` } : c);
          continue;
        }
        out.push({ kind: 'repeat', id: `g${num(raw, 'stepOrder') ?? out.length}`, count, steps: children as never });
      } else out.push(stepBack(raw, css));
    }
    return out;
  };
  const segs = asArray(w.workoutSegments).filter(isObject);
  const steps = segs.flatMap((seg) => toNodes(asArray(seg.workoutSteps), 0));
  const structure: WorkoutStructure = { steps };
  const pool = num(w, 'poolLength');
  if (sport === 'swim' && pool && pool > 0) {
    const unit = str(w.poolLengthUnit, 'unitKey') ?? 'meter';
    structure.poolLengthM = unit === 'yard' ? round(pool * 0.9144, 2) : pool;
  }
  const descriptionRaw = str(w, 'description');
  const tag = parseWorkoutTag(descriptionRaw) ?? parseWorkoutTag(str(w, 'workoutName'));
  const description = descriptionRaw?.replace(TAG_RE, '').trim();
  const out: ParsedGarminWorkout = { title: str(w, 'workoutName') ?? 'Garmin workout', sport, structure };
  const id = str(w, 'workoutId');
  if (id) out.workoutId = id;
  if (subSport) out.subSport = subSport;
  if (description) out.description = description;
  if (tag) out.tag = tag;
  const est = num(w, 'estimatedDurationInSecs');
  if (est) out.estimatedDurationSec = est;
  return out;
}
