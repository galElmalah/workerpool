/**
 * WorkoutStructure helpers: a tiny builder DSL for authoring planned sessions, flattening
 * (repeat expansion), and target → relative-intensity conversion used by the simulator.
 */
import type {
  InnerRepeat,
  Repeat,
  Step,
  StepMeasure,
  StepRole,
  StrengthPrescription,
  Target,
  WorkoutStructure,
} from '@cadence/core/domain';
import type { Family, Thr } from './internal';
import { xFromHr } from './physio';
import { rowSpeedFromPower } from './util';

// ───────────────────────────── builder ─────────────────────────────

export const T = (sec: number): StepMeasure => ({ type: 'time', sec });
export const D = (m: number): StepMeasure => ({ type: 'distance', m });
export const LAP: StepMeasure = { type: 'lap_button' };
export const REPS = (n: number): StepMeasure => ({ type: 'reps', n });
export const PP = (low: number, high: number): Target => ({ type: 'power_pct', low, high });
export const PC = (low: number, high: number): Target => ({ type: 'pace_pct', low, high });
export const HRZ = (zone: number): Target => ({ type: 'hr_zone', zone });
export const RPE = (low: number, high: number): Target => ({ type: 'rpe', low, high });
export const CAD = (low: number, high: number): Target => ({ type: 'cadence', low, high });
export const RAMP = (basis: 'power_pct' | 'pace_pct' | 'hr_pct_lthr', from: number, to: number): Target => ({ type: 'ramp', basis, from, to });
export const OPEN: Target = { type: 'open' };

type StepExtra = Partial<Pick<Step, 'label' | 'cue' | 'secondary' | 'swim' | 'row' | 'strength'>>;

export class SB {
  private n = 0;
  readonly nodes: (Step | Repeat)[] = [];

  private nextId(): string {
    return `s${++this.n}`;
  }

  /** Create a step (not yet added). */
  s(role: StepRole, measure: StepMeasure, target?: Target, extra: StepExtra = {}): Step {
    const st: Step = { kind: 'step', id: this.nextId(), role, measure };
    if (target) st.target = target;
    if (extra.label) st.label = extra.label;
    if (extra.cue) st.cue = extra.cue;
    if (extra.secondary) st.secondary = extra.secondary;
    if (extra.swim) st.swim = extra.swim;
    if (extra.row) st.row = extra.row;
    if (extra.strength) st.strength = extra.strength;
    return st;
  }

  /** Create an inner repeat (steps only). */
  ir(count: number, steps: Step[], label?: string): InnerRepeat {
    const r: InnerRepeat = { kind: 'repeat', id: this.nextId(), count, steps };
    if (label) r.label = label;
    return r;
  }

  /** Add a step to the top level. */
  add(role: StepRole, measure: StepMeasure, target?: Target, extra: StepExtra = {}): this {
    this.nodes.push(this.s(role, measure, target, extra));
    return this;
  }

  /** Add a (possibly nested) repeat to the top level. */
  rep(count: number, steps: (Step | InnerRepeat)[], label?: string): this {
    const r: Repeat = { kind: 'repeat', id: this.nextId(), count, steps };
    if (label) r.label = label;
    this.nodes.push(r);
    return this;
  }

  build(poolLengthM?: number): WorkoutStructure {
    const ws: WorkoutStructure = { steps: this.nodes };
    if (poolLengthM) ws.poolLengthM = poolLengthM;
    return ws;
  }
}

export function strengthStep(b: SB, p: StrengthPrescription): Step {
  return b.s('active', p.reps ? REPS(p.reps) : T(p.durationSec ?? 45), undefined, { label: p.exercise, strength: p });
}

// ───────────────────────────── flatten ─────────────────────────────

export interface FlatStep {
  step: Step;
  /** 0-based repetition index within the innermost repeat (0 when not repeated). */
  rep: number;
  repCount: number;
  /** Ordinal of this flattened step. */
  index: number;
}

export function flatten(ws: WorkoutStructure): FlatStep[] {
  const out: FlatStep[] = [];
  const push = (step: Step, rep: number, repCount: number) => out.push({ step, rep, repCount, index: out.length });
  for (const node of ws.steps) {
    if (node.kind === 'step') {
      push(node, 0, 1);
      continue;
    }
    for (let i = 0; i < node.count; i++) {
      for (const inner of node.steps) {
        if (inner.kind === 'step') push(inner, i, node.count);
        else for (let j = 0; j < inner.count; j++) for (const st of inner.steps) push(st, j, inner.count);
      }
    }
  }
  return out;
}

// ───────────────────────────── targets → intensity ─────────────────────────────

const FRIEL_ZONE_MID = [0.78, 0.875, 0.925, 0.975, 1.015, 1.05, 1.09];

/** Default relative intensity for an open / missing target by role. */
export function defaultX(role: StepRole, family: Family): number {
  const run = family === 'run' || family === 'swim_ow' || family === 'swim_pool';
  switch (role) {
    case 'warmup':
      return run ? 0.74 : 0.6;
    case 'cooldown':
      return run ? 0.7 : 0.52;
    case 'recovery':
      return run ? 0.68 : 0.5;
    case 'rest':
      return 0;
    case 'active':
      return run ? 0.8 : 0.72;
    default:
      return run ? 0.75 : 0.6;
  }
}

/**
 * Convert a target to relative intensity at start/end of the step (x1 differs for ramps).
 * For rows `x` is relative power; pace targets are converted via the Concept2 cube law.
 */
export function targetX(target: Target | undefined, role: StepRole, family: Family, thr: Thr): [number, number] {
  const hrP = { hrRest: thr.hrRest, lthr: thr.lthr, hrMax: thr.hrMax };
  const paceToX = (pct: number): number => (family === 'row' ? (pct / 100) ** 3 : pct / 100);
  const powToX = (pct: number): number => pct / 100;
  if (!target || target.type === 'open' || target.type === 'cadence') {
    const x = defaultX(role, family);
    return [x, x];
  }
  switch (target.type) {
    case 'power_pct': {
      const x = powToX((target.low + target.high) / 2);
      return [x, x];
    }
    case 'power_w': {
      const ref = family === 'row' ? thr.rowW : thr.ftp;
      const x = (target.low + target.high) / 2 / ref;
      return [x, x];
    }
    case 'pace_pct': {
      const x = paceToX((target.low + target.high) / 2);
      return [x, x];
    }
    case 'pace': {
      const v = (target.lowMps + target.highMps) / 2;
      const ref = family === 'swim_pool' || family === 'swim_ow' ? thr.cssMps : family === 'row' ? rowSpeedFromPower(thr.rowW) : thr.runMps;
      const x = paceToX((v / ref) * 100);
      return [x, x];
    }
    case 'hr_zone': {
      const x = xFromHr(FRIEL_ZONE_MID[target.zone - 1]! * thr.lthr, hrP);
      return [x, x];
    }
    case 'hr_pct_lthr': {
      const x = xFromHr(((target.low + target.high) / 200) * thr.lthr, hrP);
      return [x, x];
    }
    case 'hr_bpm': {
      const x = xFromHr((target.low + target.high) / 2, hrP);
      return [x, x];
    }
    case 'rpe': {
      const x = 0.4 + 0.075 * ((target.low + target.high) / 2);
      return [x, x];
    }
    case 'ramp': {
      if (target.basis === 'hr_pct_lthr') return [xFromHr((target.from / 100) * thr.lthr, hrP), xFromHr((target.to / 100) * thr.lthr, hrP)];
      if (target.basis === 'pace_pct') return [paceToX(target.from), paceToX(target.to)];
      return [powToX(target.from), powToX(target.to)];
    }
  }
}

/** Reference speed (m/s) at relative intensity x for distance-measured steps. */
export function speedAtX(x: number, family: Family, thr: Thr): number {
  switch (family) {
    case 'run':
      return Math.max(0.5, x * thr.runMps);
    case 'swim_pool':
    case 'swim_ow':
      return Math.max(0.3, x * thr.cssMps);
    case 'row':
      return rowSpeedFromPower(Math.max(30, x * thr.rowW));
    case 'bike':
      return 3 + 6 * x;
    default:
      return 1.3;
  }
}

/** Planned duration of a flattened step (seconds). */
export function plannedStepSec(fs: FlatStep, family: Family, thr: Thr): number {
  const st = fs.step;
  const m = st.measure;
  if (m.type === 'time') return m.sec;
  if (m.type === 'lap_button') return 300;
  if (m.type === 'reps') {
    const sp = st.strength;
    const work = m.n * 3.2 + 6;
    return work + (sp?.restSec ?? 90);
  }
  const [x0, x1] = targetX(st.target, st.role, family, thr);
  const v = speedAtX((x0 + x1) / 2 || 0.7, family, thr);
  let sec = m.m / v;
  if ((family === 'swim_pool' || family === 'swim_ow') && st.swim) {
    if (st.swim.sendOffSec) sec = Math.max(sec + 5, st.swim.sendOffSec);
    else if (st.swim.restSec) sec += st.swim.restSec;
  }
  return sec;
}

/** Planned duration and distance of a whole structure. */
export function plannedTotals(ws: WorkoutStructure, family: Family, thr: Thr): { sec: number; distM: number } {
  let sec = 0;
  let distM = 0;
  for (const fs of flatten(ws)) {
    if (family === 'strength' && fs.step.strength) {
      const sp = fs.step.strength;
      sec += sp.sets * ((sp.reps ?? 10) * 3.2 + 6 + (sp.restSec ?? 90));
      continue;
    }
    const s = plannedStepSec(fs, family, thr);
    sec += s;
    const m = fs.step.measure;
    if (m.type === 'distance') distM += m.m;
    else if (family !== 'strength' && family !== 'yoga') {
      const [x0, x1] = targetX(fs.step.target, fs.step.role, family, thr);
      distM += s * (fs.step.role === 'rest' ? 0 : speedAtX((x0 + x1) / 2, family, thr));
    }
  }
  return { sec, distM };
}
