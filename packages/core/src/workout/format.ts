/**
 * Number / duration / pace / distance formatting shared by the text serializer and the
 * human-readable describers. Pure and locale-independent.
 */
import type { Sport } from '../domain';

export type Units = 'metric' | 'imperial';
export type PaceUnit = 'km' | 'mi' | '100m' | '100y' | '500m';

/** Meters per pace unit. */
export const PACE_UNIT_M: Record<PaceUnit, number> = {
  km: 1000,
  mi: 1609.344,
  '100m': 100,
  '100y': 91.44,
  '500m': 500,
};
export const YARD_M = 0.9144;
export const MILE_M = 1609.344;
export const LB_KG = 0.45359237;

/** Shortest decimal string (≤ 6 decimals) that parses back to exactly `x` when possible. */
export function fmtNum(x: number, maxDecimals = 6): string {
  if (!Number.isFinite(x)) return '0';
  for (let d = 0; d <= maxDecimals; d++) {
    const s = x.toFixed(d);
    if (Number(s) === x) return trimZeros(s);
  }
  return trimZeros(x.toFixed(maxDecimals));
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Round to `step` (e.g. 0.01). */
export function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Clock format: 8:00, 45:30, 1:15:00. Seconds are rounded. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

/** Hours:minutes (calendar metrics line): 1:15, 0:45. */
export function fmtHMM(sec: number): string {
  const m = Math.round(Math.max(0, sec) / 60);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/** Compact title duration: 30″, 8′, 1′30″, 1:30 (h:mm for ≥ 1 h). */
export function fmtPrime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s >= 3600) return fmtHMM(s);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}″`;
  return r ? `${m}′${pad2(r)}″` : `${m}′`;
}

/** Pace seconds (per unit) → "4:30" or "1:45.5" (tenths kept when present). */
export function fmtPace(secPerUnit: number): string {
  const t = Math.round(secPerUnit * 10) / 10;
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  const whole = Math.floor(r + 1e-9);
  const tenth = Math.round((r - whole) * 10);
  return `${m}:${pad2(whole)}${tenth ? `.${tenth}` : ''}`;
}

/** Default pace unit for a sport. */
export function paceUnitFor(sport: Sport, units: Units = 'metric', yardsPool = false): PaceUnit {
  if (sport === 'swim') return yardsPool ? '100y' : '100m';
  if (sport === 'row') return '500m';
  return units === 'imperial' ? 'mi' : 'km';
}

/** Human distance: "400 m", "2 km", "1.5 mi", "100 yd". */
export function fmtDistance(m: number, sport: Sport, units: Units = 'metric', yards = false): string {
  if (sport === 'swim' || sport === 'row') {
    if (yards) return `${fmtNum(Math.round(m / YARD_M))} yd`;
    return `${fmtNum(Math.round(m))} m`;
  }
  if (units === 'imperial') {
    if (m < 0.25 * MILE_M) return `${fmtNum(Math.round(m / YARD_M))} yd`;
    return `${fmtNum(Math.round((m / MILE_M) * 100) / 100)} mi`;
  }
  if (m < 1000 || (m < 5000 && m % 100 === 0 && m % 1000 !== 0 && sport === 'run' && m < 3000)) return `${fmtNum(Math.round(m))} m`;
  return `${fmtNum(Math.round(m / 10) / 100)} km`;
}

/** Joins a low/high pair with an en dash, or one value when equal. */
export function fmtRange(low: string, high: string): string {
  return low === high ? low : `${low}–${high}`;
}
