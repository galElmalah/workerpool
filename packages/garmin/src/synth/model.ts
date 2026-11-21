/**
 * Activity model: a deterministic, parametric description of one activity (segments, laps,
 * course, swim lengths, strength sets) derived purely from (seed, header, planned session,
 * thresholds). Both the cheap summary pass and the 1 Hz detail renderer consume it, which is
 * what keeps summaries and streams consistent.
 */
import type { IntensityClass, StepRole } from '@cadence/core/domain';
import { familyOf, isIndoor, type Family, type Header, type Thr } from './internal';
import { bikeSpeed, strokesPerLength, type BikePhys } from './physio';
import { rngFor, type Rng } from './prng';
import { makeCourse, PLACES, type Course, type CourseOpts } from './routes';
import { exerciseByName, EXERCISES } from './sessions/strength';
import { flatten, targetX } from './structure';
import type { SynthPlannedSession } from './types';
import { clamp, rowSpeedFromPower } from './util';

export type SegKind = 'move' | 'rest' | 'stop' | 'pause';

export interface Seg {
  start: number;
  dur: number;
  /** Relative intensity at start / end (linear ramp). Walk/hike: flat speed in m/s. */
  x0: number;
  x1: number;
  kind: SegKind;
  lap: number;
  role: StepRole;
  spm?: number;
  cad?: number;
}

export type SwimStrokeName = 'free' | 'back' | 'breast' | 'fly' | 'drill';

export interface SwimLen {
  start: number;
  dur: number;
  stroke: SwimStrokeName;
  strokes: number;
  lap: number;
}

export interface SwimLapSpec {
  start: number;
  dur: number;
  isRest: boolean;
  stroke: string;
  lengths: number;
  distM: number;
}

export interface StrengthItem {
  exercise: string;
  category: string;
  fit: string;
  reps?: number;
  weightKg?: number;
  start: number;
  dur: number;
  isRest: boolean;
}

export interface Exec {
  kind: 'on' | 'short' | 'long' | 'off_short';
  scale: number;
  bias: number;
  reason?: 'sick_onset' | 'tired' | 'time' | 'great' | 'niggle';
}

export interface LapSpec {
  start: number;
  end: number;
}

export interface Model {
  seed: number;
  header: Header;
  family: Family;
  indoor: boolean;
  hasGps: boolean;
  /** Elapsed seconds; streams cover t ∈ [0, dur). */
  dur: number;
  segs: Seg[];
  laps: LapSpec[] | null;
  autoLapM: number;
  course?: Course;
  swim?: { poolLengthM: number; lengths: SwimLen[]; laps: SwimLapSpec[] };
  strength?: { items: StrengthItem[] };
  exec: Exec;
  estLoad: number;
  tempC: number;
  bike: BikePhys;
  isRace: boolean;
  isTest: boolean;
  intensity: IntensityClass;
}

export interface ModelCtx {
  seed: number;
  thr: Thr;
  /** Thresholds effective the day after (for test sessions). */
  thrNext: Thr;
  sickTomorrow: boolean;
  place: 'home' | 'vacation' | 'travel';
  tempC: number;
}

interface NomStep {
  dur: number;
  x0: number;
  x1: number;
  role: StepRole;
  kind: SegKind;
  lap: boolean;
  spm?: number;
  cad?: number;
  distM?: number;
  label?: string;
}

const r5 = (s: number): number => Math.max(5, Math.round(s / 5) * 5);
const OW_FACTOR = 0.97;
const BIKE_ROAD: BikePhys = { massKg: 82, crr: 0.005, cda: 0.37, rho: 1.2 };
const BIKE_TT: BikePhys = { massKg: 81.5, crr: 0.004, cda: 0.27, rho: 1.2 };

const compass = (deg: number): number => ((90 - deg) * Math.PI) / 180;

function easyX(family: Family, intensity: IntensityClass): number {
  const run = family === 'run' || family === 'swim_ow';
  switch (intensity) {
    case 'recovery':
      return run ? 0.7 : 0.5;
    case 'endurance':
      return run ? 0.77 : 0.66;
    case 'tempo':
      return run ? 0.88 : 0.8;
    case 'threshold':
      return run ? 0.97 : 0.93;
    case 'high':
      return run ? 0.85 : 0.75;
    case 'race':
      return run ? 0.95 : 0.85;
  }
}

function decideExec(rng: Rng, ctx: ModelCtx, p: SynthPlannedSession | undefined, isRace: boolean, isTest: boolean): Exec {
  const bias = rng.clippedNormal(0.004, 0.014);
  if (isRace || isTest) return { kind: 'on', scale: 1, bias: Math.abs(bias) };
  if (ctx.sickTomorrow) return { kind: 'short', scale: rng.range(0.5, 0.68), bias: -0.05, reason: 'sick_onset' };
  if (!p) return { kind: 'on', scale: 1, bias };
  const extendable = p.tags.includes('long') || p.intensity === 'endurance' || p.intensity === 'recovery';
  const r = rng.next();
  if (r < 0.055) return { kind: 'short', scale: rng.range(0.56, 0.78), bias: bias - 0.02, reason: rng.pick(['tired', 'time', 'time', 'niggle'] as const) };
  if (r < 0.068) return { kind: 'off_short', scale: rng.range(0.36, 0.47), bias: bias - 0.04, reason: rng.pick(['tired', 'time'] as const) };
  if (r < 0.11 && extendable && p.sport !== 'strength' && p.sport !== 'swim') return { kind: 'long', scale: rng.range(1.22, 1.38), bias, reason: 'great' };
  return { kind: 'on', scale: 1, bias };
}

/** Planned structure → nominal steps (continuous families). */
function stepsFromStructure(p: SynthPlannedSession, family: Family, ctx: ModelCtx, exec: Exec, rng: Rng): NomStep[] {
  const thr = ctx.thr;
  const out: NomStep[] = [];
  const flat = flatten(p.structure!);
  const testKind = p.tags.find((t) => t.startsWith('test:'))?.slice(5);
  for (const fs of flat) {
    const st = fs.step;
    let [x0, x1] = targetX(st.target, st.role, family, thr);
    let kind: SegKind = st.role === 'rest' ? 'rest' : 'move';
    if (st.role === 'rest' && (!st.target || st.target.type === 'open')) {
      x0 = x1 = 0;
    }
    if (kind === 'move') {
      // execution: athlete bias, rep-to-rep noise, first-rep overcook, late fade
      let f = 1 + exec.bias + rng.normal(0, st.role === 'active' ? 0.012 : 0.02);
      if (st.role === 'active' && fs.repCount > 2) {
        if (fs.rep === 0) f += 0.02;
        f -= 0.004 * fs.rep * (x0 > 1 ? 1 : 0.3);
      }
      x0 *= f;
      x1 *= f;
    }
    let dur: number;
    let distM: number | undefined;
    // test sessions: performance matches the threshold established that day
    if (testKind === 'ftp_20' && st.label === '20′ TT') x0 = x1 = ctx.thrNext.ftp / 0.95 / thr.ftp;
    if (testKind === 'run_tt30' && st.label === '30′ TT') x0 = x1 = ctx.thrNext.runMps / thr.runMps;
    if (testKind === 'row_2k' && st.label === '2k test') x0 = x1 = ctx.thrNext.rowW / 0.75 / thr.rowW;
    const m = st.measure;
    if (m.type === 'time') dur = m.sec;
    else if (m.type === 'lap_button') dur = 300;
    else if (m.type === 'reps') dur = m.n * 3;
    else {
      distM = m.m;
      const xm = (x0 + x1) / 2;
      let v: number;
      if (family === 'run') v = Math.max(1, xm * thr.runMps);
      else if (family === 'row') v = rowSpeedFromPower(Math.max(40, xm * thr.rowW));
      else if (family === 'swim_ow') v = Math.max(0.4, xm * thr.cssMps * OW_FACTOR);
      else v = 3 + 6 * xm;
      dur = r5(m.m / v);
      const vExact = m.m / dur;
      if (family === 'run') x0 = x1 = vExact / thr.runMps;
      else if (family === 'row') x0 = x1 = (2.8 * vExact ** 3) / thr.rowW;
      else if (family === 'swim_ow') x0 = x1 = vExact / (thr.cssMps * OW_FACTOR);
    }
    if (testKind === 'ftp_ramp' && st.target?.type === 'ramp') {
      // ramp to failure: stop when 1-min power reaches newFTP / 0.75
      const peak = ctx.thrNext.ftp / 0.75 / thr.ftp;
      const frac = clamp((peak - x0) / (x1 - x0), 0.3, 1);
      dur = dur * frac;
      x1 = x0 + (x1 - x0) * frac;
    }
    const spm = st.row ? Math.round(((st.row.strokeRateLow ?? 20) + (st.row.strokeRateHigh ?? st.row.strokeRateLow ?? 20)) / 2) : undefined;
    const cadT = st.secondary?.type === 'cadence' ? (st.secondary.low + st.secondary.high) / 2 : undefined;
    const ns: NomStep = { dur: r5(dur), x0, x1, role: st.role, kind, lap: true };
    if (spm) ns.spm = spm;
    if (cadT) ns.cad = cadT;
    if (distM) ns.distM = distM;
    if (st.label) ns.label = st.label;
    out.push(ns);
  }
  return out;
}

function raceX(family: Family, distM: number, tags: string[]): number {
  if (family === 'run') {
    if (distM <= 5000) return tags.includes('C-race') ? 1.0 : 1.06;
    if (distM <= 10000) return 1.03;
    return tags.includes('A-race') ? 0.875 : 0.97;
  }
  if (family === 'bike') return distM > 50000 ? 0.79 : 0.92;
  if (family === 'swim_ow') return distM > 1000 ? 0.96 : 1.01;
  return 0.9;
}

/** Unstructured / unplanned → nominal steps. */
function stepsUnstructured(h: Header, p: SynthPlannedSession | undefined, family: Family, ctx: ModelCtx, exec: Exec, rng: Rng, indoorSwap: boolean): NomStep[] {
  const thr = ctx.thr;
  const intensity: IntensityClass = p?.intensity ?? 'endurance';
  let total = p?.plannedDurationSec ?? 0;
  if (!p) {
    // unplanned: duration from the kind of activity
    total =
      family === 'walk' ? rng.int(5, 14) * 300 : family === 'hike' ? rng.int(18, 34) * 300 : family === 'yoga' ? rng.pick([1800, 2700, 3600]) : family === 'bike' ? rng.int(10, 20) * 300 : rng.int(6, 10) * 300;
  }
  if (indoorSwap) total = Math.min(total, rng.pick([4500, 5400, 5400, 6000]));
  const out: NomStep[] = [];
  if (p?.tags.includes('race') && p.plannedDistanceM) {
    const x = raceX(family, p.plannedDistanceM, p.tags) * (1 + exec.bias * 0.5);
    let v: number;
    if (family === 'run') v = x * ctx.thrNext.runMps;
    else if (family === 'swim_ow') v = x * thr.cssMps * OW_FACTOR;
    else v = bikeSpeed(x * thr.ftp, 0, BIKE_TT, 9) * 0.955;
    out.push({ dur: r5(p.plannedDistanceM / v), x0: x, x1: x, role: 'active', kind: 'move', lap: false });
    return out;
  }
  if (family === 'walk' || family === 'hike') {
    const v = family === 'walk' ? rng.range(1.35, 1.5) : rng.range(1.15, 1.3);
    out.push({ dur: r5(total), x0: v, x1: v, role: 'active', kind: 'move', lap: false });
    return out;
  }
  if (family === 'yoga') {
    let t = 0;
    while (t < total) {
      const d = r5(Math.min(total - t, rng.range(120, 420)));
      const x = rng.range(0.08, 0.3);
      out.push({ dur: d, x0: x, x1: x, role: 'active', kind: 'move', lap: false });
      t += d;
    }
    return out;
  }
  let x = indoorSwap ? 0.68 : easyX(family, intensity);
  if (!p && family === 'bike') x = rng.range(0.55, 0.64);
  x *= 1 + exec.bias;
  const wu = family === 'bike' ? 600 : 300;
  const cd = family === 'bike' ? 300 : 180;
  if (total > wu + cd + 600) {
    out.push({ dur: wu, x0: x * 0.75, x1: x, role: 'warmup', kind: 'move', lap: false });
    // long endurance: slow drift of effort + a couple of harder surges (group ride, climbs)
    const main = total - wu - cd;
    const pieces = Math.max(1, Math.round(main / 1800));
    for (let i = 0; i < pieces; i++) {
      const xi = x * (1 + rng.normal(0, 0.025));
      out.push({ dur: r5(main / pieces), x0: xi, x1: xi, role: 'active', kind: 'move', lap: false });
    }
    out.push({ dur: cd, x0: x * 0.85, x1: x * 0.7, role: 'cooldown', kind: 'move', lap: false });
  } else {
    out.push({ dur: r5(total), x0: x, x1: x, role: 'active', kind: 'move', lap: false });
  }
  return out;
}

function applyExec(steps: NomStep[], exec: Exec, family: Family, unstructured: boolean): NomStep[] {
  if (exec.kind === 'on') return steps;
  const total = steps.reduce((a, s) => a + s.dur, 0);
  if (exec.kind === 'long') {
    if (unstructured) {
      // stretch the main pieces
      return steps.map((s) => (s.role === 'active' ? { ...s, dur: r5(s.dur * (1 + ((exec.scale - 1) * total) / mainDur(steps))) } : s));
    }
    const x = family === 'run' ? 0.76 : 0.65;
    const extra = r5(total * (exec.scale - 1));
    const out = [...steps];
    out.splice(Math.max(0, out.length - 1), 0, { dur: extra, x0: x, x1: x, role: 'active', kind: 'move', lap: true, label: 'Extra Z2' });
    return out;
  }
  const cut = total * exec.scale;
  const out: NomStep[] = [];
  let acc = 0;
  for (const s of steps) {
    if (acc + s.dur <= cut) {
      out.push(s);
      acc += s.dur;
      continue;
    }
    const rem = cut - acc;
    if (rem >= 30) out.push({ ...s, dur: r5(rem) });
    break;
  }
  if (!unstructured && (family === 'bike' || family === 'run' || family === 'row')) {
    const x = family === 'run' ? 0.68 : 0.48;
    out.push({ dur: 300, x0: x, x1: x * 0.9, role: 'cooldown', kind: 'move', lap: true });
  }
  return out.length ? out : steps.slice(0, 1);
}

function mainDur(steps: NomStep[]): number {
  return steps.filter((s) => s.role === 'active').reduce((a, s) => a + s.dur, 0) || 1;
}

/** Insert traffic stops (recorded, speed 0) and auto-pause gaps into a step list → segments. */
function toSegments(steps: NomStep[], family: Family, h: Header, p: SynthPlannedSession | undefined, indoor: boolean, rng: Rng): { segs: Seg[]; laps: LapSpec[] | null } {
  const segs: Seg[] = [];
  let t = 0;
  let lap = -1;
  const structured = steps.some((s) => s.lap);
  const push = (dur: number, s: NomStep, x0: number, x1: number, kind: SegKind = s.kind) => {
    const seg: Seg = { start: t, dur, x0, x1, kind, lap, role: s.role };
    if (s.spm) seg.spm = s.spm;
    if (s.cad) seg.cad = s.cad;
    segs.push(seg);
    t += dur;
  };
  const total = steps.reduce((a, s) => a + s.dur, 0);
  const outdoorMove = !indoor && (family === 'bike' || family === 'run' || family === 'walk' || family === 'hike');
  const urban = outdoorMove && h.subSport !== 'track' && h.subSport !== 'trail' && !p?.tags.includes('race') && h.subSport !== 'open_water';
  // stop times (relative to moving time)
  const stops: { at: number; dur: number; kind: SegKind }[] = [];
  if (urban) {
    const n = family === 'bike' ? rng.int(3, 6) : family === 'run' ? rng.int(0, 3) : rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const early = rng.chance(0.5);
      const at = early ? rng.range(60, Math.min(900, total * 0.2)) : total - rng.range(60, Math.min(900, total * 0.2));
      stops.push({ at, dur: r5(rng.range(10, family === 'bike' ? 45 : 25)), kind: 'stop' });
    }
  }
  if (family === 'bike' && !indoor && total >= 7000 && !p?.tags.includes('race') && rng.chance(0.62)) {
    stops.push({ at: total * rng.range(0.5, 0.66), dur: Math.round(rng.range(600, 1500) / 10) * 10, kind: 'pause' });
  }
  if (family === 'hike' && total > 5400) stops.push({ at: total * rng.range(0.42, 0.55), dur: r5(rng.range(900, 1800)), kind: 'stop' });
  stops.sort((a, b) => a.at - b.at);
  const lapStarts: number[] = [];
  let moved = 0;
  let si = 0;
  for (const s of steps) {
    if (s.lap || lap < 0) {
      lap++;
      lapStarts.push(t);
    }
    let remaining = s.dur;
    let done = 0;
    while (remaining > 0) {
      const st = stops[si];
      if (st && s.kind === 'move' && st.at >= moved && st.at < moved + remaining) {
        let first = r5(st.at - moved);
        if (st.kind === 'pause' && (t + first) % 10 !== 0) first += 5;
        const firstDur = Math.min(remaining, first);
        if (firstDur > 0 && firstDur < remaining) {
          const f0 = done / s.dur;
          const f1 = (done + firstDur) / s.dur;
          push(firstDur, s, s.x0 + (s.x1 - s.x0) * f0, s.x0 + (s.x1 - s.x0) * f1);
          moved += firstDur;
          done += firstDur;
          remaining -= firstDur;
        }
        push(st.dur, s, 0, 0, st.kind);
        si++;
        continue;
      }
      if (st && st.at < moved) {
        si++;
        continue;
      }
      const f0 = done / s.dur;
      push(remaining, s, s.x0 + (s.x1 - s.x0) * f0, s.x1);
      moved += remaining;
      done += remaining;
      remaining = 0;
    }
  }
  // real recordings stop at an arbitrary second, not on the 5 s grid
  const tail = rng.int(0, 4);
  if (tail && segs.length) {
    segs[segs.length - 1]!.dur += tail;
    t += tail;
  }
  let laps: LapSpec[] | null = null;
  if (structured) {
    laps = lapStarts.map((st, i) => ({ start: st, end: i + 1 < lapStarts.length ? lapStarts[i + 1]! : t }));
  }
  return { segs, laps };
}

// ───────────────────────────── pool swim ─────────────────────────────

function buildPoolSwim(p: SynthPlannedSession | undefined, ctx: ModelCtx, exec: Exec, rng: Rng) {
  const pool = p?.structure?.poolLengthM ?? 25;
  const css = ctx.thr.cssMps;
  const lengths: SwimLen[] = [];
  const laps: SwimLapSpec[] = [];
  const segs: Seg[] = [];
  let t = 0;
  let lapIdx = 0;
  const flat = p?.structure ? flatten(p.structure) : [];
  const testKind = p?.tags.find((x) => x.startsWith('test:'))?.slice(5);
  interface Rep {
    distM: number;
    x: number;
    stroke: string;
    pull: boolean;
    sendOff?: number;
    rest: number;
    restOnly?: number;
  }
  let reps: Rep[] = [];
  if (flat.length === 0) {
    reps = [{ distM: 1500, x: 0.85, stroke: 'free', pull: false, rest: 0 }];
  } else {
    for (const fs of flat) {
      const st = fs.step;
      if (st.measure.type === 'time') {
        reps.push({ distM: 0, x: 0, stroke: 'rest', pull: false, rest: 0, restOnly: st.measure.sec });
        continue;
      }
      if (st.measure.type !== 'distance') continue;
      const [x0, x1] = targetX(st.target, st.role, 'swim_pool', ctx.thr);
      let x = (x0 + x1) / 2;
      if (testKind === 'css' && st.label === '400 TT') {
        const v200 = ctx.thrNext.cssMps * 1.065;
        const t400 = 200 / v200 + 200 / ctx.thrNext.cssMps;
        x = 400 / t400 / css;
      } else if (testKind === 'css' && st.label === '200 TT') x = (ctx.thrNext.cssMps * 1.065) / css;
      else x *= 1 + exec.bias + rng.normal(0, 0.01) + (fs.repCount > 4 ? -0.002 * fs.rep : 0);
      const r: Rep = {
        distM: st.measure.m,
        x,
        stroke: st.swim?.stroke ?? 'free',
        pull: !!st.swim?.equipment?.includes('pull_buoy'),
        rest: st.swim?.restSec ?? 0,
      };
      if (st.swim?.sendOffSec) r.sendOff = st.swim.sendOffSec;
      reps.push(r);
    }
  }
  // execution
  if (exec.kind === 'short' || exec.kind === 'off_short') {
    const totalD = reps.reduce((a, r) => a + r.distM, 0);
    let acc = 0;
    const keep: Rep[] = [];
    for (const r of reps) {
      if (acc + r.distM > totalD * exec.scale && keep.length > 0) break;
      keep.push(r);
      acc += r.distM;
    }
    reps = keep;
  }
  const strokeFor = (s: string, i: number): SwimStrokeName =>
    s === 'drill' || s === 'kick' ? 'drill' : s === 'back' ? 'back' : s === 'breast' ? 'breast' : s === 'fly' ? 'fly' : s === 'choice' ? (i % 4 === 3 ? 'back' : 'free') : s === 'im' ? (['fly', 'back', 'breast', 'free'] as const)[i % 4]! : 'free';
  for (const r of reps) {
    if (r.restOnly) {
      laps.push({ start: t, dur: r.restOnly, isRest: true, stroke: 'rest', lengths: 0, distM: 0 });
      segs.push({ start: t, dur: r.restOnly, x0: 0, x1: 0, kind: 'rest', lap: lapIdx++, role: 'rest' });
      t += r.restOnly;
      continue;
    }
    const n = Math.max(1, Math.round(r.distM / pool));
    const repStart = t;
    const strokeSet = new Set<string>();
    for (let i = 0; i < n; i++) {
      const stroke = strokeFor(r.stroke, i);
      strokeSet.add(stroke);
      const sf = stroke === 'back' ? 0.9 : stroke === 'breast' ? 0.78 : stroke === 'drill' ? 0.8 : stroke === 'fly' ? 0.92 : 1;
      const lenF = (i === 0 ? 0.97 : 1.01) * (1 + rng.normal(0, 0.018));
      const v = r.x * css * sf * (r.pull ? 1.02 : 1);
      const dur = Math.round(((pool / v) * lenF) * 10) / 10;
      const strokes = stroke === 'drill' ? 0 : Math.max(5, Math.round(strokesPerLength(r.x, stroke, pool) * (r.pull ? 0.93 : 1) + rng.normal(0, 0.6)));
      lengths.push({ start: t, dur, stroke, strokes, lap: lapIdx });
      segs.push({ start: t, dur, x0: r.x * sf, x1: r.x * sf, kind: 'move', lap: lapIdx, role: 'active' });
      t += dur;
    }
    const lapStroke = strokeSet.size > 1 ? 'mixed' : [...strokeSet][0]!;
    laps.push({ start: repStart, dur: t - repStart, isRest: false, stroke: lapStroke, lengths: n, distM: n * pool });
    lapIdx++;
    let rest = r.sendOff ? r.sendOff - (t - repStart) : r.rest;
    if (r.sendOff && rest < 4) rest = 4 + rng.range(0, 3);
    rest = Math.round(Math.max(0, rest + rng.range(0, 4)) * 10) / 10;
    if (rest >= 4) {
      laps.push({ start: t, dur: rest, isRest: true, stroke: 'rest', lengths: 0, distM: 0 });
      segs.push({ start: t, dur: rest, x0: 0, x1: 0, kind: 'rest', lap: lapIdx++, role: 'rest' });
      t += rest;
    }
  }
  // drop a trailing rest
  while (laps.length && laps[laps.length - 1]!.isRest) {
    const l = laps.pop()!;
    segs.pop();
    t -= l.dur;
  }
  return { pool, lengths, laps, segs, dur: Math.ceil(t) };
}

// ───────────────────────────── strength ─────────────────────────────

function buildStrength(p: SynthPlannedSession | undefined, exec: Exec, rng: Rng) {
  const items: StrengthItem[] = [];
  const segs: Seg[] = [];
  let t = 0;
  const wu = EXERCISES.warmup!;
  const wuDur = r5(rng.range(360, 540));
  items.push({ exercise: wu.name, category: wu.category, fit: wu.fit, start: 0, dur: wuDur, isRest: false });
  segs.push({ start: 0, dur: wuDur, x0: 0.35, x1: 0.45, kind: 'move', lap: 0, role: 'warmup' });
  t = wuDur;
  const flat = p?.structure ? flatten(p.structure).filter((f) => f.step.strength) : [];
  const rxs = flat.map((f) => f.step.strength!);
  if (rxs.length === 0) rxs.push({ exercise: 'Plank', sets: 3, durationSec: 45, restSec: 45 }, { exercise: 'Glute bridge', sets: 3, reps: 15, restSec: 30 });
  const totalSets = rxs.reduce((a, r) => a + r.sets, 0);
  const keepSets = exec.kind === 'on' || exec.kind === 'long' ? totalSets : Math.max(3, Math.round(totalSets * exec.scale));
  let done = 0;
  for (const rx of rxs) {
    const def = exerciseByName(rx.exercise);
    const heavy = rx.weightKg && rx.weightKg > 40 ? 1 : 0.6;
    for (let s = 0; s < rx.sets && done < keepSets; s++, done++) {
      let reps = rx.reps;
      if (reps && s === rx.sets - 1 && rng.chance(0.18)) reps = Math.max(1, reps - rng.int(1, 2));
      const work = rx.durationSec ? rx.durationSec : Math.round((reps ?? 10) * rng.range(2.6, 3.6) + 4);
      const item: StrengthItem = { exercise: rx.exercise, category: def?.category ?? 'CORE', fit: def?.fit ?? 'core', start: t, dur: work, isRest: false };
      if (reps) item.reps = reps;
      if (rx.weightKg !== undefined && rx.weightKg > 0) item.weightKg = rx.weightKg;
      items.push(item);
      const xw = 0.42 + 0.25 * heavy + rng.range(-0.03, 0.03);
      segs.push({ start: t, dur: work, x0: xw, x1: xw * 1.08, kind: 'move', lap: 0, role: 'active' });
      t += work;
      const last = done === keepSets - 1;
      if (!last) {
        const rest = Math.round((rx.restSec ?? 90) * rng.range(0.85, 1.35) + (s === rx.sets - 1 ? rng.range(30, 90) : 0));
        items.push({ exercise: 'Rest', category: 'REST', fit: 'rest', start: t, dur: rest, isRest: true });
        segs.push({ start: t, dur: rest, x0: 0.12, x1: 0.12, kind: 'rest', lap: 0, role: 'rest' });
        t += rest;
      }
    }
  }
  return { items, segs, dur: Math.ceil(t) };
}

// ───────────────────────────── course selection ─────────────────────────────

function chooseCourse(h: Header, p: SynthPlannedSession | undefined, family: Family, ctx: ModelCtx, distM: number, rng: Rng): Course {
  const title = h.title;
  const tags = p?.tags ?? [];
  const race = tags.includes('race');
  const vac = ctx.place === 'vacation';
  const o: CourseOpts = { kind: 'loop', origin: PLACES.home, distM, gain: distM * 0.008 };
  if (family === 'bike') {
    if (race) Object.assign(o, title.includes('Banyoles') ? { origin: PLACES.banyolesLake, laps: 2, gain: distM * 0.006 } : { origin: PLACES.platjaDaro, gain: distM * 0.0085 });
    else if (tags.includes('hilly') && distM > 50000) Object.assign(o, { kind: 'outback', heading: compass(305), gain: distM * 0.009, climb: { len: 13000, gain: 900 } });
    else if (title.includes('Banyoles')) Object.assign(o, { heading: compass(350), gain: distM * 0.009 });
    else if (title.includes('Coast')) Object.assign(o, { heading: compass(125), gain: distM * 0.011 });
    else if (title.includes('Gavarres')) Object.assign(o, { heading: compass(185), gain: distM * 0.013 });
    else Object.assign(o, { heading: rng.range(0, 6.28), gain: distM * rng.range(0.006, 0.011) });
  } else if (family === 'run') {
    if (h.subSport === 'track') Object.assign(o, { kind: 'oval', origin: PLACES.track });
    else if (race) Object.assign(o, title.includes('Banyoles') ? { origin: PLACES.banyolesLake, gain: distM * 0.003 } : title.includes('Costa') ? { origin: PLACES.platjaDaro, laps: 2, gain: distM * 0.002 } : { origin: PLACES.devesa, laps: 2, gain: distM * 0.003 });
    else if (vac) Object.assign(o, { origin: PLACES.nuria, gain: distM * 0.03 });
    else if (h.subSport === 'trail') Object.assign(o, { origin: PLACES.gavarres, gain: distM * rng.range(0.03, 0.042) });
    else if (tags.includes('long')) Object.assign(o, { kind: 'outback', heading: compass(290), gain: distM * 0.006 });
    else if (tags.includes('hills')) Object.assign(o, { kind: 'outback', heading: compass(70), gain: distM * 0.025 });
    else Object.assign(o, { origin: PLACES.devesa, gain: distM * 0.003, laps: distM > 9000 ? 2 : 1 });
  } else if (family === 'swim_ow') {
    Object.assign(o, { kind: 'triangle', origin: race && title.includes('Costa') ? { ...PLACES.platjaDaro, alt: 0 } : PLACES.banyolesLake, laps: race ? 1 : 2, gain: 0 });
  } else if (family === 'hike') {
    if (vac) Object.assign(o, { kind: 'outback', origin: PLACES.nuria, gain: distM * 0.06, climb: { len: Math.min(6000, distM * 0.35), gain: 750 } });
    else Object.assign(o, { origin: PLACES.gavarres, gain: distM * 0.045 });
  } else if (family === 'walk') {
    Object.assign(o, { origin: vac ? PLACES.nuria : PLACES.devesa, gain: distM * (vac ? 0.02 : 0.004) });
  }
  return makeCourse(rng, o);
}

// ───────────────────────────── estimated load ─────────────────────────────

function estimateLoad(family: Family, segs: Seg[], dur: number): number {
  let s = 0;
  for (const g of segs) {
    if (g.kind !== 'move') continue;
    const x = (g.x0 + g.x1) / 2;
    const h = g.dur / 3600;
    switch (family) {
      case 'swim_pool':
      case 'swim_ow':
        s += 100 * h * x * x * x;
        break;
      case 'bike':
      case 'row':
      case 'run':
        s += 100 * h * x * x;
        break;
      case 'walk':
        s += 25 * h;
        break;
      case 'hike':
        s += 42 * h;
        break;
      case 'yoga':
        s += 20 * h;
        break;
      case 'strength':
        break;
    }
  }
  if (family === 'strength') s = (dur / 3600) * 60;
  return s;
}

// ───────────────────────────── main ─────────────────────────────

export function buildModel(ctx: ModelCtx, h: Header, p: SynthPlannedSession | undefined): Model {
  const family = familyOf(h.sport, h.subSport);
  const indoor = isIndoor(h.sport, h.subSport);
  const rng = rngFor(ctx.seed, 'model', h.id);
  const isRace = !!p?.tags.includes('race');
  const isTest = !!p?.tags.includes('test');
  const exec = decideExec(rngFor(ctx.seed, 'exec', h.id), ctx, p, isRace, isTest);
  const intensity: IntensityClass = p?.intensity ?? (family === 'walk' || family === 'yoga' ? 'recovery' : 'endurance');
  const bike = isRace && family === 'bike' ? BIKE_TT : BIKE_ROAD;
  const base = {
    seed: ctx.seed,
    header: h,
    family,
    indoor,
    exec,
    tempC: ctx.tempC,
    bike,
    isRace,
    isTest,
    intensity,
  };

  if (family === 'swim_pool') {
    const sw = buildPoolSwim(p, ctx, exec, rng);
    return {
      ...base,
      hasGps: false,
      dur: sw.dur,
      segs: sw.segs,
      laps: null,
      autoLapM: 0,
      swim: { poolLengthM: sw.pool, lengths: sw.lengths, laps: sw.laps },
      estLoad: estimateLoad(family, sw.segs, sw.dur),
    };
  }
  if (family === 'strength') {
    const st = buildStrength(p, exec, rng);
    return { ...base, hasGps: false, dur: st.dur, segs: st.segs, laps: null, autoLapM: 0, strength: { items: st.items }, estLoad: estimateLoad(family, st.segs, st.dur) };
  }

  const indoorSwap = !!p && p.environment === 'outdoor' && indoor;
  const structured = !!p?.structure && !indoorSwap && family !== 'yoga';
  let steps = structured ? stepsFromStructure(p!, family, ctx, exec, rng) : stepsUnstructured(h, p, family, ctx, exec, rng, indoorSwap);
  steps = applyExec(steps, exec, family, !structured);
  const { segs, laps } = toSegments(steps, family, h, p, indoor, rng);
  const last = segs[segs.length - 1]!;
  const dur = last.start + last.dur;

  const hasGps = !indoor && family !== 'yoga';
  let course: Course | undefined;
  if (hasGps) {
    let dist = 0;
    for (const g of segs) {
      if (g.kind !== 'move') continue;
      const x = (g.x0 + g.x1) / 2;
      const v =
        family === 'bike'
          ? bikeSpeed(x * ctx.thr.ftp, 0, bike, 8) * 0.93
          : family === 'run'
            ? x * ctx.thr.runMps * (h.subSport === 'trail' ? 0.85 : 0.98)
            : family === 'swim_ow'
              ? x * ctx.thr.cssMps * OW_FACTOR
              : family === 'hike'
                ? x * 0.85
                : x;
      dist += v * g.dur;
    }
    course = chooseCourse(h, p, family, ctx, Math.max(400, dist), rngFor(ctx.seed, 'course', h.id));
  }
  const autoLapM = family === 'bike' ? 5000 : family === 'swim_ow' ? 500 : family === 'yoga' ? 0 : 1000;
  const m: Model = { ...base, hasGps, dur, segs, laps, autoLapM, estLoad: estimateLoad(family, segs, dur) };
  if (course) m.course = course;
  return m;
}
