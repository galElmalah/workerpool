/**
 * Longitudinal model (metrics.md §6): Fitness / Fatigue EWMAs, Form, Form %,
 * form zones, Ramp, projection from planned load, monotony/strain and ACWR.
 *
 * Defaults (architect): exponential form k = 1 − e^(−1/τ), τ = 42 / 7 days,
 * seeded at 0; Form[d] = Fitness[d−1] − Fatigue[d−1]; Form % = 100·Form/Fitness[d−1].
 */
import type { FitnessDay, FormZone, LocalDate } from '../domain';
import { addDays, diffDays, eachDay } from '../time';
import { keysOf, lookupOf } from './util';

export const TAU_FITNESS = 42;
export const TAU_FATIGUE = 7;

export type PmcForm = 'exp' | 'simple';

/** Daily EWMA weight: 1 − e^(−1/τ) ('exp', default) or 1/τ ('simple', TrainingPeaks-style). */
export function ewmaWeight(tau: number, form: PmcForm = 'exp'): number {
  return form === 'simple' ? 1 / tau : 1 - Math.exp(-1 / tau);
}

type DailyMap = Map<LocalDate, number> | Record<LocalDate, number>;

export interface FitnessSeed {
  /** State at the END of this date (i.e. the value going into date + 1). */
  date: LocalDate;
  fitness: number;
  fatigue: number;
}

export interface BuildFitnessInput {
  /** Completed load per local date. */
  dailyLoad: DailyMap;
  /** Planned load per date of planned workouts not yet paired with an activity. */
  plannedLoad?: DailyMap;
  /** Output range (inclusive). History before `from` is still iterated. */
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  /**
   * Seed: explicit state on a date, or 'auto' (steady-state seed = mean of the
   * first ≤ 28 days of completed load, §6.4). Default: 0 before the first data day.
   */
  seed?: FitnessSeed | 'auto';
  tauFitness?: number;
  tauFatigue?: number;
  pmcForm?: PmcForm;
}

/**
 * Build the fitness series for [from, to]. Days after `today` are projected
 * from planned load; today uses completed + still-planned (unpaired) load;
 * past days use completed load only. O(days from first data to `to`).
 */
export function buildFitnessSeries(input: BuildFitnessInput): FitnessDay[] {
  const { from, to, today } = input;
  if (to < from) return [];
  const done = lookupOf(input.dailyLoad);
  const planned = lookupOf(input.plannedLoad);
  const kF = ewmaWeight(input.tauFitness ?? TAU_FITNESS, input.pmcForm);
  const kA = ewmaWeight(input.tauFatigue ?? TAU_FATIGUE, input.pmcForm);

  const dataDays = keysOf(input.dailyLoad).filter((d) => done(d) !== 0 && d <= to).sort();
  const firstData = dataDays[0];
  const seed = input.seed;
  let start = from;
  if (firstData && firstData < start) start = firstData;
  if (seed && seed !== 'auto' && addDays(seed.date, 1) < start) start = addDays(seed.date, 1);

  let F = 0;
  let A = 0;
  if (seed && seed !== 'auto' && addDays(seed.date, 1) === start) {
    F = seed.fitness;
    A = seed.fatigue;
  }
  // Auto seed: state at the end of the day before the first data day.
  let autoSeedDay: LocalDate | null = null;
  let autoSeedVal = 0;
  if (seed === 'auto' && firstData) {
    autoSeedVal = autoSeedValue(firstData, today < to ? today : to, done);
    if (firstData <= start) F = A = autoSeedVal;
    else autoSeedDay = addDays(firstData, -1);
  }

  const out: FitnessDay[] = [];
  const hist: number[] = []; // fitness by day index; hist[-1] implied = initial F
  const F0 = F;
  for (const d of eachDay(start, to)) {
    const Fy = F;
    const Ay = A;
    const doneL = done(d);
    const planL = planned(d);
    const L = doneL + (d >= today ? planL : 0);
    F = F + (L - F) * kF;
    A = A + (L - A) * kA;
    if (seed && seed !== 'auto' && d === seed.date) {
      F = seed.fitness;
      A = seed.fatigue;
    }
    if (autoSeedDay && d === autoSeedDay) F = A = autoSeedVal;
    hist.push(F);
    if (d < from) continue;
    const i = hist.length - 1;
    const back = i - 7;
    const ramp = back >= 0 ? F - hist[back] : back === -1 ? F - F0 : null;
    const form = Fy - Ay;
    const formPct = Fy >= 1 ? (100 * form) / Fy : null;
    out.push({
      date: d,
      load: doneL,
      plannedLoad: planL,
      fitness: F,
      fatigue: A,
      form,
      formPct,
      formZone: Fy >= 5 && formPct !== null ? formZoneOf(formPct) : null,
      ramp,
      projected: d > today,
    });
  }
  return out;
}

function autoSeedValue(firstData: LocalDate, lastAvail: LocalDate, done: (d: string) => number): number {
  const avail = Math.max(1, Math.min(28, diffDays(firstData, lastAvail) + 1));
  let s = 0;
  for (let i = 0; i < avail; i++) s += done(addDays(firstData, i));
  return s / avail;
}

/**
 * Steady-state auto seed (§6.4): mean of the first min(28, n) daily loads.
 * Example: first 7 days averaging 58.57 → seed 58.57.
 */
export function autoSeed(dailyLoads: readonly number[]): number {
  const n = Math.min(28, dailyLoads.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += dailyLoads[i] || 0;
  return s / n;
}

/**
 * Form zone from Form % (percent units, lower bounds inclusive):
 * ≥ +20 transition, +5…+20 fresh, −10…+5 neutral, −30…−10 productive, < −30 overreaching.
 */
export function formZoneOf(formPct: number): FormZone {
  if (formPct >= 20) return 'transition';
  if (formPct >= 5) return 'fresh';
  if (formPct >= -10) return 'neutral';
  if (formPct >= -30) return 'productive';
  return 'overreaching';
}

export type RampBand = 'detraining' | 'sustainable' | 'aggressive' | 'high_risk';

/**
 * Ramp guidance (§6.5): < 0 detraining; ≤ 5 sustainable; ≤ 8 aggressive; > 8 high risk.
 * At Fitness ≤ 45 the stricter table applies: ≤ 3 sustainable, < 7 aggressive, ≥ 7 high risk.
 */
export function rampBand(ramp: number, fitness: number): RampBand {
  if (ramp < 0) return 'detraining';
  if (fitness <= 45) return ramp <= 3 ? 'sustainable' : ramp < 7 ? 'aggressive' : 'high_risk';
  return ramp <= 5 ? 'sustainable' : ramp <= 8 ? 'aggressive' : 'high_risk';
}

/** Foster monotony over (usually 7) daily loads incl. zero days: mean / population SD; null if SD = 0. */
export function monotony(loads: readonly number[]): number | null {
  const n = loads.length;
  if (n === 0) return null;
  const m = loads.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(loads.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  return sd > 0 ? m / sd : null;
}

/** Foster strain = Σ load × monotony; null when monotony is undefined. */
export function strain(loads: readonly number[]): number | null {
  const mo = monotony(loads);
  return mo === null ? null : loads.reduce((a, b) => a + b, 0) * mo;
}

export interface AcwrResult {
  acute: number;
  chronic: number;
  /** Raw ratio (null when chronic is 0). */
  ratio: number | null;
  /** False when chronic < 1 or history < 28 days — show as undefined in the UI. */
  valid: boolean;
}

/**
 * Acute:chronic workload ratio at the last day of `dailyLoads` (§6.9).
 * 'ewma' (Williams 2017, λ 2/8 and 2/29, start 0), 'rolling' (7/28 coupled),
 * 'uncoupled' (7 vs the 21 days before). Kept out of readiness and headlines.
 */
export function acwr(dailyLoads: readonly number[], method: 'ewma' | 'rolling' | 'uncoupled' = 'ewma'): AcwrResult {
  const n = dailyLoads.length;
  let acute = 0;
  let chronic = 0;
  if (method === 'ewma') {
    const la = 2 / (7 + 1);
    const lc = 2 / (28 + 1);
    for (const L of dailyLoads) {
      acute = la * L + (1 - la) * acute;
      chronic = lc * L + (1 - lc) * chronic;
    }
  } else {
    const avg = (a: number, b: number) => {
      let s = 0;
      let c = 0;
      for (let i = Math.max(0, a); i <= b && i < n; i++) {
        s += dailyLoads[i];
        c++;
      }
      return c ? s / c : 0;
    };
    acute = avg(n - 7, n - 1);
    chronic = method === 'rolling' ? avg(n - 28, n - 1) : avg(n - 28, n - 8);
  }
  const ratio = chronic > 0 ? acute / chronic : null;
  return { acute, chronic, ratio, valid: ratio !== null && chronic >= 1 && n >= 28 };
}
