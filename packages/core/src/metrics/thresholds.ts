/**
 * Threshold tracking (metrics.md §5, §8.2): effective-dated lookup into a
 * ThresholdSnapshot, cold-start defaults, and auto-estimated *suggestions*
 * (never auto-applied).
 */
import type { BestEffort, LocalDate, PeakPoint, Sport, Threshold, ThresholdKind, ThresholdSnapshot } from '../domain';
import { thresholdSpeedFromEffort } from './pace';
import { curveAt, estimateFtp } from './power';
import { p2kFromTime, rowThresholdFromP2k } from './row';
import { criticalSwimSpeed } from './swim';
import { tanakaHrMax } from './hr';

/**
 * The record valid on `date` for (kind, sport): greatest effectiveFrom ≤ date,
 * falling back to sport 'all'. Null when none.
 */
export function lookupThreshold(
  thresholds: readonly Threshold[],
  kind: ThresholdKind,
  sport: Sport | 'all',
  date: LocalDate,
): Threshold | null {
  const pick = (s: Sport | 'all'): Threshold | null => {
    let best: Threshold | null = null;
    for (const t of thresholds) {
      if (t.kind !== kind || t.sport !== s || t.effectiveFrom > date || !(t.value > 0)) continue;
      if (!best || t.effectiveFrom > best.effectiveFrom || (t.effectiveFrom === best.effectiveFrom && t.id > best.id)) best = t;
    }
    return best;
  };
  return pick(sport) ?? (sport === 'all' ? null : pick('all'));
}

export interface ResolveOptions {
  /** Fill missing values with cold-start defaults (§8.2). Default false. */
  defaults?: boolean;
  /** Athlete age (years) for the Tanaka HRmax default. */
  age?: number;
}

/**
 * Thresholds valid for a workout of `sport` on `date`. Sport-specific thresholds
 * (ftp → bike, run_threshold → run, swim_css → swim, row_threshold → row) are
 * looked up for their own sport; LTHR, HRmax and HRrest for `sport`; each falls
 * back to sport 'all'.
 */
export function resolveThresholds(
  thresholds: readonly Threshold[],
  date: LocalDate,
  sport: Sport,
  opts: ResolveOptions = {},
): ThresholdSnapshot {
  const v = (kind: ThresholdKind, s: Sport | 'all') => lookupThreshold(thresholds, kind, s, date)?.value;
  const snap: ThresholdSnapshot = {};
  const set = <K extends keyof ThresholdSnapshot>(k: K, val: number | undefined) => {
    if (val !== undefined) snap[k] = val;
  };
  set('ftp', v('ftp', 'bike'));
  set('runThresholdMps', v('run_threshold', 'run'));
  set('swimCssMps', v('swim_css', 'swim'));
  set('rowThresholdW', v('row_threshold', 'row'));
  set('lthr', v('lthr', sport));
  set('hrMax', v('hr_max', sport));
  set('hrRest', v('hr_rest', sport));
  set('weightKg', v('weight', 'all'));
  return opts.defaults ? defaultThresholds(snap, { sport, age: opts.age }).snapshot : snap;
}

/**
 * Fill missing thresholds with cold-start defaults (§8.2, UNVERIFIED population
 * values; flag them "default, please test"): HRmax = Tanaka (185 bpm without an
 * age — ours), HRrest 60, LTHR 0.87 × HRmax (bike) / 0.90 × HRmax (run and
 * others) / run − 10 bpm (swim), FTP 2.5 W/kg or 175 W. Pace, CSS and row
 * thresholds have no default (their methods are skipped).
 */
export function defaultThresholds(
  snapshot: ThresholdSnapshot,
  ctx: { sport: Sport; age?: number },
): { snapshot: ThresholdSnapshot; defaulted: Array<keyof ThresholdSnapshot> } {
  const s: ThresholdSnapshot = { ...snapshot };
  const defaulted: Array<keyof ThresholdSnapshot> = [];
  if (!(s.hrMax! > 0)) {
    s.hrMax = ctx.age && ctx.age > 0 ? tanakaHrMax(ctx.age) : 185;
    defaulted.push('hrMax');
  }
  if (!(s.hrRest! > 0)) {
    s.hrRest = 60;
    defaulted.push('hrRest');
  }
  if (!(s.lthr! > 0)) {
    const max = s.hrMax!;
    s.lthr = ctx.sport === 'bike' ? 0.87 * max : ctx.sport === 'swim' ? 0.9 * max - 10 : 0.9 * max;
    defaulted.push('lthr');
  }
  if (!(s.ftp! > 0)) {
    s.ftp = s.weightKg && s.weightKg > 0 ? 2.5 * s.weightKg : 175;
    defaulted.push('ftp');
  }
  return { snapshot: s, defaulted };
}

// ───────────────────────────── auto-estimates ─────────────────────────────

/** Recent performance history (typically the last 90 days; HRmax over 365). */
export interface ThresholdHistory {
  bikePowerCurve?: readonly PeakPoint[];
  rowPowerCurve?: readonly PeakPoint[];
  /** Mean-max speed curve (m/s) for running. */
  runSpeedCurve?: readonly PeakPoint[];
  runEfforts?: readonly BestEffort[];
  rowEfforts?: readonly BestEffort[];
  swimEfforts?: readonly BestEffort[];
  /** Max-mean HR curves per sport (bpm). */
  hrCurves?: Partial<Record<Sport, readonly PeakPoint[]>>;
  /** Observed maximum (5 s-smoothed) HR values, bpm. */
  maxHrSamples?: readonly number[];
  /** Daily resting HR, last 30 days, bpm. */
  restingHr?: readonly number[];
}

export interface ThresholdSuggestion {
  kind: ThresholdKind;
  sport: Sport | 'all';
  value: number;
  /** Human-readable basis, e.g. "0.95 × best 20 min power". */
  basis: string;
}

/**
 * Threshold *suggestions* from history (§4.5, §8.2). The user accepts them,
 * creating a Threshold record; nothing here changes historical loads.
 */
export function estimateThresholds(history: ThresholdHistory): ThresholdSuggestion[] {
  const out: ThresholdSuggestion[] = [];

  const bike = history.bikePowerCurve ? estimateFtp(history.bikePowerCurve) : null;
  if (bike)
    out.push({ kind: 'ftp', sport: 'bike', value: bike.value, basis: bike.basis === '60min' ? 'best 60 min power' : '0.95 × best 20 min power' });

  let row: ThresholdSuggestion | null = null;
  const rowCurve = history.rowPowerCurve ? estimateFtp(history.rowPowerCurve) : null;
  if (rowCurve)
    row = { kind: 'row_threshold', sport: 'row', value: rowCurve.value, basis: rowCurve.basis === '60min' ? 'best 60 min erg power' : '0.95 × best 20 min erg power' };
  const twoK = history.rowEfforts?.find((e) => e.distanceM === 2000);
  const p2k = twoK ? p2kFromTime(twoK.timeSec) : null;
  if (p2k) {
    const v = rowThresholdFromP2k(p2k);
    if (!row || v > row.value) row = { kind: 'row_threshold', sport: 'row', value: v, basis: '0.75 × best 2 k power' };
  }
  if (row) out.push(row);

  let run: ThresholdSuggestion | null = null;
  const consider = (d: number, t: number, basis: string) => {
    if (t < 720 || t > 3600) return;
    const v = thresholdSpeedFromEffort(d, t);
    if (v && (!run || v > run.value)) run = { kind: 'run_threshold', sport: 'run', value: v, basis };
  };
  for (const p of history.runSpeedCurve ?? []) consider(p.value * p.durationSec, p.durationSec, `best ${Math.round(p.durationSec / 60)} min run (Riegel to 60 min)`);
  for (const e of history.runEfforts ?? []) consider(e.distanceM, e.timeSec, `best ${e.distanceM} m run (Riegel to 60 min)`);
  if (run) out.push(run);

  const s200 = history.swimEfforts?.find((e) => e.distanceM === 200);
  const s400 = history.swimEfforts?.find((e) => e.distanceM === 400);
  const css = s200 && s400 ? criticalSwimSpeed(s400.timeSec, s200.timeSec) : null;
  if (css) out.push({ kind: 'swim_css', sport: 'swim', value: css, basis: 'best 200 m and 400 m' });

  const maxes = (history.maxHrSamples ?? []).filter((h) => h >= 100 && h <= 220);
  if (maxes.length) out.push({ kind: 'hr_max', sport: 'all', value: Math.max(...maxes), basis: 'highest observed HR' });

  const rest = (history.restingHr ?? []).filter((h) => h > 25 && h < 120);
  if (rest.length) out.push({ kind: 'hr_rest', sport: 'all', value: Math.min(...rest), basis: 'lowest resting HR (30 days)' });

  for (const [sport, curve] of Object.entries(history.hrCurves ?? {}) as Array<[Sport, readonly PeakPoint[]]>) {
    const hr20 = curve ? curveAt(curve, 1200) : null;
    if (hr20 && hr20 > 0) out.push({ kind: 'lthr', sport, value: 0.95 * hr20, basis: '0.95 × best 20 min HR' });
  }
  return out;
}
