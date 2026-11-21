import type { LocalDate } from '@cadence/core/domain';
import { addDays, isoWeekday, parseDate } from '@cadence/core/time';
import { rngFor } from './prng';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
export const round = (v: number, d = 0): number => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};
export const smoothstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Last Sunday of a month (1-based month) as a LocalDate. */
function lastSunday(year: number, month: number): LocalDate {
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return addDays(lastDay, -(isoWeekday(lastDay) % 7));
}

/** UTC offset (minutes) for Europe/Madrid on a local date (CET/CEST; daytime activities only). */
export function madridOffsetMin(date: LocalDate): number {
  const y = Number(date.slice(0, 4));
  return date >= lastSunday(y, 3) && date < lastSunday(y, 10) ? 120 : 60;
}

/** Epoch ms of a local wall-clock time on a date with a UTC offset. */
export function localToEpochMs(date: LocalDate, secOfDay: number, offsetMin: number): number {
  return parseDate(date) + secOfDay * 1000 - offsetMin * 60_000;
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function hhmmToSec(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3, 5)) * 60;
}

export function secToHhmm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'h:mm:ss' or 'm:ss'. */
export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

/** Pace 'm:ss' per km (run) from m/s. */
export function fmtPaceKm(mps: number): string {
  return fmtDuration(1000 / mps);
}

/** Pace 'm:ss' per 100 m (swim) from m/s. */
export function fmtPace100(mps: number): string {
  return fmtDuration(100 / mps);
}

/** Concept2 split 'm:ss.s' per 500 m from watts. */
export function fmtSplit500(watts: number): string {
  const pace = 500 * Math.cbrt(2.8 / watts);
  const m = Math.floor(pace / 60);
  return `${m}:${(pace - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function rowSpeedFromPower(watts: number): number {
  return watts > 0 ? Math.cbrt(watts / 2.8) : 0;
}

/** Girona monthly mean daily max / min air temperature (°C). */
const T_MAX = [13, 14, 17, 19, 23, 27, 30, 30, 26, 22, 16, 13];
const T_MIN = [2, 3, 5, 7, 11, 15, 18, 18, 15, 11, 6, 3];

/** Air temperature for a local date and hour (deterministic per seed+date). */
export function airTempC(seed: number, date: LocalDate, hour: number): number {
  const m = Number(date.slice(5, 7)) - 1;
  const d = Number(date.slice(8, 10));
  // interpolate monthly means mid-month
  const next = d >= 15 ? (m + 1) % 12 : (m + 11) % 12;
  const f = Math.abs(d - 15) / 30;
  const tmax = lerp(T_MAX[m]!, T_MAX[next]!, f);
  const tmin = lerp(T_MIN[m]!, T_MIN[next]!, f);
  // diurnal curve: min at 06:00, max at 15:00
  const ph = clamp((hour - 6) / 9, 0, 1);
  const diurnal = hour <= 15 ? smoothstep(ph) : 1 - smoothstep((hour - 15) / 12);
  const anomaly = rngFor(seed, 'wx', date).normal(0, 2.2);
  return tmin + (tmax - tmin) * diurnal + anomaly;
}

/** Is a date in the wet/cold season (more weather-related skips)? */
export function isWinter(date: LocalDate): boolean {
  const m = Number(date.slice(5, 7));
  return m === 11 || m === 12 || m <= 3;
}

export function isSummer(date: LocalDate): boolean {
  const m = Number(date.slice(5, 7));
  return m >= 5 && m <= 9;
}

/** Binary search: index of the last element with key ≤ x (or -1). */
export function upperIndex(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
