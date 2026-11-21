/**
 * Physiology & physics models shared by the season planner and the stream simulator.
 *
 * Intensity `x` is always relative to the sport's threshold (FTP, threshold run speed on the flat,
 * CSS, erg threshold power). Steady-state HR is a piecewise-linear function of x anchored so that
 * x = 1 → LTHR (+ sport offset), matching metrics.md §3 zone relationships.
 */
import { clamp } from './util';

/** Fraction of heart-rate reserve (rest→LTHR) at steady state for relative intensity x. */
export function hrFrac(x: number): number {
  if (x <= 0) return 0.3;
  if (x <= 1) return 0.3 + 0.7 * x;
  return 1 + 0.45 * (x - 1);
}

/** Inverse of hrFrac. */
export function hrFracInv(g: number): number {
  if (g <= 0.3) return 0;
  if (g <= 1) return (g - 0.3) / 0.7;
  return 1 + (g - 1) / 0.45;
}

/** Sport-specific HR offset vs running (bpm). */
export const SPORT_HR_OFFSET: Record<string, number> = {
  run: 0,
  bike: -6,
  swim_pool: -12,
  swim_ow: -9,
  row: -3,
  strength: 0,
  yoga: 0,
  walk: 0,
  hike: 0,
};

export interface HrParams {
  hrRest: number;
  lthr: number;
  hrMax: number;
}

export function steadyHr(x: number, p: HrParams, offset: number): number {
  return Math.min(p.hrMax - 1, p.hrRest + (p.lthr - p.hrRest) * hrFrac(x) + offset);
}

/** Relative intensity whose steady-state HR equals `hr` (no offsets). */
export function xFromHr(hr: number, p: HrParams): number {
  return hrFracInv((hr - p.hrRest) / (p.lthr - p.hrRest));
}

// ───────────────────────────── cycling physics ─────────────────────────────

export interface BikePhys {
  massKg: number; // rider + bike
  crr: number;
  cda: number;
  rho: number;
}

const G = 9.81;

/** Steady speed (m/s) for power P (W) on a grade (rise/run). Newton on the cubic, warm-started. */
export function bikeSpeed(P: number, grade: number, ph: BikePhys, guess = 8): number {
  const theta = Math.atan(grade);
  const fGrav = ph.massKg * G * (Math.sin(theta) + ph.crr * Math.cos(theta));
  const k = 0.5 * ph.rho * ph.cda;
  if (P <= 0) {
    // coasting: k v^2 = -fGrav
    return fGrav < 0 ? Math.sqrt(-fGrav / k) : 0;
  }
  let v = Math.max(1, guess);
  for (let i = 0; i < 6; i++) {
    const f = k * v * v * v + fGrav * v - P;
    const df = 3 * k * v * v + fGrav;
    if (df <= 0.01) {
      v = v * 1.5 + 0.5;
      continue;
    }
    const nv = v - f / df;
    if (Math.abs(nv - v) < 1e-3) {
      v = nv;
      break;
    }
    v = nv > 0.3 ? nv : 0.3;
  }
  return v;
}

// ───────────────────────────── running ─────────────────────────────

/** Minetti (2002) energy-cost factor Cr(i)/Cr(0) for running on grade i. */
export function minettiFactor(i: number): number {
  const g = clamp(i, -0.45, 0.45);
  const cr = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return cr / 3.6;
}

/** Running cadence (steps/min) for a speed. */
export function runCadence(v: number): number {
  return clamp(150 + 7.6 * v, 150, 194);
}

/** Tobler's hiking function, m/s. */
export function toblerSpeed(grade: number, flatKmh = 5.2): number {
  return ((flatKmh / Math.exp(-3.5 * 0.05)) * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6;
}

// ───────────────────────────── swim ─────────────────────────────

/** Strokes per 25 m length (watch-arm count) for a speed relative to CSS. */
export function strokesPerLength(xRel: number, stroke: string, poolLen: number): number {
  const base = stroke === 'back' ? 12.5 : stroke === 'breast' ? 9 : stroke === 'fly' ? 9.5 : 11.2;
  // faster → slightly more strokes (higher turnover), pull buoy → fewer
  return ((base * (1 + 0.35 * (xRel - 0.95))) * poolLen) / 25;
}
