/**
 * Wellness signals (metrics.md §7): HRV baseline and normal range, resting-HR
 * trend, sleep, body mass, and the readiness HEURISTIC (not a validated or
 * medical score; no composite number by design).
 */
import type { LocalDate, WellnessDay } from '../domain';
import { addDays, parseDate } from '../time';
import { linearFit, mean, stdDev } from './util';

type Day = Pick<WellnessDay, 'date'> & Partial<WellnessDay>;

function windowValues(days: readonly Day[], date: LocalDate, n: number, pick: (d: Day) => number | undefined): number[] {
  const lo = addDays(date, -(n - 1));
  const seen = new Set<string>();
  const out: number[] = [];
  for (const d of days) {
    if (d.date < lo || d.date > date || seen.has(d.date)) continue; // first record per day wins
    const v = pick(d);
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      seen.add(d.date);
      out.push(v);
    }
  }
  return out;
}

export type HrvStatus = 'normal' | 'suppressed' | 'elevated';

export interface HrvBaseline {
  /** 7-day mean of ln rMSSD (null with < 4 values). */
  b7: number | null;
  /** exp(b7), ms (geometric mean). */
  b7Ms: number | null;
  /** 100 × sample SD7(ln) / B7, %. */
  cv7: number | null;
  /** 60-day mean / sample SD of ln rMSSD (null with < 14 values). */
  m60: number | null;
  s60: number | null;
  /** Normal range M60 ± 0.5·S60 (ln units). */
  low: number | null;
  high: number | null;
  status: HrvStatus | null;
}

/** Normal range [M60 − 0.5·S60, M60 + 0.5·S60] (SWC method, ours). */
export function hrvNormalRange(m60: number, s60: number): { low: number; high: number } {
  return { low: m60 - 0.5 * s60, high: m60 + 0.5 * s60 };
}

/** Where B7 sits against the normal range. Both directions are flagged (Altini). */
export function hrvStatus(b7: number, low: number, high: number): HrvStatus {
  return b7 < low ? 'suppressed' : b7 > high ? 'elevated' : 'normal';
}

/** HRV baseline (7-day ln rMSSD) and 60-day normal range as of `date` (§7.1). */
export function hrvBaseline(days: readonly Day[], date: LocalDate): HrvBaseline {
  const ln7 = windowValues(days, date, 7, (d) => d.hrvMs).map(Math.log);
  const ln60 = windowValues(days, date, 60, (d) => d.hrvMs).map(Math.log);
  const b7 = ln7.length >= 4 ? mean(ln7) : null;
  const sd7 = ln7.length >= 4 ? stdDev(ln7, true) : null;
  const m60 = ln60.length >= 14 ? mean(ln60) : null;
  const s60 = ln60.length >= 14 ? stdDev(ln60, true) : null;
  const range = m60 !== null && s60 !== null ? hrvNormalRange(m60, s60) : null;
  return {
    b7,
    b7Ms: b7 !== null ? Math.exp(b7) : null,
    cv7: b7 !== null && sd7 !== null && b7 !== 0 ? (100 * sd7) / b7 : null,
    m60,
    s60,
    low: range?.low ?? null,
    high: range?.high ?? null,
    status: b7 !== null && range ? hrvStatus(b7, range.low, range.high) : null,
  };
}

export interface RestingHrTrend {
  rhr7: number | null;
  rhr60: number | null;
  sd60: number | null;
  /** RHR7 > RHR60 + max(3 bpm, SD60) (ours, UNVERIFIED). */
  elevated: boolean | null;
}

/** Resting-HR trend as of `date` (§7.2). Needs ≥ 4 values in 7 days and ≥ 14 in 60 (ours). */
export function restingHrTrend(days: readonly Day[], date: LocalDate): RestingHrTrend {
  const r7 = windowValues(days, date, 7, (d) => d.restingHr);
  const r60 = windowValues(days, date, 60, (d) => d.restingHr);
  const rhr7 = r7.length >= 4 ? mean(r7) : null;
  const rhr60 = r60.length >= 14 ? mean(r60) : null;
  const sd60 = r60.length >= 14 ? stdDev(r60, true) : null;
  const elevated = rhr7 !== null && rhr60 !== null && sd60 !== null ? rhr7 > rhr60 + Math.max(3, sd60) : null;
  return { rhr7, rhr60, sd60, elevated };
}

/** Short-sleep flag (§7.3): last night < 6 h, or 3-night mean < 0.85 × target (default 8 h). Null without data. */
export function sleepShort(days: readonly Day[], date: LocalDate, targetHours = 8): { lastHours: number | null; mean3Hours: number | null; short: boolean | null } {
  const last = days.find((d) => d.date === date)?.sleepSec;
  const s3 = windowValues(days, date, 3, (d) => d.sleepSec);
  const lastHours = typeof last === 'number' && last > 0 ? last / 3600 : null;
  const mean3Hours = s3.length ? (mean(s3) as number) / 3600 : null;
  if (lastHours === null && mean3Hours === null) return { lastHours, mean3Hours, short: null };
  const short = (lastHours !== null && lastHours < 6) || (mean3Hours !== null && mean3Hours < 0.85 * targetHours);
  return { lastHours, mean3Hours, short };
}

/** Body mass (§7.4): mean of the last 7 measurements (kg) and OLS trend over 28 days (kg/week). */
export function bodyMassTrend(days: readonly Day[], date: LocalDate): { mass7: number | null; kgPerWeek: number | null } {
  const withW = days
    .filter((d) => d.date <= date && typeof d.weightKg === 'number' && d.weightKg > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const last7 = withW.slice(-7).map((d) => d.weightKg as number);
  const lo = addDays(date, -27);
  const recent = withW.filter((d) => d.date >= lo);
  const t0 = parseDate(lo);
  const fit = linearFit(
    recent.map((d) => (parseDate(d.date) - t0) / 86_400_000),
    recent.map((d) => d.weightKg as number),
  );
  return { mass7: last7.length ? mean(last7) : null, kgPerWeek: fit ? fit.slope * 7 : null };
}

export type ReadinessState = 'green' | 'amber' | 'red';

export interface Readiness {
  state: ReadinessState;
  /** Reasons for each flag raised. */
  reasons: string[];
  /** Inputs that were available and evaluated. */
  inputs: string[];
  label: 'Heuristic, not a validated or medical score';
}

/**
 * Readiness HEURISTIC (§7.5): counts warning flags — HRV outside the normal range,
 * RHR elevated, short sleep, Form % < −30, soreness ≥ 4 or feel ≤ 2 (of 5).
 * 0 → green, 1 → amber, ≥ 2 → red. Missing inputs are skipped, not counted.
 */
export function readiness(days: readonly Day[], date: LocalDate, opts: { formPct?: number | null; sleepTargetHours?: number } = {}): Readiness {
  const reasons: string[] = [];
  const inputs: string[] = [];
  const hrv = hrvBaseline(days, date);
  if (hrv.status) {
    inputs.push('hrv');
    if (hrv.status !== 'normal') reasons.push(hrv.status === 'suppressed' ? 'HRV below normal range' : 'HRV above normal range');
  }
  const rhr = restingHrTrend(days, date);
  if (rhr.elevated !== null) {
    inputs.push('restingHr');
    if (rhr.elevated) reasons.push('Resting HR elevated');
  }
  const sleep = sleepShort(days, date, opts.sleepTargetHours);
  if (sleep.short !== null) {
    inputs.push('sleep');
    if (sleep.short) reasons.push('Short sleep');
  }
  if (opts.formPct != null && Number.isFinite(opts.formPct)) {
    inputs.push('form');
    if (opts.formPct < -30) reasons.push('Form in overreaching zone');
  }
  const today = days.find((d) => d.date === date);
  if (today && (today.soreness != null || today.feel != null)) {
    inputs.push('subjective');
    if ((today.soreness ?? 0) >= 4) reasons.push('High soreness');
    if (today.feel != null && today.feel <= 2) reasons.push('Feeling poor');
  }
  const n = reasons.length;
  return {
    state: n === 0 ? 'green' : n === 1 ? 'amber' : 'red',
    reasons,
    inputs,
    label: 'Heuristic, not a validated or medical score',
  };
}
