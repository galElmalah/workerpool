/**
 * Pure formatters for every number, unit and date the UI shows. Rules (design.md §3):
 *  - minus is U+2212 (−), never a hyphen; signs are explicit on deltas (+12%, −8%, ±0%).
 *  - a narrow no-break space (U+202F) separates value and unit: `4:05 /km`, `245 W`, `62 bpm`.
 *  - durations: `1:15` (h:mm, calendar), `1:15:30` (h:mm:ss), `1h 15m` (prose), `45′` (agenda).
 *  - dates are LocalDate strings ('YYYY-MM-DD'), formatted in UTC so no timezone can shift them.
 * Everything here is side-effect free; pass `units` from `useUnits()`.
 */
import { isoWeekStart, addDays, diffDays } from '@cadence/core/time';
import { distanceUnit, paceBasis, M_PER_FT, M_PER_MI, KG_PER_LB, type UnitPrefs, type UnitSystem } from './units';

export const MINUS = '−';
export const NBSP = ' '; // narrow no-break space between value and unit
export const THIN = ' ';
export const EM_DASH = '—';
export const EN_DASH = '–';
export const PRIME = '′';
export const PLACEHOLDER = EM_DASH; // shown for missing values

const METRIC: UnitPrefs = { system: 'metric', swim: 'm' };

/** Replace ASCII hyphen-minus in a formatted number by U+2212. */
export const fixMinus = (s: string) => s.replace(/^-/, MINUS).replace(/(\s)-/g, `$1${MINUS}`);

const nf = new Map<string, Intl.NumberFormat>();
function numberFormat(min: number, max: number): Intl.NumberFormat {
  const k = `${min}:${max}`;
  let f = nf.get(k);
  if (!f) nf.set(k, (f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: min, maximumFractionDigits: max })));
  return f;
}

/** Grouped number: formatNumber(12500) → "12,500"; formatNumber(4.25, 1) → "4.3". */
export function formatNumber(n: number | null | undefined, decimals = 0, opts?: { trim?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return PLACEHOLDER;
  const s = numberFormat(opts?.trim ? 0 : decimals, decimals).format(n);
  return fixMinus(s === '-0' ? '0' : s);
}

/** "+3", "−13", "0" */
export function formatSigned(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return PLACEHOLDER;
  const r = Number(n.toFixed(decimals));
  if (r === 0) return formatNumber(0, decimals);
  return (r > 0 ? '+' : MINUS) + formatNumber(Math.abs(r), decimals);
}

// ───────────────────────────── durations ─────────────────────────────

export type DurationStyle = 'clock' | 'hms' | 'short' | 'prime';
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * formatDuration(4500)            → "1:15"     (h:mm, rounded to the minute)
 * formatDuration(4530, 'hms')     → "1:15:30"  ("45:30" under an hour, "0:42" under a minute)
 * formatDuration(4500, 'short')   → "1h 15m"   ("45m", "2h", "40s")
 * formatDuration(2700, 'prime')   → "45′"      ("1h 15′")
 */
export function formatDuration(sec: number | null | undefined, style: DurationStyle = 'clock'): string {
  if (sec == null || !Number.isFinite(sec)) return PLACEHOLDER;
  const neg = sec < 0;
  const s = Math.abs(sec);
  let out: string;
  if (style === 'hms') {
    const t = Math.round(s);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const ss = t % 60;
    out = h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  } else {
    const totalMin = Math.round(s / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (style === 'clock') out = `${h}:${pad(m)}`;
    else if (style === 'prime') out = h > 0 ? (m ? `${h}h${NBSP}${m}${PRIME}` : `${h}h`) : `${m}${PRIME}`;
    else if (s < 60) out = `${Math.round(s)}s`;
    else out = h > 0 ? (m ? `${h}h${NBSP}${m}m` : `${h}h`) : `${m}m`;
  }
  return neg ? MINUS + out : out;
}

/**
 * Smart duration parser for DurationField. Accepts "1:05:00", "1:05" (h:mm by default, or m:ss
 * with `twoPart: 'm:ss'`), "65m", "65", "1h5m", "1h 5", "90s", "1.5h", "45′", "30''".
 * Bare numbers are minutes. Returns seconds or null.
 */
export function parseDuration(text: string, opts?: { twoPart?: 'h:mm' | 'm:ss' }): number | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/′|'(?!')/g, 'm')
    .replace(/″|''|"/g, 's')
    .replace(/\s+/g, '');
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.some((p, i) => i > 0 && p >= 60)) return null;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    return opts?.twoPart === 'm:ss' ? parts[0]! * 60 + parts[1]! : parts[0]! * 3600 + parts[1]! * 60;
  }
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  const UNIT: Record<string, number> = {
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
    m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  };
  const re = /(\d+(?:\.\d+)?)([a-z]*)/g;
  let total = 0;
  let consumed = 0;
  let prev = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index !== consumed) return null;
    consumed += m[0].length;
    // bare number after hours = minutes ("1h5"), after minutes = seconds ("4m30")
    const f = m[2] ? UNIT[m[2]] : prev === 3600 ? 60 : prev === 60 ? 1 : undefined;
    if (f === undefined) return null;
    total += Number(m[1]) * f;
    prev = f;
  }
  return consumed === t.length ? Math.round(total) : null;
}

// ───────────────────────────── distance / pace / speed ─────────────────────────────

export interface Parts {
  value: string;
  unit: string;
}
const join = (p: Parts) => (p.unit ? `${p.value}${NBSP}${p.unit}` : p.value);

/**
 * distanceParts(42195, 'run') → { value: '42.2', unit: 'km' }; swim 2500 → { '2,500', 'm' };
 * row 5000 → { '5,000', 'm' } (row stays in meters below 10 km).
 */
export function distanceParts(m: number | null | undefined, sport = 'run', units: UnitPrefs = METRIC, decimals?: number): Parts {
  const { unit, mPer } = distanceUnit(sport, units);
  if (m == null || !Number.isFinite(m)) return { value: PLACEHOLDER, unit };
  if (unit === 'm' || unit === 'yd') {
    const v = m / mPer;
    if (sport === 'row' && v >= 10000) return { value: formatNumber(v / 1000, decimals ?? 1, { trim: decimals == null }), unit: 'km' };
    return { value: formatNumber(v, decimals ?? 0), unit };
  }
  const v = m / mPer;
  const d = decimals ?? (v < 100 ? 1 : 0);
  return { value: formatNumber(v, d, { trim: decimals == null }), unit };
}
export const formatDistance = (m: number | null | undefined, sport = 'run', units: UnitPrefs = METRIC, decimals?: number) =>
  join(distanceParts(m, sport, units, decimals));

/**
 * Pace from speed: run "4:05 /km" (or /mi), swim "1:45 /100m", row "1:52.4 /500m".
 * paceParts returns { value: '4:05', unit: '/km' }.
 */
export function paceParts(mps: number | null | undefined, sport = 'run', units: UnitPrefs = METRIC): Parts {
  const { label, meters } = paceBasis(sport, units);
  if (mps == null || !Number.isFinite(mps) || mps <= 0) return { value: PLACEHOLDER, unit: label };
  const secs = meters / mps;
  if (sport === 'row') {
    const t = Math.round(secs * 10) / 10;
    const mm = Math.floor(t / 60);
    const ss = t - mm * 60;
    return { value: `${mm}:${ss.toFixed(1).padStart(4, '0')}`, unit: label };
  }
  const t = Math.round(secs);
  return { value: `${Math.floor(t / 60)}:${pad(t % 60)}`, unit: label };
}
export const formatPace = (mps: number | null | undefined, sport = 'run', units: UnitPrefs = METRIC) =>
  `${paceParts(mps, sport, units).value}${NBSP}${paceParts(mps, sport, units).unit}`;

/** "4:05" (or "1:52.4") per pace basis → m/s. Null when unparseable. */
export function parsePace(text: string, sport = 'run', units: UnitPrefs = METRIC): number | null {
  const m = /^\s*(\d{1,2}):(\d{1,2}(?:\.\d)?)\s*$/.exec(text);
  if (!m) return null;
  const secs = Number(m[1]) * 60 + Number(m[2]);
  if (!(secs > 0) || Number(m[2]) >= 60) return null;
  return paceBasis(sport, units).meters / secs;
}

/** "32.4 km/h" / "20.1 mph". */
export function speedParts(mps: number | null | undefined, units: UnitPrefs = METRIC): Parts {
  const unit = units.system === 'imperial' ? 'mph' : 'km/h';
  if (mps == null || !Number.isFinite(mps)) return { value: PLACEHOLDER, unit };
  const v = units.system === 'imperial' ? (mps * 3600) / M_PER_MI : mps * 3.6;
  return { value: formatNumber(v, 1), unit };
}
export const formatSpeed = (mps: number | null | undefined, units: UnitPrefs = METRIC) => join(speedParts(mps, units));

/** Pace for pace sports, speed otherwise. */
export function speedOrPaceParts(mps: number | null | undefined, sport: string, units: UnitPrefs = METRIC): Parts {
  return ['run', 'swim', 'row', 'walk', 'hike'].includes(sport) ? paceParts(mps, sport, units) : speedParts(mps, units);
}

/** "420 m" / "1,378 ft". */
export function elevationParts(m: number | null | undefined, units: UnitPrefs = METRIC): Parts {
  const unit = units.system === 'imperial' ? 'ft' : 'm';
  if (m == null || !Number.isFinite(m)) return { value: PLACEHOLDER, unit };
  return { value: formatNumber(units.system === 'imperial' ? m / M_PER_FT : m, 0), unit };
}
export const formatElevation = (m: number | null | undefined, units: UnitPrefs = METRIC) => join(elevationParts(m, units));

export function weightParts(kg: number | null | undefined, units: UnitPrefs = METRIC): Parts {
  const unit = units.system === 'imperial' ? 'lb' : 'kg';
  if (kg == null || !Number.isFinite(kg)) return { value: PLACEHOLDER, unit };
  return { value: formatNumber(units.system === 'imperial' ? kg / KG_PER_LB : kg, 1), unit };
}
export const formatWeight = (kg: number | null | undefined, units: UnitPrefs = METRIC) => join(weightParts(kg, units));

export const powerParts = (w: number | null | undefined): Parts => ({ value: formatNumber(w, 0), unit: 'W' });
export const formatPower = (w: number | null | undefined) => join(powerParts(w));
export const hrParts = (bpm: number | null | undefined): Parts => ({ value: formatNumber(bpm, 0), unit: 'bpm' });
export const formatHr = (bpm: number | null | undefined) => join(hrParts(bpm));
/** Load is unitless in UI copy ("88"); the word "load" is added by the caller where needed. */
export const formatLoad = (n: number | null | undefined) => formatNumber(n, 0);
export const formatIF = (n: number | null | undefined) => (n == null ? PLACEHOLDER : n.toFixed(2));
export const formatCadence = (rpm: number | null | undefined, sport = 'bike'): string =>
  join({ value: formatNumber(rpm, 0), unit: sport === 'run' ? 'spm' : sport === 'row' ? 'spm' : 'rpm' });

// ───────────────────────────── percent / deltas ─────────────────────────────

/** formatPercent(0.92) → "92%"; signed: formatPercent(0.12, { signed: true }) → "+12%"; −8%; ±0%. */
export function formatPercent(fraction: number | null | undefined, opts?: { decimals?: number; signed?: boolean }): string {
  if (fraction == null || !Number.isFinite(fraction)) return PLACEHOLDER;
  const d = opts?.decimals ?? 0;
  const v = fraction * 100;
  if (!opts?.signed) return `${formatNumber(v, d)}%`;
  const r = Number(v.toFixed(d));
  if (r === 0) return `±${formatNumber(0, d)}%`;
  return `${r > 0 ? '+' : MINUS}${formatNumber(Math.abs(r), d)}%`;
}

export type DeltaDirection = 'up' | 'down' | 'flat';
/** Direction with a flat band (design: |Δ| < 1%; the calendar summary uses ±3%). */
export function deltaDirection(fraction: number | null | undefined, flatBelow = 0.01): DeltaDirection {
  if (fraction == null || !Number.isFinite(fraction) || Math.abs(fraction) < flatBelow) return 'flat';
  return fraction > 0 ? 'up' : 'down';
}
/** { text: '+12%', direction: 'up' } — flat values render as "±0%". */
export function formatDelta(fraction: number | null | undefined, opts?: { flatBelow?: number; decimals?: number }) {
  const direction = deltaDirection(fraction, opts?.flatBelow);
  const text = direction === 'flat' ? `±0%` : formatPercent(fraction, { signed: true, decimals: opts?.decimals });
  return { text, direction };
}

// ───────────────────────────── dates ─────────────────────────────

const df = new Map<string, Intl.DateTimeFormat>();
function dateFormat(key: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = df.get(key);
  if (!f) df.set(key, (f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o })));
  return f;
}
const utc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, day ?? 1));
};

export const weekdayShort = (d: string) => dateFormat('wd', { weekday: 'short' }).format(utc(d)); // "Sat"
export const weekdayLong = (d: string) => dateFormat('wdl', { weekday: 'long' }).format(utc(d)); // "Saturday"
export const monthShort = (d: string) => dateFormat('ms', { month: 'short' }).format(utc(d)); // "Nov"
const dayNum = (d: string) => String(Number(d.slice(8, 10)));

/** "Sat 21" */
export const formatDayShort = (d: string) => `${weekdayShort(d)} ${dayNum(d)}`;
/** "21 Nov" */
export const formatDayMonth = (d: string) => `${dayNum(d)} ${monthShort(d)}`;
/** "Sat 21 Nov" (adds the year when `withYear`) */
export const formatDateMedium = (d: string, withYear = false) =>
  `${weekdayShort(d)} ${dayNum(d)} ${monthShort(d)}${withYear ? ` ${d.slice(0, 4)}` : ''}`;
/** "Saturday 21 November" (+ " 2026" when `withYear`) */
export const formatDateLong = (d: string, withYear = false) =>
  `${weekdayLong(d)} ${dayNum(d)} ${dateFormat('ml', { month: 'long' }).format(utc(d))}${withYear ? ` ${d.slice(0, 4)}` : ''}`;
/** "Nov 2026" — accepts 'YYYY-MM' or a LocalDate. */
export const formatMonthYear = (d: string) => dateFormat('my', { month: 'short', year: 'numeric' }).format(utc(d.length === 7 ? `${d}-01` : d));
/** "November 2026" */
export const formatMonthYearLong = (d: string) =>
  dateFormat('myl', { month: 'long', year: 'numeric' }).format(utc(d.length === 7 ? `${d}-01` : d));

/** "Today", "Tomorrow", "Yesterday", "in 3 days", "3 days ago", "in 2 weeks", "in 3 months". */
export function formatRelativeDay(d: string, today: string): string {
  const n = diffDays(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const a = Math.abs(n);
  const [v, u] = a < 14 ? [a, 'day'] : a < 60 ? [Math.round(a / 7), 'week'] : a < 730 ? [Math.round(a / 30.44), 'month'] : [Math.round(a / 365.25), 'year'];
  const s = `${v} ${u}${v === 1 ? '' : 's'}`;
  return n > 0 ? `in ${s}` : `${s} ago`;
}

/** "23 days" countdown copy ("Today", "1 day"). */
export function formatCountdown(d: string, today: string): string {
  const n = diffDays(today, d);
  if (n === 0) return 'Today';
  return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`;
}

/** "W47" */
export const formatIsoWeek = (w: string) => `W${Number(w.slice(6, 8))}`;
/** "16–22 Nov" or "30 Nov – 6 Dec" (+ year when `withYear`). */
export function formatIsoWeekRange(w: string, withYear = false): string {
  const a = isoWeekStart(w);
  const b = addDays(a, 6);
  const y = withYear ? ` ${b.slice(0, 4)}` : '';
  if (a.slice(5, 7) === b.slice(5, 7)) return `${dayNum(a)}${EN_DASH}${dayNum(b)} ${monthShort(b)}${y}`;
  return `${dayNum(a)} ${monthShort(a)} ${EN_DASH} ${dayNum(b)} ${monthShort(b)}${y}`;
}
/** "W47 · 16–22 Nov" */
export const formatIsoWeekLabel = (w: string) => `${formatIsoWeek(w)} · ${formatIsoWeekRange(w)}`;

/** "07:30" (24h) or "7:30 am" (12h) from 'HH:MM'. */
export function formatClockTime(hhmm: string | null | undefined, hour12 = false): string {
  if (!hhmm) return PLACEHOLDER;
  const [h, m] = hhmm.split(':').map(Number);
  if (!hour12) return `${pad(h!)}:${pad(m!)}`;
  const hh = h! % 12 || 12;
  return `${hh}:${pad(m!)}${NBSP}${h! < 12 ? 'am' : 'pm'}`;
}

/** Local wall-clock time of an instant given its UTC offset in minutes → "07:30". */
export function formatInstantTime(iso: string, utcOffsetMin = 0, hour12 = false): string {
  const t = new Date(Date.parse(iso) + utcOffsetMin * 60_000);
  return formatClockTime(`${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`, hour12);
}

export type { UnitSystem, UnitPrefs };
