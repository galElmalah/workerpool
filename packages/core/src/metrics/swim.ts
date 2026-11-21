/**
 * Swimming (metrics.md §2.4, §4.2): Critical Swim Speed, Swim Load (IF³) and
 * pool best efforts from length/lap records.
 */
import type { BestEffort } from '../domain';
import { loadFromIntensity } from './power';
import { SWIM_EFFORT_DISTANCES } from './pace';

/** 1 yard in metres. Convert yard pools to metres before any computation. */
export const YARD_M = 0.9144;

/**
 * CSS (m/s) from two all-out trials (default 400 m & 200 m): (d1 − d2)/(t1 − t2).
 * Rejected (null) unless the shorter trial is faster per metre (§2.4.1).
 */
export function criticalSwimSpeed(t400Sec: number, t200Sec: number, dLong = 400, dShort = 200): number | null {
  if (!(t400Sec > 0) || !(t200Sec > 0) || !(dLong > dShort)) return null;
  if (!(t200Sec < t400Sec) || !(dShort / t200Sec > dLong / t400Sec)) return null;
  return (dLong - dShort) / (t400Sec - t200Sec);
}

export interface SwimLoadInput {
  distanceM: number;
  /** Moving time excluding rest (s). */
  movingSec?: number;
  /** Elapsed time including rest (s). */
  elapsedSec?: number;
  /** Critical swim speed (m/s). */
  cssMps: number | null | undefined;
  /** 'moving' (default, spec recommendation) or 'elapsed' (DECISION option). */
  mode?: 'moving' | 'elapsed';
}

export interface SwimLoadResult {
  /** m/s */
  speedMps: number;
  intensity: number;
  load: number;
  durationSec: number;
  /** True when moving time was unavailable and elapsed time was used (§2.4.2). */
  restUnknown: boolean;
}

/** Swim Load = 100 · hours · (v/CSS)³ with v = distance / moving time (§2.4.2). */
export function swimLoad(input: SwimLoadInput): SwimLoadResult | null {
  const { distanceM, cssMps } = input;
  if (!(distanceM > 0) || cssMps == null || !(cssMps > 0)) return null;
  let restUnknown = false;
  let dur: number | undefined;
  if (input.mode === 'elapsed') dur = input.elapsedSec ?? input.movingSec;
  else {
    dur = input.movingSec;
    if (!(dur && dur > 0)) {
      dur = input.elapsedSec;
      restUnknown = true;
    }
  }
  if (!(dur && dur > 0)) return null;
  const speedMps = distanceM / dur;
  const intensity = speedMps / cssMps;
  return { speedMps, intensity, load: loadFromIntensity(dur, intensity, 3), durationSec: dur, restUnknown };
}

/** A pool length or lap record. */
export interface SwimLength {
  distanceM?: number;
  durationSec: number;
  isRest?: boolean;
}

/**
 * Pool best efforts (§4.2): the minimum total time over contiguous active lengths
 * whose distance sum equals the target exactly. Rest lengths (or 0 m) break contiguity.
 * O(lengths²) worst case per target, fine for pool sessions.
 */
export function swimBestEfforts(lengths: readonly SwimLength[], targets: readonly number[] = SWIM_EFFORT_DISTANCES): BestEffort[] {
  const out: BestEffort[] = [];
  const startSec: number[] = [];
  let acc = 0;
  for (const l of lengths) {
    startSec.push(acc);
    acc += l.durationSec > 0 ? l.durationSec : 0;
  }
  for (const target of targets) {
    let best = Infinity;
    let at = -1;
    for (let i = 0; i < lengths.length; i++) {
      let d = 0;
      let t = 0;
      for (let j = i; j < lengths.length; j++) {
        const l = lengths[j];
        if (l.isRest || !(l.distanceM && l.distanceM > 0)) break;
        d += l.distanceM;
        t += l.durationSec;
        if (Math.abs(d - target) < 1e-6) {
          if (t < best) {
            best = t;
            at = i;
          }
          break;
        }
        if (d > target) break;
      }
    }
    if (at >= 0) out.push({ distanceM: target, timeSec: best, startSec: startSec[at] });
  }
  return out;
}
