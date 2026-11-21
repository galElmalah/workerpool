/**
 * The athlete: a fictional self-coached age-group triathlete living in Girona (Catalonia),
 * who also rows on an erg and lifts. Thresholds move on dated test days.
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import type { SynthProfile, SynthThresholdChange } from './types';
import type { Thr } from './internal';
import { madridOffsetMin } from './util';

export const HOME = { lat: 41.9794, lng: 2.8214, alt: 76 } as const;

export const PROFILE_BASE = {
  displayName: 'jonas.tri',
  fullName: 'Jonas Weber',
  sex: 'male' as const,
  birthYear: 1987,
  timezone: 'Europe/Madrid',
  hrMax: 187,
  hrRest: 47,
};

type Kind = SynthThresholdChange['kind'];

export interface ThresholdStep {
  kind: Kind;
  value: number;
  /** Week offset relative to the A-race week (0 = race week). */
  rel: number;
  /** ISO weekday of the test (1 = Mon). The new value applies from the next day. */
  dow: number;
  /** Which planned test produces it (if any). */
  test?: 'ftp_ramp' | 'ftp_20' | 'run_10k' | 'run_tt30' | 'css' | 'row_2k';
}

export const INITIAL_THRESHOLDS: Record<Kind, number> = {
  ftp: 255,
  run_threshold: 3.817, // 4:22 /km
  swim_css: 0.913, // 1:49.5 /100 m
  row_threshold: 232,
  lthr: 168,
  weight: 74.2,
};

export const THRESHOLD_STEPS: ThresholdStep[] = [
  { kind: 'weight', value: 73.6, rel: -36, dow: 1 },
  { kind: 'swim_css', value: 0.935, rel: -36, dow: 5, test: 'css' }, // 1:47
  { kind: 'ftp', value: 262, rel: -36, dow: 6, test: 'ftp_ramp' },
  { kind: 'run_threshold', value: 3.906, rel: -32, dow: 7, test: 'run_10k' }, // 4:16
  { kind: 'row_threshold', value: 241, rel: -24, dow: 3, test: 'row_2k' },
  { kind: 'weight', value: 72.6, rel: -20, dow: 1 },
  { kind: 'ftp', value: 268, rel: -20, dow: 6, test: 'ftp_20' },
  { kind: 'swim_css', value: 0.971, rel: -16, dow: 5, test: 'css' }, // 1:43
  { kind: 'run_threshold', value: 4.032, rel: -12, dow: 7, test: 'run_tt30' }, // 4:08
  { kind: 'lthr', value: 170, rel: -12, dow: 7 },
  { kind: 'ftp', value: 276, rel: -8, dow: 6, test: 'ftp_20' },
  { kind: 'weight', value: 71.8, rel: -6, dow: 1 },
  { kind: 'swim_css', value: 0.99, rel: -4, dow: 5, test: 'css' }, // 1:41
  { kind: 'weight', value: 72.6, rel: 5, dow: 1 },
];

/** Date of a step given the race-week Monday. Effective the day after the test. */
export function stepTestDate(raceMonday: LocalDate, s: ThresholdStep): LocalDate {
  return addDays(raceMonday, s.rel * 7 + s.dow - 1);
}

export function stepEffectiveDate(raceMonday: LocalDate, s: ThresholdStep): LocalDate {
  const d = stepTestDate(raceMonday, s);
  return s.test ? addDays(d, 1) : d;
}

export function buildThresholdHistory(raceMonday: LocalDate, start: LocalDate, today: LocalDate): SynthThresholdChange[] {
  const current: Record<Kind, number> = { ...INITIAL_THRESHOLDS };
  const inWindow: SynthThresholdChange[] = [];
  for (const s of THRESHOLD_STEPS) {
    const eff = stepEffectiveDate(raceMonday, s);
    if (eff <= start) current[s.kind] = s.value;
    else if (eff <= today) inWindow.push({ kind: s.kind, value: s.value, effectiveFrom: eff });
  }
  const initial = (Object.keys(current) as Kind[]).map((kind) => ({ kind, value: current[kind], effectiveFrom: start }));
  return [...initial, ...inWindow].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/** Thresholds valid on a date (latest entry with effectiveFrom ≤ date; earliest otherwise). */
export function thresholdsAt(history: SynthThresholdChange[], date: LocalDate): Thr {
  const v: Partial<Record<Kind, number>> = {};
  for (const h of history) {
    if (h.effectiveFrom <= date || v[h.kind] === undefined) v[h.kind] = h.value;
  }
  return {
    ftp: v.ftp ?? INITIAL_THRESHOLDS.ftp,
    runMps: v.run_threshold ?? INITIAL_THRESHOLDS.run_threshold,
    cssMps: v.swim_css ?? INITIAL_THRESHOLDS.swim_css,
    rowW: v.row_threshold ?? INITIAL_THRESHOLDS.row_threshold,
    lthr: v.lthr ?? INITIAL_THRESHOLDS.lthr,
    weightKg: v.weight ?? INITIAL_THRESHOLDS.weight,
    hrRest: PROFILE_BASE.hrRest,
    hrMax: PROFILE_BASE.hrMax,
  };
}

/** Thresholds that a test on `date` establishes (values effective on date+1). */
export function thresholdsAfter(history: SynthThresholdChange[], date: LocalDate): Thr {
  return thresholdsAt(history, addDays(date, 1));
}

export function buildProfile(history: SynthThresholdChange[], today: LocalDate): SynthProfile {
  const t = thresholdsAt(history, today);
  return {
    ...PROFILE_BASE,
    utcOffsetMin: madridOffsetMin(today),
    weightKg: t.weightKg,
    lthr: t.lthr,
    ftp: t.ftp,
    runThresholdMps: t.runMps,
    swimCssMps: t.cssMps,
    rowThresholdW: t.rowW,
  };
}
