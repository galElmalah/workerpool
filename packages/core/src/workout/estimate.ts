/**
 * Planned-workout estimation: target → intensity, step → duration/distance/load, whole
 * structure → totals + the intensity profile drawn by the builder and the calendar sparkline.
 *
 * Load model (product.md §4.4, metrics.md §2.9): "1 h at threshold = 100".
 *  - bike, row, run, strength, other: load = Σ hours × IF² × 100 (per step; ramps integrate IF²).
 *  - swim: load = Σ movingHours × IF³ × 100 (IF = speed / CSS; rest excluded).
 * The workout IF is the load-equivalent constant intensity: √(load / (100·h)) (swim: ∛ over
 * moving hours). This is the additive Σ IF² form, not the 4th-power NP form, so every profile
 * block's load adds up to the total.
 */
import { SPORT_META } from '../domain';
import type { IntensityClass, Sport, Step, StepRole, Target, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { flattenStructure } from './structure';
import type { NodePath } from './structure';
import {
  DEFAULT_THRESHOLDS,
  HR_ZONE_MID_LTHR,
  HR_ZONE_PCT_LTHR,
  INTENSITY_DEFAULT_RPE,
  LAP_BUTTON_DEFAULT_SEC,
  NOMINAL_SPEED_MPS,
  STRENGTH_DEFAULT_REST_SEC,
  STRENGTH_DEFAULT_RPE,
  STRENGTH_SEC_PER_REP,
  UNSTRUCTURED_IF,
  UNSTRUCTURED_SWIM_IF,
  bikeSpeedForIF,
  fromPowerEquivalent,
  hrFractionToIF,
  ifKind,
  levelForHrFraction,
  levelForIF,
  levelForPowerIF,
  levelForRpe,
  roleDefaultIF,
  rowPowerFromSpeed,
  rowSpeedFromPower,
  rpeToIF,
} from './tables';
import type { Level } from './tables';

export type { Level } from './tables';

/** A target resolved to fractions of threshold (see tables.ts for the per-sport meaning). */
export interface TargetIntensity {
  ifLow: number;
  ifHigh: number;
  ifMid: number;
  /** Ramp endpoints (same unit as ifMid) when the target is a ramp. */
  rampFrom?: number;
  rampTo?: number;
  /** Intensity level 1–5 judged on the target's native scale (§4.3 table). */
  level: Level;
  /** 'role_default' when the target is open/absent/unusable. */
  source: 'target' | 'role_default';
  /** True when a fallback threshold (DEFAULT_THRESHOLDS) had to be used. */
  usedDefaults: boolean;
}

const mid = (a: number, b: number) => (a + b) / 2;

function fromRange(lo: number, hi: number, level: Level, usedDefaults = false): TargetIntensity {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return { ifLow: a, ifHigh: b, ifMid: mid(a, b), level, source: 'target', usedDefaults };
}

function roleDefault(sport: Sport, role: StepRole): TargetIntensity {
  const x = roleDefaultIF(sport, role);
  return { ifLow: x, ifHigh: x, ifMid: x, level: levelForIF(sport, x), source: 'role_default', usedDefaults: false };
}

/** Converts a speed fraction of threshold to the sport's IF kind (row/bike: power ∝ v³). */
function speedFractionToIF(sport: Sport, x: number): number {
  return sport === 'row' || sport === 'bike' ? x * x * x : x;
}

function levelForSpeedFraction(sport: Sport, x: number): Level {
  return sport === 'row' || sport === 'bike' ? levelForPowerIF(x * x * x) : levelForIF(sport, x);
}

/**
 * Resolve a target to `{ ifLow, ifHigh, ifMid }` as fractions of threshold for `sport`.
 *  - power_pct / power_w: power fraction (W ÷ FTP, or ÷ row threshold W for row).
 *  - hr_zone / hr_pct_lthr / hr_bpm: %LTHR mapped to an IF-equivalent via HR_FRACTION_TO_IF
 *    (hr_zone uses Friel 7-zone midpoints; hr_bpm uses LTHR, else 0.9 × HRmax).
 *  - pace (m/s): run ÷ threshold speed, swim ÷ CSS, row → Concept2 watts ÷ row threshold W.
 *  - pace_pct: % threshold speed (row/bike cubed to a power fraction).
 *  - rpe: product.md §4.4 RPE→IF table. ramp: per basis, endpoints in rampFrom/rampTo.
 *  - open / cadence / missing / unusable: default IF for the step `role`.
 * Swim IFs are CSS speed fractions; power-equivalents (HR/RPE) are converted with s = IF^(2/3).
 */
export function resolveTargetIntensity(
  target: Target | undefined,
  sport: Sport,
  thresholds: ThresholdSnapshot,
  role: StepRole = 'active',
): TargetIntensity {
  if (!target) return roleDefault(sport, role);
  const pe = (x: number) => fromPowerEquivalent(sport, x);
  switch (target.type) {
    case 'open':
    case 'cadence':
      return roleDefault(sport, role);
    case 'power_pct': {
      const lo = target.low / 100;
      const hi = target.high / 100;
      return fromRange(pe(lo), pe(hi), levelForPowerIF(mid(lo, hi)));
    }
    case 'power_w': {
      const known = sport === 'row' ? thresholds.rowThresholdW : thresholds.ftp;
      const thr = known ?? (sport === 'row' ? DEFAULT_THRESHOLDS.rowThresholdW : DEFAULT_THRESHOLDS.ftp);
      const lo = target.low / thr;
      const hi = target.high / thr;
      return fromRange(pe(lo), pe(hi), levelForPowerIF(mid(lo, hi)), known === undefined);
    }
    case 'hr_zone': {
      const z = Math.min(7, Math.max(1, Math.round(target.zone)));
      const [a, b] = HR_ZONE_PCT_LTHR[z];
      const m = HR_ZONE_MID_LTHR[z];
      return {
        ifLow: pe(hrFractionToIF(a / 100)),
        ifHigh: pe(hrFractionToIF(b / 100)),
        ifMid: pe(hrFractionToIF(m)),
        level: levelForHrFraction(m),
        source: 'target',
        usedDefaults: false,
      };
    }
    case 'hr_pct_lthr': {
      const lo = target.low / 100;
      const hi = target.high / 100;
      return fromRange(pe(hrFractionToIF(lo)), pe(hrFractionToIF(hi)), levelForHrFraction(mid(lo, hi)));
    }
    case 'hr_bpm': {
      const known = thresholds.lthr ?? (thresholds.hrMax ? 0.9 * thresholds.hrMax : undefined);
      const lthr = known ?? DEFAULT_THRESHOLDS.lthr;
      const lo = target.low / lthr;
      const hi = target.high / lthr;
      return fromRange(pe(hrFractionToIF(lo)), pe(hrFractionToIF(hi)), levelForHrFraction(mid(lo, hi)), known === undefined);
    }
    case 'pace': {
      const a = Math.min(target.lowMps, target.highMps);
      const b = Math.max(target.lowMps, target.highMps);
      if (sport === 'row') {
        const known = thresholds.rowThresholdW;
        const thr = known ?? DEFAULT_THRESHOLDS.rowThresholdW;
        const lo = rowPowerFromSpeed(a) / thr;
        const hi = rowPowerFromSpeed(b) / thr;
        return fromRange(lo, hi, levelForPowerIF(mid(lo, hi)), known === undefined);
      }
      if (sport === 'swim' || sport === 'run') {
        const known = sport === 'swim' ? thresholds.swimCssMps : thresholds.runThresholdMps;
        const thr = known ?? (sport === 'swim' ? DEFAULT_THRESHOLDS.swimCssMps : DEFAULT_THRESHOLDS.runThresholdMps);
        const lo = a / thr;
        const hi = b / thr;
        return fromRange(lo, hi, levelForIF(sport, mid(lo, hi)), known === undefined);
      }
      if (sport === 'bike') {
        const lo = Math.pow(a / 9, 3);
        const hi = Math.pow(b / 9, 3);
        return fromRange(lo, hi, levelForPowerIF(mid(lo, hi)));
      }
      return roleDefault(sport, role);
    }
    case 'pace_pct': {
      const lo = target.low / 100;
      const hi = target.high / 100;
      return fromRange(speedFractionToIF(sport, lo), speedFractionToIF(sport, hi), levelForSpeedFraction(sport, mid(lo, hi)));
    }
    case 'rpe': {
      const lo = rpeToIF(target.low);
      const hi = rpeToIF(target.high);
      return fromRange(pe(lo), pe(hi), levelForRpe(mid(target.low, target.high)));
    }
    case 'ramp': {
      let from: number;
      let to: number;
      let level: Level;
      if (target.basis === 'power_pct') {
        from = pe(target.from / 100);
        to = pe(target.to / 100);
        level = levelForPowerIF(mid(target.from, target.to) / 100);
      } else if (target.basis === 'pace_pct') {
        from = speedFractionToIF(sport, target.from / 100);
        to = speedFractionToIF(sport, target.to / 100);
        level = levelForSpeedFraction(sport, mid(target.from, target.to) / 100);
      } else {
        from = pe(hrFractionToIF(target.from / 100));
        to = pe(hrFractionToIF(target.to / 100));
        level = levelForHrFraction(mid(target.from, target.to) / 100);
      }
      return { ifLow: Math.min(from, to), ifHigh: Math.max(from, to), ifMid: mid(from, to), rampFrom: from, rampTo: to, level, source: 'target', usedDefaults: false };
    }
  }
}

// ───────────────────────────── steps ─────────────────────────────

export interface StepEstimate {
  /** Elapsed seconds incl. swim send-off/rest and strength rest between sets. */
  durationSec: number;
  /** Seconds actually moving (swim excludes wall rest). */
  movingSec: number;
  /** Meters (distance sports only; estimated from speed when the measure is time). */
  distanceM?: number;
  load: number;
  intensity: TargetIntensity;
  /** True when the duration was derived (distance ÷ speed, lap-button default, reps). */
  durationEstimated: boolean;
  usedDefaults: boolean;
}

const STROKE_SPEED: Record<string, number> = {
  free: 1,
  back: 0.92,
  breast: 0.82,
  fly: 0.95,
  im: 0.9,
  choice: 0.95,
  kick: 0.7,
  drill: 0.8,
};

/** Movement speed (m/s) assumed for a step, or undefined for sports without distance. */
function stepSpeed(step: Step, sport: Sport, th: ThresholdSnapshot, ti: TargetIntensity): { v?: number; usedDefaults: boolean } {
  if (step.target?.type === 'pace') return { v: mid(step.target.lowMps, step.target.highMps), usedDefaults: false };
  const x = ti.ifMid > 0 ? ti.ifMid : roleDefaultIF(sport, 'recovery');
  switch (sport) {
    case 'run': {
      const thr = th.runThresholdMps ?? DEFAULT_THRESHOLDS.runThresholdMps;
      return { v: thr * Math.max(x, 0.5), usedDefaults: th.runThresholdMps === undefined };
    }
    case 'swim': {
      const css = th.swimCssMps ?? DEFAULT_THRESHOLDS.swimCssMps;
      const paced = step.target?.type === 'pace_pct' || (step.target?.type === 'ramp' && step.target.basis === 'pace_pct');
      const f = paced ? 1 : STROKE_SPEED[step.swim?.stroke ?? 'free'] ?? 1;
      return { v: css * Math.max(x, 0.6) * f, usedDefaults: th.swimCssMps === undefined };
    }
    case 'row': {
      const thr = th.rowThresholdW ?? DEFAULT_THRESHOLDS.rowThresholdW;
      return { v: rowSpeedFromPower(Math.max(x, 0.3) * thr), usedDefaults: th.rowThresholdW === undefined };
    }
    case 'bike':
      return { v: bikeSpeedForIF(x), usedDefaults: false };
    default:
      return { v: NOMINAL_SPEED_MPS[sport], usedDefaults: false };
  }
}

/** Mean of IF^p over a linear ramp a→b (p = 2 or 3). */
function rampMeanPow(a: number, b: number, p: 2 | 3): number {
  if (p === 2) return (a * a + a * b + b * b) / 3;
  return ((a + b) * (a * a + b * b)) / 4;
}

/**
 * Estimate one step (not repeated).
 *  - time → its seconds; distance → meters ÷ speed (target pace, or threshold speed × IF,
 *    swim stroke factors, Concept2 power→speed for row, flat-road model for bike);
 *  - lap button → LAP_BUTTON_DEFAULT_SEC by role; reps → reps × 4 s;
 *  - strength prescription → sets × (reps × 4 s | durationSec + restSec (default 90 s)),
 *    intensity from its RPE (default 6);
 *  - swim send-off: elapsed = max(send-off, swim time); swim rest adds to elapsed only.
 */
export function estimateStep(step: Step, sport: Sport, thresholds: ThresholdSnapshot): StepEstimate {
  const s = step.strength;
  let ti = resolveTargetIntensity(step.target, sport, thresholds, step.role);
  if (s) {
    const rpe = s.rpe ?? (step.target?.type === 'rpe' ? mid(step.target.low, step.target.high) : STRENGTH_DEFAULT_RPE);
    const x = rpeToIF(rpe);
    ti = { ifLow: x, ifHigh: x, ifMid: x, level: levelForRpe(rpe), source: s.rpe || step.target ? 'target' : 'role_default', usedDefaults: false };
    const reps = s.reps ?? (step.measure.type === 'reps' ? step.measure.n : undefined);
    const work = s.durationSec ?? (step.measure.type === 'time' && !reps ? step.measure.sec : (reps ?? 10) * STRENGTH_SEC_PER_REP);
    const sets = Math.max(1, s.sets);
    const dur = sets * (work + (s.restSec ?? STRENGTH_DEFAULT_REST_SEC));
    return { durationSec: dur, movingSec: dur, load: (dur / 3600) * x * x * 100, intensity: ti, durationEstimated: true, usedDefaults: false };
  }

  const { v, usedDefaults: speedDefaults } = stepSpeed(step, sport, thresholds, ti);
  let moving: number;
  let estimated = false;
  let distanceM: number | undefined;
  const m = step.measure;
  switch (m.type) {
    case 'time':
      moving = m.sec;
      break;
    case 'distance':
      moving = m.m / (v && v > 0 ? v : 1);
      distanceM = m.m;
      estimated = true;
      break;
    case 'lap_button':
      moving = LAP_BUTTON_DEFAULT_SEC[step.role];
      estimated = true;
      break;
    case 'reps':
      moving = m.n * STRENGTH_SEC_PER_REP;
      estimated = true;
      break;
  }
  const hasDistance = SPORT_META[sport]?.hasDistance;
  if (hasDistance && distanceM === undefined && v && step.role !== 'rest') distanceM = v * moving;
  if (!hasDistance) distanceM = undefined;

  let duration = moving;
  if (sport === 'swim' && step.swim) {
    if (step.swim.sendOffSec) duration = Math.max(step.swim.sendOffSec, moving);
    else if (step.swim.restSec) duration = moving + step.swim.restSec;
  }
  const swim = ifKind(sport) === 'swim';
  const p = swim ? 3 : 2;
  const meanPow =
    ti.rampFrom !== undefined && ti.rampTo !== undefined ? rampMeanPow(ti.rampFrom, ti.rampTo, p) : Math.pow(ti.ifMid, p);
  const load = ((swim ? moving : duration) / 3600) * meanPow * 100;
  const usesSpeed = m.type === 'distance';
  return {
    durationSec: duration,
    movingSec: step.role === 'rest' && swim ? 0 : moving,
    distanceM,
    load,
    intensity: ti,
    durationEstimated: estimated,
    usedDefaults: ti.usedDefaults || (usesSpeed && speedDefaults),
  };
}

// ───────────────────────────── workouts ─────────────────────────────

/** One bar of the intensity-profile graph (in execution order). */
export interface ProfileBlock {
  stepId: string;
  path: NodePath;
  /** Execution-order index. */
  index: number;
  startSec: number;
  durationSec: number;
  /** Start / length along the distance axis (swim graphs use distance), meters. */
  startM?: number;
  distanceM?: number;
  role: StepRole;
  /** Bar height: IF mid (fraction of threshold, ≈ 0 … 1.5). */
  intensity: number;
  intensityLow: number;
  intensityHigh: number;
  /** Ramp endpoints (draw a slope) when the step is a ramp. */
  rampFrom?: number;
  rampTo?: number;
  level: Level;
  load: number;
  isRepeatChild: boolean;
  /** Innermost enclosing repeat id and its 0-based iteration. */
  repeatId?: string;
  iteration?: number;
  /** All enclosing repeat ids, outermost first. */
  repeatIds: string[];
  durationEstimated: boolean;
  label?: string;
}

export interface WorkoutEstimate {
  durationSec: number;
  movingSec: number;
  /** Meters, for distance sports (estimated for time steps). */
  distanceM?: number;
  load: number;
  intensityFactor: number;
  /** Seconds per intensity level: index 0 = level 1 … index 4 = level 5. */
  timeByZoneLevel: [number, number, number, number, number];
  profile: ProfileBlock[];
  /** Some duration was derived rather than prescribed. */
  estimated: boolean;
  /** A fallback threshold from DEFAULT_THRESHOLDS was used somewhere. */
  usedDefaults: boolean;
}

/** Totals and profile of a structured workout. Thresholds may be partial (see DEFAULT_THRESHOLDS). */
export function estimateWorkout(structure: WorkoutStructure, sport: Sport, thresholds: ThresholdSnapshot): WorkoutEstimate {
  const cache = new Map<Step, StepEstimate>();
  const est = (s: Step) => {
    let e = cache.get(s);
    if (!e) {
      e = estimateStep(s, sport, thresholds);
      cache.set(s, e);
    }
    return e;
  };
  const flat = flattenStructure(structure, (s) => est(s).durationSec);
  const profile: ProfileBlock[] = [];
  const tbz: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let t = 0;
  let dist = 0;
  let load = 0;
  let moving = 0;
  let estimated = false;
  let usedDefaults = false;
  const hasDistance = SPORT_META[sport]?.hasDistance;
  for (const f of flat) {
    const e = est(f.step);
    const ti = e.intensity;
    profile.push({
      stepId: f.step.id,
      path: f.path,
      index: f.index,
      startSec: t,
      durationSec: e.durationSec,
      ...(hasDistance ? { startM: dist, distanceM: e.distanceM ?? 0 } : {}),
      role: f.step.role,
      intensity: ti.ifMid,
      intensityLow: ti.ifLow,
      intensityHigh: ti.ifHigh,
      ...(ti.rampFrom !== undefined ? { rampFrom: ti.rampFrom, rampTo: ti.rampTo } : {}),
      level: ti.level,
      load: e.load,
      isRepeatChild: f.repeatIds.length > 0,
      ...(f.repeatIds.length ? { repeatId: f.repeatIds[f.repeatIds.length - 1], iteration: f.iteration } : {}),
      repeatIds: f.repeatIds,
      durationEstimated: e.durationEstimated,
      ...(f.step.label ? { label: f.step.label } : {}),
    });
    t += e.durationSec;
    dist += e.distanceM ?? 0;
    load += e.load;
    moving += e.movingSec;
    tbz[ti.level - 1] += e.durationSec;
    estimated ||= e.durationEstimated;
    usedDefaults ||= e.usedDefaults;
  }
  const swim = ifKind(sport) === 'swim';
  const hours = (swim ? moving : t) / 3600;
  const intensityFactor = hours > 0 ? (swim ? Math.cbrt(load / (100 * hours)) : Math.sqrt(load / (100 * hours))) : 0;
  return {
    durationSec: t,
    movingSec: moving,
    ...(hasDistance ? { distanceM: dist } : {}),
    load,
    intensityFactor,
    timeByZoneLevel: tbz,
    profile,
    estimated,
    usedDefaults,
  };
}

/** Scale used to map profile intensity into 0..1 sparkline values (IF 1.2 → 1). */
export const SPARKLINE_FULL_SCALE = 1.2;

/**
 * Downsampled effort profile for calendar cards: `bars` values in 0..1, each the
 * time-weighted mean intensity over its slice of the workout (÷ SPARKLINE_FULL_SCALE, clamped).
 * Returns [] for an empty structure.
 */
export function profileSparkline(
  structure: WorkoutStructure,
  sport: Sport,
  thresholds: ThresholdSnapshot = {},
  bars = 48,
): number[] {
  const { profile, durationSec } = estimateWorkout(structure, sport, thresholds);
  return sparklineFromProfile(profile, durationSec, bars);
}

/** Same as {@link profileSparkline} from an already computed profile. */
export function sparklineFromProfile(profile: readonly ProfileBlock[], totalSec: number, bars = 48): number[] {
  if (!(totalSec > 0) || bars < 1) return [];
  const out: number[] = [];
  const w = totalSec / bars;
  let bi = 0;
  for (let i = 0; i < bars; i++) {
    const t0 = i * w;
    const t1 = t0 + w;
    let acc = 0;
    while (bi < profile.length && profile[bi].startSec + profile[bi].durationSec <= t0) bi++;
    for (let j = bi; j < profile.length && profile[j].startSec < t1; j++) {
      const b = profile[j];
      const a0 = Math.max(t0, b.startSec);
      const a1 = Math.min(t1, b.startSec + b.durationSec);
      if (a1 <= a0) continue;
      let v = b.intensity;
      if (b.rampFrom !== undefined && b.rampTo !== undefined && b.durationSec > 0) {
        const f0 = (a0 - b.startSec) / b.durationSec;
        const f1 = (a1 - b.startSec) / b.durationSec;
        v = b.rampFrom + ((f0 + f1) / 2) * (b.rampTo - b.rampFrom);
      }
      acc += v * (a1 - a0);
    }
    out.push(Math.round(Math.min(1, Math.max(0, acc / w / SPARKLINE_FULL_SCALE)) * 1000) / 1000);
  }
  return out;
}

export interface UnstructuredEstimate {
  durationSec: number;
  distanceM?: number;
  load: number;
  intensityFactor: number;
}

/**
 * Load for a workout with only a duration (s) and an intensity label (metrics.md §2.9.2):
 * load = h × IF² × 100 with the label's session IF (race: clamp((1/h)^0.1, 0.70, 1.05));
 * swim uses CSS-fraction IFs and IF³; strength / yoga use the RPE table with `opts.rpe`
 * (default by label). When `durationSec` is missing, it is derived from `opts.distanceM`.
 */
export function estimateUnstructured(
  durationSec: number | undefined,
  intensity: IntensityClass,
  sport: Sport,
  opts: { distanceM?: number; rpe?: number; thresholds?: ThresholdSnapshot } = {},
): UnstructuredEstimate {
  let x: number;
  if (sport === 'strength' || sport === 'yoga') x = rpeToIF(opts.rpe ?? INTENSITY_DEFAULT_RPE[intensity]);
  else if (sport === 'swim') x = UNSTRUCTURED_SWIM_IF[intensity];
  else if (opts.rpe !== undefined) x = fromPowerEquivalent(sport, rpeToIF(opts.rpe));
  else if (intensity === 'race') x = NaN; // depends on duration, below
  else x = UNSTRUCTURED_IF[intensity];

  let dur = durationSec ?? 0;
  if (!(dur > 0) && opts.distanceM && opts.distanceM > 0) {
    const probe: Step = { kind: 'step', id: '', role: 'active', measure: { type: 'distance', m: opts.distanceM } };
    const ix = Number.isNaN(x) ? 0.85 : x;
    const ti: TargetIntensity = { ifLow: ix, ifHigh: ix, ifMid: ix, level: 2, source: 'target', usedDefaults: false };
    const { v } = stepSpeed(probe, sport, opts.thresholds ?? {}, ti);
    if (v) dur = opts.distanceM / v;
  }
  const h = dur / 3600;
  if (Number.isNaN(x)) x = h > 0 ? Math.min(1.05, Math.max(0.7, Math.pow(1 / h, 0.1))) : 1;
  const load = h * Math.pow(x, sport === 'swim' ? 3 : 2) * 100;
  return { durationSec: dur, ...(opts.distanceM !== undefined ? { distanceM: opts.distanceM } : {}), load, intensityFactor: x };
}

/** Derived planned totals for a workout (what the server stores on create/update). */
export function derivePlannedTotals(
  w: { sport: Sport; intensity: IntensityClass; structure?: WorkoutStructure; plannedDurationSec?: number; plannedDistanceM?: number },
  thresholds: ThresholdSnapshot,
): { plannedDurationSec?: number; plannedDistanceM?: number; plannedLoad: number; plannedIntensityFactor: number } {
  if (w.structure && w.structure.steps.length) {
    const e = estimateWorkout(w.structure, w.sport, thresholds);
    return {
      plannedDurationSec: Math.round(e.durationSec),
      ...(e.distanceM !== undefined ? { plannedDistanceM: Math.round(e.distanceM) } : {}),
      plannedLoad: Math.round(e.load * 10) / 10,
      plannedIntensityFactor: Math.round(e.intensityFactor * 1000) / 1000,
    };
  }
  const u = estimateUnstructured(w.plannedDurationSec, w.intensity, w.sport, { distanceM: w.plannedDistanceM, thresholds });
  return {
    ...(u.durationSec > 0 ? { plannedDurationSec: Math.round(u.durationSec) } : {}),
    ...(w.plannedDistanceM !== undefined ? { plannedDistanceM: w.plannedDistanceM } : {}),
    plannedLoad: Math.round(u.load * 10) / 10,
    plannedIntensityFactor: Math.round(u.intensityFactor * 1000) / 1000,
  };
}
