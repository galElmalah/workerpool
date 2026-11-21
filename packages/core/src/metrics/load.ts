/**
 * Per-activity orchestrator (metrics.md §2.0, §8.1): prepares streams, computes
 * every eligible load (power / pace / swim pace / HR / RPE / duration), picks one
 * by the sport's priority cascade, and derives the headline metrics, zones, peaks,
 * auto intensity and sparkline. Works summary-only and never throws.
 *
 * Cascades (after manual override):
 *  - bike: power → HR → RPE → duration
 *  - run: pace (grade-adjusted) → HR → RPE → duration; trail runs: HR → pace → …
 *  - swim pool: swim pace → RPE → HR → duration; open water: swim pace → HR → RPE → duration
 *  - row erg (default): power (or C2-pace-derived power) → HR → RPE → duration;
 *    on water: HR → RPE → duration (one rowing threshold = erg)
 *  - strength / yoga / other: RPE → HR → duration × intensity class
 *  - hike / walk / ski: HR → RPE → duration
 */
import type {
  ActivityStreams,
  BestEffort,
  IntensityClass,
  LoadSource,
  PeakPoint,
  Sport,
  SubSport,
  ThresholdSnapshot,
  ZoneTime,
} from '../domain';
import { hrLoad, hrLoadFromAverage, type HrParams, type Sex } from './hr';
import {
  adjustedSpeedSeries,
  bestEfforts,
  gradeSeries,
  normalizedSpeed,
  paceLoad,
  ROW_EFFORT_DISTANCES,
  RUN_EFFORT_DISTANCES,
  runEfficiency,
  SWIM_EFFORT_DISTANCES,
} from './pace';
import {
  decoupling,
  efficiencyFactor,
  loadFromIntensity,
  meanMaximal,
  MMP_DURATIONS,
  powerLoad,
  workKj as workKjOf,
  type PowerLoadResult,
} from './power';
import { c2SpeedToWatts, ergPowerFromSpeed } from './row';
import { durationLoad, rpeLoad, sessionRpe } from './rpe';
import { effortSparkline, prepareStreams, type PreparedStreams } from './streams';
import { swimBestEfforts, swimLoad, type SwimLength } from './swim';
import { coverage, isNum, mean } from './util';
import {
  autoIntensity,
  HR_ZONES_FRIEL_BIKE,
  HR_ZONES_FRIEL_RUN,
  HR_ZONES_PCT_MAX,
  intensityLevelSeconds,
  PACE_ZONES_FRIEL,
  POWER_ZONES_COGGAN,
  resolveZones,
  ROW_ZONES,
  SWIM_ZONES_CSS,
  threeZoneSeconds,
  timeInZones,
  type IntensitySignal,
  type ThreeZoneSeconds,
  type ThreeZoneSignal,
} from './zones';

/** Minimum channel coverage of the active series for a stream method (§1.2). */
export const COVERAGE_GATE = 0.8;

export interface ActivitySummaryInput {
  /** Elapsed duration (s). */
  durationSec: number;
  /** Moving duration (s); for pool swims, excluding rest. */
  movingSec?: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  weightedPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  /** Session RPE (CR10 1–10). */
  rpe?: number;
  /** User-entered load; wins over everything (loadSource 'manual'). */
  manualLoad?: number;
  /** Pool lengths / laps (swim best efforts, moving time). */
  laps?: readonly SwimLength[];
}

export interface ActivityMetricsOptions {
  /** Intensity class for the duration estimate (override or planned). */
  intensityClass?: IntensityClass;
  /** Multiplier on strength RPE load (DECISION `strengthLoadFactor`, default 1). */
  strengthLoadFactor?: number;
  /** Swim duration basis (default 'moving'). */
  swimMode?: 'moving' | 'elapsed';
  /** Explicit timer pauses [start, end) s. */
  pauses?: ReadonlyArray<readonly [number, number]>;
  /** Compute peak curves / best efforts (default true). */
  peaks?: boolean;
}

export interface ActivityMetricsInput {
  sport: Sport;
  subSport?: SubSport;
  streams?: ActivityStreams | null;
  summary: ActivitySummaryInput;
  thresholds: ThresholdSnapshot;
  sex?: Sex;
  options?: ActivityMetricsOptions;
}

type Method = 'power' | 'pace' | 'swim_pace' | 'hr' | 'rpe' | 'duration';

export interface ActivityMetrics {
  load: number;
  loadSource: LoadSource;
  /** True when the chosen load is the duration-only estimate. */
  estimated: boolean;
  /** Every computable load, for the UI's "switch method" control. */
  loads: Partial<Record<Method, number>>;
  intensityFactor?: number;
  /** W */
  weightedPower?: number;
  avgPower?: number;
  maxPower?: number;
  /** Normalized grade-adjusted speed (run), m/s. */
  adjustedSpeedMps?: number;
  avgSpeedMps?: number;
  avgHr?: number;
  maxHr?: number;
  variability?: number;
  /** Bike/row W/bpm; run m·min⁻¹·bpm⁻¹. */
  efficiency?: number;
  /** Only for steady sessions ≥ 60 min with HR coverage ≥ 90 % (§2.1.3). */
  decouplingPct?: number;
  workKj?: number;
  distanceM?: number;
  movingSec: number;
  elapsedSec: number;
  /** Foster session RPE (AU), when RPE is known. */
  sessionRpe?: number;
  /** Raw Banister TRIMP, when computed. */
  trimp?: number;
  zones: { hr?: ZoneTime[]; power?: ZoneTime[]; pace?: ZoneTime[] };
  peaks: { power?: PeakPoint[]; hr?: PeakPoint[]; speed?: PeakPoint[]; efforts?: BestEffort[] };
  intensityAuto: IntensityClass;
  /** e.g. "14′ at threshold". */
  intensityReason: string;
  /** Seiler 3-zone seconds (easy < LT1 ≤ moderate < LT2 ≤ hard) from the best signal. */
  intensitySec?: ThreeZoneSeconds;
  sparkline: number[];
  /** Data-quality notes: 'wp_fallback', 'power_from_pace', 'summary_only', 'swim_rest_unknown', 'open_water', 'hr_from_average', 'error'… */
  flags: string[];
}

function cascade(sport: Sport, subSport: SubSport | undefined): Method[] {
  switch (sport) {
    case 'bike':
      return ['power', 'hr', 'rpe', 'duration'];
    case 'run':
      return subSport === 'trail' ? ['hr', 'pace', 'rpe', 'duration'] : ['pace', 'hr', 'rpe', 'duration'];
    case 'swim':
      return subSport === 'open_water' ? ['swim_pace', 'hr', 'rpe', 'duration'] : ['swim_pace', 'rpe', 'hr', 'duration'];
    case 'row':
      return subSport === 'on_water' ? ['hr', 'rpe', 'duration'] : ['power', 'hr', 'rpe', 'duration'];
    case 'strength':
    case 'yoga':
    case 'other':
      return ['rpe', 'hr', 'duration'];
    default:
      return ['hr', 'rpe', 'duration'];
  }
}

const NO_DISTANCE: ReadonlySet<Sport> = new Set(['strength', 'yoga', 'other']);

/** Present = at least one finite sample. */
function present(x: Float64Array | undefined): x is Float64Array {
  if (!x) return false;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) return true;
  return false;
}

function maxOf(x: Float64Array): number | undefined {
  let m = -Infinity;
  for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i];
  return Number.isFinite(m) ? m : undefined;
}

function setNum<T extends object, K extends keyof T>(o: T, k: K, v: number | null | undefined): void {
  if (typeof v === 'number' && Number.isFinite(v)) (o as Record<K, number>)[k] = v;
}

/**
 * Compute all per-activity metrics. Never throws: on unexpected failure the
 * result is a duration-based estimate with flag 'error'.
 */
export function computeActivityMetrics(input: ActivityMetricsInput): ActivityMetrics {
  try {
    return compute(input);
  } catch {
    const s = input?.summary;
    const sport: Sport = input?.sport ?? 'other';
    const dur = isNum(s?.movingSec) && s.movingSec > 0 ? s.movingSec : isNum(s?.durationSec) ? s.durationSec : 0;
    const load = isNum(s?.manualLoad) && s.manualLoad >= 0 ? s.manualLoad : durationLoad(sport, dur, input?.options?.intensityClass);
    return {
      load,
      loadSource: isNum(s?.manualLoad) && s.manualLoad >= 0 ? 'manual' : 'duration',
      estimated: !(isNum(s?.manualLoad) && s.manualLoad >= 0),
      loads: { duration: durationLoad(sport, dur, input?.options?.intensityClass) },
      movingSec: dur,
      elapsedSec: isNum(s?.durationSec) ? s.durationSec : dur,
      zones: {},
      peaks: {},
      intensityAuto: input?.options?.intensityClass ?? 'endurance',
      intensityReason: 'default',
      sparkline: [],
      flags: ['error'],
    };
  }
}

function compute(input: ActivityMetricsInput): ActivityMetrics {
  const { sport, subSport, summary: s, thresholds: th } = input;
  const opts = input.options ?? {};
  const flags: string[] = [];
  const prep: PreparedStreams | null = input.streams ? prepareStreams(input.streams, { sport, subSport, pauses: opts.pauses }) : null;
  const hasStreams = !!prep && prep.movingSec > 0;
  if (!hasStreams) flags.push('summary_only');
  const act = hasStreams ? prep!.active : undefined;
  const el = hasStreams ? prep!.elapsed : undefined;

  const elapsedSec = isNum(s.durationSec) && s.durationSec > 0 ? s.durationSec : hasStreams ? prep!.elapsedSec : 0;
  const lapMoving = s.laps?.length ? s.laps.reduce((a, l) => a + (l.isRest || !(l.distanceM! > 0) ? 0 : l.durationSec || 0), 0) : 0;
  let movingSec: number;
  if (sport === 'swim') movingSec = (isNum(s.movingSec) && s.movingSec > 0 ? s.movingSec : lapMoving) || (hasStreams ? prep!.movingSec : elapsedSec);
  else movingSec = hasStreams ? prep!.movingSec : isNum(s.movingSec) && s.movingSec > 0 ? s.movingSec : elapsedSec;

  const streamDist = el?.distance ? maxOf(el.distance) : undefined;
  const distanceM = isNum(s.distanceM) && s.distanceM > 0 ? s.distanceM : streamDist;

  const out: ActivityMetrics = {
    load: 0,
    loadSource: 'duration',
    estimated: true,
    loads: {},
    movingSec,
    elapsedSec,
    zones: {},
    peaks: {},
    intensityAuto: 'endurance',
    intensityReason: 'default',
    sparkline: [],
    flags,
  };
  setNum(out, 'distanceM', distanceM);
  if (distanceM && movingSec > 0 && !NO_DISTANCE.has(sport)) setNum(out, 'avgSpeedMps', distanceM / movingSec);
  else setNum(out, 'avgSpeedMps', s.avgSpeedMps);

  const IFs: Partial<Record<Method, number>> = {};

  // ── power (bike, erg row) ──
  const powerThreshold = sport === 'bike' ? th.ftp : sport === 'row' && subSport !== 'on_water' ? th.rowThresholdW : undefined;
  let activePower: Float64Array | undefined = present(act?.power) ? act!.power : undefined;
  let elapsedPower: Float64Array | undefined = present(el?.power) ? el!.power : undefined;
  if (sport === 'row' && subSport !== 'on_water' && !activePower && present(act?.speed) && coverage(act!.speed) >= COVERAGE_GATE) {
    activePower = ergPowerFromSpeed(act!.speed!);
    elapsedPower = ergPowerFromSpeed(el!.speed!);
    flags.push('power_from_pace');
  }
  let pl: PowerLoadResult | null = null;
  if (activePower) {
    const pcov = coverage(activePower);
    // With no threshold, a placeholder of 1 W still yields WP/mean/VI; its load/IF are discarded.
    pl = powerLoad(activePower, powerThreshold && powerThreshold > 0 ? powerThreshold : 1);
    if (pl) {
      setNum(out, 'weightedPower', pl.weightedPower);
      setNum(out, 'avgPower', pl.meanPower);
      setNum(out, 'variability', pl.variability);
      if (pl.wpFallback) flags.push('wp_fallback');
      if (powerThreshold && pcov >= COVERAGE_GATE) {
        out.loads.power = pl.load;
        IFs.power = pl.intensity;
      }
    }
    setNum(out, 'maxPower', maxOf(activePower));
    setNum(out, 'workKj', workKjOf(elapsedPower ?? activePower));
  } else {
    let wp = s.weightedPower ?? s.avgPower;
    if (!isNum(wp) && sport === 'row' && subSport !== 'on_water') {
      const v = distanceM && movingSec > 0 ? distanceM / movingSec : s.avgSpeedMps;
      if (isNum(v) && v > 0) {
        wp = c2SpeedToWatts(v);
        flags.push('power_from_pace');
      }
    }
    setNum(out, 'avgPower', s.avgPower);
    setNum(out, 'weightedPower', s.weightedPower);
    setNum(out, 'maxPower', s.maxPower);
    if (isNum(s.avgPower) && movingSec > 0) out.workKj = (s.avgPower * movingSec) / 1000;
    if (powerThreshold && isNum(wp) && wp > 0 && movingSec > 0) {
      IFs.power = wp / powerThreshold;
      out.loads.power = loadFromIntensity(movingSec, IFs.power, 2);
    }
  }

  // ── pace (run) ──
  let adj: Float64Array | undefined;
  if (sport === 'run') {
    if (present(act?.speed)) {
      let grade: Float64Array | undefined;
      if (present(act!.grade)) grade = act!.grade;
      else if (subSport !== 'treadmill' && present(el?.altitude) && present(el?.distance)) {
        const g = gradeSeries(el!.altitude!, el!.distance!);
        grade = new Float64Array(prep!.activeIndex.length);
        for (let k = 0; k < grade.length; k++) grade[k] = g[prep!.activeIndex[k]];
      }
      adj = adjustedSpeedSeries(act!.speed!, grade);
      const ns = normalizedSpeed(adj);
      setNum(out, 'adjustedSpeedMps', ns);
      if (coverage(act!.speed) >= COVERAGE_GATE) {
        const p = paceLoad(adj, th.runThresholdMps);
        if (p) {
          out.loads.pace = p.load;
          IFs.pace = p.intensity;
        }
      }
    } else {
      const v = distanceM && movingSec > 0 ? distanceM / movingSec : s.avgSpeedMps;
      if (isNum(v) && v > 0 && th.runThresholdMps && th.runThresholdMps > 0 && movingSec > 0) {
        IFs.pace = v / th.runThresholdMps;
        out.loads.pace = loadFromIntensity(movingSec, IFs.pace, 2);
      }
    }
  }

  // ── swim pace ──
  if (sport === 'swim') {
    if (subSport === 'open_water') flags.push('open_water');
    const r = swimLoad({
      distanceM: distanceM ?? 0,
      movingSec: (isNum(s.movingSec) && s.movingSec > 0 ? s.movingSec : lapMoving) || undefined,
      elapsedSec,
      cssMps: th.swimCssMps,
      mode: opts.swimMode,
    });
    if (r) {
      out.loads.swim_pace = r.load;
      IFs.swim_pace = r.intensity;
      if (r.restUnknown) flags.push('swim_rest_unknown');
    }
  }

  // ── HR ──
  const hrParams: Partial<HrParams> = { hrRest: th.hrRest, hrMax: th.hrMax, lthr: th.lthr, sex: input.sex };
  const activeHr = present(act?.hr) ? act!.hr : undefined;
  const hrCov = coverage(activeHr);
  if (activeHr) {
    setNum(out, 'avgHr', mean(activeHr));
    setNum(out, 'maxHr', maxOf(activeHr));
    if (hrCov >= COVERAGE_GATE) {
      const r = hrLoad(activeHr, hrParams);
      if (r) {
        out.loads.hr = r.load;
        out.trimp = r.trimp;
      }
    }
  } else {
    setNum(out, 'avgHr', s.avgHr);
    setNum(out, 'maxHr', s.maxHr);
    if (isNum(s.avgHr)) {
      const r = hrLoadFromAverage(s.avgHr, movingSec, hrParams);
      if (r) {
        out.loads.hr = r.load;
        out.trimp = r.trimp;
      }
    }
  }

  // ── RPE / duration ──
  const sessionSec = NO_DISTANCE.has(sport) ? elapsedSec || movingSec : movingSec || elapsedSec;
  if (isNum(s.rpe) && s.rpe > 0) {
    out.sessionRpe = sessionRpe(s.rpe, elapsedSec || movingSec);
    out.loads.rpe = rpeLoad(s.rpe, elapsedSec || movingSec, sport === 'strength' ? (opts.strengthLoadFactor ?? 1) : 1);
  }
  out.loads.duration = durationLoad(sport, sessionSec, opts.intensityClass);

  // ── choose ──
  if (isNum(s.manualLoad) && s.manualLoad >= 0) {
    out.load = s.manualLoad;
    out.loadSource = 'manual';
    out.estimated = false;
  } else {
    for (const m of cascade(sport, subSport)) {
      const v = out.loads[m];
      if (isNum(v) && v >= 0) {
        out.load = v;
        out.loadSource = m;
        out.estimated = m === 'duration';
        if (IFs[m] !== undefined) out.intensityFactor = IFs[m];
        break;
      }
    }
  }
  if (out.loadSource === 'hr' && !activeHr) flags.push('hr_from_average');

  // ── efficiency & decoupling ──
  const meanHr = activeHr && hrCov >= COVERAGE_GATE ? mean(activeHr) : null;
  if (sport === 'run' && adj) {
    setNum(out, 'efficiency', runEfficiency(out.adjustedSpeedMps ?? null, meanHr));
  } else if (activePower) {
    setNum(out, 'efficiency', efficiencyFactor(out.weightedPower ?? null, meanHr));
  }
  if (activeHr && hrCov >= 0.9 && movingSec >= 3600) {
    const outSeries = sport === 'run' ? adj : activePower;
    if (outSeries) {
      const m = mean(outSeries);
      const vi = sport === 'run' ? (out.adjustedSpeedMps && m ? out.adjustedSpeedMps / m : null) : (out.variability ?? null);
      if (vi !== null && vi <= 1.1) setNum(out, 'decouplingPct', decoupling(outSeries, activeHr));
    }
  }

  // ── zones ──
  let level: { series: Float64Array; threshold: number; signal: IntensitySignal; three: ThreeZoneSignal } | null = null;
  if (activePower && powerThreshold) {
    const z = resolveZones(sport === 'row' ? ROW_ZONES : POWER_ZONES_COGGAN, powerThreshold);
    if (z) out.zones.power = timeInZones(activePower, z);
    level = { series: activePower, threshold: powerThreshold, signal: 'power', three: sport === 'row' ? 'row' : 'power' };
  }
  if (sport === 'run' && adj && th.runThresholdMps) {
    const z = resolveZones(PACE_ZONES_FRIEL, th.runThresholdMps);
    if (z) out.zones.pace = timeInZones(adj, z);
    level ??= { series: adj, threshold: th.runThresholdMps, signal: 'runSpeed', three: 'runSpeed' };
  }
  if (sport === 'swim' && present(act?.speed) && th.swimCssMps) {
    const z = resolveZones(SWIM_ZONES_CSS, th.swimCssMps);
    if (z) out.zones.pace = timeInZones(act!.speed!, z);
    level ??= { series: act!.speed!, threshold: th.swimCssMps, signal: 'swim', three: 'swim' };
  }
  if (activeHr) {
    const hz = th.lthr
      ? resolveZones(sport === 'bike' ? HR_ZONES_FRIEL_BIKE : HR_ZONES_FRIEL_RUN, th.lthr)
      : resolveZones(HR_ZONES_PCT_MAX, th.hrMax);
    if (hz) out.zones.hr = timeInZones(activeHr, hz);
    if (th.lthr && hrCov >= COVERAGE_GATE) level ??= { series: activeHr, threshold: th.lthr, signal: 'hr', three: 'hr' };
  }

  // ── auto intensity ──
  const equivIF = out.intensityFactor ?? (out.load > 0 && movingSec > 0 && out.loadSource !== 'duration' ? Math.sqrt(out.load / (100 * (movingSec / 3600))) : undefined);
  const ai = autoIntensity({
    levelSeconds: level ? intensityLevelSeconds(level.series, level.threshold, level.signal) : null,
    movingSec,
    intensityFactor: equivIF ?? null,
    rpe: s.rpe ?? null,
    fallback: opts.intensityClass ?? (sport === 'yoga' ? 'recovery' : 'endurance'),
  });
  out.intensityAuto = ai.intensity;
  out.intensityReason = ai.reason;
  if (level) out.intensitySec = threeZoneSeconds(level.series, level.threshold, level.three);

  // ── peaks ──
  if (hasStreams && opts.peaks !== false) {
    if (elapsedPower) out.peaks.power = meanMaximal(elapsedPower, MMP_DURATIONS);
    if (present(el!.hr)) out.peaks.hr = meanMaximal(el!.hr!, MMP_DURATIONS, { missing: 'skip' });
    if ((sport === 'run' || sport === 'walk' || sport === 'hike') && present(el!.speed)) out.peaks.speed = meanMaximal(el!.speed!, MMP_DURATIONS, { missing: 'zero' });
    if (present(el!.distance)) {
      const targets = sport === 'run' || sport === 'walk' || sport === 'hike' ? RUN_EFFORT_DISTANCES : sport === 'row' ? ROW_EFFORT_DISTANCES : sport === 'swim' && !s.laps?.length ? SWIM_EFFORT_DISTANCES : null;
      if (targets) out.peaks.efforts = bestEfforts(el!.distance!, targets);
    }
  }
  if (sport === 'swim' && s.laps?.length && opts.peaks !== false) out.peaks.efforts = swimBestEfforts(s.laps);

  out.sparkline = hasStreams ? effortSparkline(prep!, sport) : [];
  return out;
}
