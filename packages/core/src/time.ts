/**
 * Calendar-date helpers. All dates are LocalDate strings ('YYYY-MM-DD') and all
 * arithmetic is done in UTC so it is DST-proof. Weeks are ISO weeks (Mon–Sun).
 */
import type { IsoWeek, LocalDate } from './domain';

const DAY_MS = 86_400_000;

export function parseDate(d: LocalDate): number {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return Date.UTC(y, m - 1, day);
}

export function formatDate(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return formatDate(parseDate(d) + n * DAY_MS);
}

/** b − a in whole days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: LocalDate): number {
  const wd = new Date(parseDate(d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Monday of the ISO week containing d. */
export function weekStart(d: LocalDate): LocalDate {
  return addDays(d, 1 - isoWeekday(d));
}

/** Sunday of the ISO week containing d. */
export function weekEnd(d: LocalDate): LocalDate {
  return addDays(weekStart(d), 6);
}

export function isoWeekOf(d: LocalDate): IsoWeek {
  // The ISO year is the year of the week's Thursday.
  const thursday = addDays(weekStart(d), 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week1Start = weekStart(jan4);
  const week = Math.floor(diffDays(week1Start, weekStart(d)) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the given ISO week. */
export function isoWeekStart(w: IsoWeek): LocalDate {
  const year = Number(w.slice(0, 4));
  const week = Number(w.slice(6, 8));
  return addDays(weekStart(`${year}-01-04`), (week - 1) * 7);
}

export function addWeeks(w: IsoWeek, n: number): IsoWeek {
  return isoWeekOf(addDays(isoWeekStart(w), n * 7));
}

/** Inclusive list of dates from a to b. */
export function eachDay(a: LocalDate, b: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let t = parseDate(a), end = parseDate(b); t <= end; t += DAY_MS) out.push(formatDate(t));
  return out;
}

/** Inclusive list of ISO weeks touching [a, b]. */
export function eachWeek(a: LocalDate, b: LocalDate): IsoWeek[] {
  const out: IsoWeek[] = [];
  for (let d = weekStart(a); d <= b; d = addDays(d, 7)) out.push(isoWeekOf(d));
  return out;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Local calendar date of an instant given a UTC offset in minutes. */
export function localDateOf(instantIso: string, utcOffsetMin: number): LocalDate {
  return formatDate(Date.parse(instantIso) + utcOffsetMin * 60_000);
}

/** Today's local date in an IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): LocalDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts.slice(0, 10);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
