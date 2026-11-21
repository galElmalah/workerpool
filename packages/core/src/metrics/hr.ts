/**
 * Heart-rate load (metrics.md §2.6): Banister TRIMP summed per sample and
 * normalised so one hour at LTHR = 100 (HRSS), plus zone-time and secondary
 * TRIMP variants.
 */
import type { Settings } from '../domain';
import type { NumSeries } from './util';

export type Sex = Settings['sex'];

/** Banister TRIMP constants. 'unspecified' uses the average of male and female (architect decision). */
export function trimpConstants(sex: Sex | undefined): { a: number; b: number } {
  if (sex === 'male') return { a: 0.64, b: 1.92 };
  if (sex === 'female') return { a: 0.86, b: 1.67 };
  return { a: 0.75, b: 1.795 };
}

export interface HrParams {
  /** bpm */
  hrRest: number;
  /** bpm */
  hrMax: number;
  /** bpm */
  lthr: number;
  sex?: Sex;
}

function validParams(p: Partial<HrParams> | undefined): p is HrParams {
  return !!p && p.hrRest! > 0 && p.hrMax! > p.hrRest! && p.lthr! > p.hrRest! && p.lthr! <= p.hrMax!;
}

/** Heart-rate reserve fraction, clamped to [0, 1]. */
export function hrReserveFraction(hr: number, hrRest: number, hrMax: number): number {
  const x = (hr - hrRest) / (hrMax - hrRest);
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** TRIMP for one hour at LTHR (the HRSS normaliser). */
export function trimpLt1h(p: HrParams): number {
  const { a, b } = trimpConstants(p.sex);
  const x = hrReserveFraction(p.lthr, p.hrRest, p.hrMax);
  return 60 * x * a * Math.exp(b * x);
}

export interface HrLoadResult {
  /** HRSS: 100 = 1 h at LTHR. */
  load: number;
  /** Raw Banister TRIMP (arbitrary units). */
  trimp: number;
  /** Seconds that had a valid HR sample. */
  validSec: number;
}

/**
 * HR Load (HRSS) by per-sample summation over a 1 Hz HR series (§2.6.1).
 * Missing samples contribute nothing. Null when parameters are missing/invalid.
 */
export function hrLoad(hr: NumSeries, params: Partial<HrParams> | undefined, dtSec = 1): HrLoadResult | null {
  if (!validParams(params)) return null;
  const { a, b } = trimpConstants(params.sex);
  let trimp = 0;
  let valid = 0;
  const range = params.hrMax - params.hrRest;
  for (let i = 0; i < hr.length; i++) {
    const h = hr[i];
    if (typeof h !== 'number' || !Number.isFinite(h)) continue;
    let x = (h - params.hrRest) / range;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    trimp += (dtSec / 60) * x * a * Math.exp(b * x);
    valid++;
  }
  return { load: (100 * trimp) / trimpLt1h(params), trimp, validSec: valid * dtSec };
}

/**
 * HR Load from an average HR over a duration — the weaker shortcut, used only
 * for summary-only activities (it under-reads variable sessions, §2.6.1).
 */
export function hrLoadFromAverage(avgHr: number, durationSec: number, params: Partial<HrParams> | undefined): HrLoadResult | null {
  if (!validParams(params) || !(avgHr > 0) || !(durationSec > 0)) return null;
  const { a, b } = trimpConstants(params.sex);
  const x = hrReserveFraction(avgHr, params.hrRest, params.hrMax);
  const trimp = (durationSec / 60) * x * a * Math.exp(b * x);
  return { load: (100 * trimp) / trimpLt1h(params), trimp, validSec: durationSec };
}

/** Points per hour by Friel zone Z1…Z5c for the zone-time HR method (§2.6.2, ours). */
export const HR_ZONE_PPH: readonly number[] = [30, 55, 70, 85, 100, 120, 140];

/** Zone-time HR load: Σ (seconds in zone / 3600) × pph. Not the default method. */
export function hrZoneLoad(secondsInZone: readonly number[], pph: readonly number[] = HR_ZONE_PPH): number {
  let s = 0;
  for (let i = 0; i < secondsInZone.length && i < pph.length; i++) s += ((secondsInZone[i] || 0) / 3600) * pph[i];
  return s;
}

/** Edwards TRIMP (§2.6.3): Σ minutes in %HRmax band × k (50–60 → 1 … 90–100 → 5; < 50 → 0). */
export function edwardsTrimp(hr: NumSeries, hrMax: number, dtSec = 1): number | null {
  if (!(hrMax > 0)) return null;
  let s = 0;
  for (let i = 0; i < hr.length; i++) {
    const h = hr[i];
    if (typeof h !== 'number' || !Number.isFinite(h)) continue;
    const f = h / hrMax;
    const k = f >= 0.9 ? 5 : f >= 0.8 ? 4 : f >= 0.7 ? 3 : f >= 0.6 ? 2 : f >= 0.5 ? 1 : 0;
    s += (k * dtSec) / 60;
  }
  return s;
}

/** Tanaka age-predicted HRmax (bpm): 208 − 0.7 × age. */
export function tanakaHrMax(ageYears: number): number {
  return 208 - 0.7 * ageYears;
}
