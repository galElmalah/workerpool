/** Formatting helpers shared by every chart. Minus is always U+2212, units follow a thin space. */
import type { LocalDate } from '@cadence/core';

export const MINUS = '−';
export const THIN = ' ';
export const DASH = '–';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Replace ASCII hyphen-minus in a formatted number with U+2212. */
export const minus = (s: string) => s.replace(/^-/, MINUS).replace(/(\s)-/g, `$1${MINUS}`);

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const v = n.toFixed(digits);
  return minus(v === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : v);
}

/** Thousands-grouped integer. */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return minus(Math.round(n).toLocaleString('en-US'));
}

/** Always signed: +8, −3, ±0. */
export function fmtSigned(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const r = Number(n.toFixed(digits));
  if (r === 0) return `±${(0).toFixed(digits)}`;
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(digits)}`;
}

/** Fraction → signed percent ("+8%", "−12%", "±0%"). */
export function fmtPct(frac: number | null | undefined, digits = 0): string {
  if (frac == null || !Number.isFinite(frac)) return DASH;
  return `${fmtSigned(frac * 100, digits)}%`;
}

export type DeltaDir = 'up' | 'down' | 'flat';
/** Delta direction per design.md §2.4 (flat when |Δ| < threshold). */
export function deltaDir(frac: number | null | undefined, flat = 0.01): DeltaDir {
  if (frac == null || !Number.isFinite(frac) || Math.abs(frac) < flat) return 'flat';
  return frac > 0 ? 'up' : 'down';
}

/** 3725 → "1:02:05"; 545 → "9:05". */
export function fmtHMS(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return DASH;
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

/** Seconds → "9:40" (hours:minutes). */
export function fmtHM(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return DASH;
  const m = Math.round(Math.max(0, sec) / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Compact duration for log axes and curve readouts: 1s, 15s, 1m, 5m, 20m, 1h, 2h 30m. */
export function fmtDurShort(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s ? `${m}m${String(s).padStart(2, '0')}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Speed (m/s) → pace string "4:05" per `per` metres (1000 = /km, 100 = /100 m, 500 = /500 m). */
export function fmtPace(mps: number | null | undefined, per = 1000): string {
  if (mps == null || !Number.isFinite(mps) || mps <= 0.05) return DASH;
  const sec = per / mps;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtKm(m: number | null | undefined, digits = 1): string {
  if (m == null || !Number.isFinite(m)) return DASH;
  return (m / 1000).toFixed(digits);
}

// ── dates (LocalDate strings, UTC-noon arithmetic so DST never bites) ──

export function dateMs(d: LocalDate): number {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
}
export function msDate(ms: number): LocalDate {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
export const DAY_MS = 86_400_000;
export const addDaysLD = (d: LocalDate, n: number) => msDate(dateMs(d) + n * DAY_MS);

/** "Nov 21" */
export function fmtMonthDay(d: LocalDate | number): string {
  const dt = new Date(typeof d === 'number' ? d : dateMs(d));
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
/** "Sat 21 Nov" */
export function fmtDayLong(d: LocalDate | number): string {
  const dt = new Date(typeof d === 'number' ? d : dateMs(d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}
/** "Nov" / "Nov ’26" */
export function fmtMonth(d: LocalDate | number, withYear = false): string {
  const dt = new Date(typeof d === 'number' ? d : dateMs(d));
  return withYear ? `${MONTHS[dt.getUTCMonth()]} ’${String(dt.getUTCFullYear()).slice(2)}` : MONTHS[dt.getUTCMonth()];
}
export function fmtWeekday(d: LocalDate | number): string {
  const dt = new Date(typeof d === 'number' ? d : dateMs(d));
  return WEEKDAYS[dt.getUTCDay()];
}
/** '2026-W47' → 'W47' */
export const fmtIsoWeekShort = (w: string) => w.slice(5);
