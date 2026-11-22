/**
 * Original FIT file → Cadence structures, using Garmin's official
 * `@garmin/fitsdk` (21.222.0, pure ESM JS, no Node built-ins; imports cleanly
 * in Workers). Bundle weight: ~1.14 MB unminified, of which `profile.js` is
 * ~1.04 MB (the full FIT profile incl. exercise-name tables); roughly 250–300 KB
 * gzipped. Import this module lazily (`await import('@cadence/garmin/fit')`-style
 * dynamic import in the queue consumer) if the main Worker bundle is tight.
 *
 * Contract: `parseFit` NEVER throws. Odd/truncated files, unknown enums and
 * developer fields yield a partial result plus `warnings`.
 */
import { Decoder, Profile, Stream, Utils } from '@garmin/fitsdk';
import { unzipSync } from 'fflate';
import type { ActivityFacts, ActivitySensor, ActivityStreams, Lap, Sport, StrengthSet, SubSport, SwimLength } from '@cadence/core/domain';
import { camelToUpperSnake, humanizeExercise } from './exercises';
import { compact, round, toIsoInstant, utcDate } from './util';

export interface FitSummary {
  durationSec?: number; // elapsed
  movingSec?: number; // total_moving_time, else timer time
  distanceM?: number;
  elevationGainM?: number;
  elevationLossM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  weightedPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  maxSpeedMps?: number;
  avgCadence?: number;
  calories?: number;
  workKj?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  deviceTss?: number;
  deviceIf?: number;
  thresholdPower?: number;
  poolLengthM?: number;
  strokes?: number;
  avgSwolf?: number;
  activeLengths?: number;
  totalSets?: number;
  totalReps?: number;
  volumeKg?: number;
}

export interface FitParseResult {
  /** false when nothing usable was decoded. */
  ok: boolean;
  warnings: string[];
  /** FIT session sport/sub_sport as decoded (camelCase SDK strings, or numbers if unknown). */
  fitSport?: string;
  fitSubSport?: string;
  sport?: Sport;
  subSport?: SubSport;
  startedAt?: string;
  startMs?: number;
  /** From activity.local_timestamp − timestamp, when present. */
  utcOffsetMin?: number;
  localDate?: string;
  summary: FitSummary;
  /** Raw device-rate samples (≈1 Hz); resampling is the metrics engine's job. */
  streams?: ActivityStreams;
  laps: Lap[];
  strengthSets?: StrengthSet[];
  /** Name of the executed workout (FIT `workout.wkt_name`) — may carry our tag. */
  workoutName?: string;
  sessionCount: number;
  /** Everything else the file reports (position, dynamics, temperature, device…); see domain ActivityFacts. */
  facts?: ActivityFacts;
  /** Pool swims: every length (active and idle). */
  swimLengths?: SwimLength[];
  /** Post-workout self-evaluation recorded on the watch (session.workout_rpe / workout_feel). */
  rpe?: number;
  feel?: number;
}

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

// ───────────────────────────── download unwrapping ─────────────────────────────

export function isFitBytes(b: Uint8Array): boolean {
  return b.length >= 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54; // ".FIT"
}

/** The original-file download is a ZIP with one `{id}_ACTIVITY.fit`; bare FIT is accepted too. */
export function extractFitFromDownload(bytes: Uint8Array): Uint8Array | undefined {
  if (isFitBytes(bytes)) return bytes;
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined; // "PK"
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return undefined;
  }
  const entries = Object.entries(files);
  const byName = entries.find(([name]) => name.toLowerCase().endsWith('.fit'));
  if (byName) return byName[1];
  return entries.find(([, data]) => isFitBytes(data))?.[1];
}

// ───────────────────────────── sport mapping ─────────────────────────────

export function mapFitSport(sport: unknown, subSport: unknown): { sport: Sport; subSport?: SubSport } {
  const s = String(sport ?? '');
  const ss = String(subSport ?? '');
  switch (s) {
    case 'running':
      if (ss === 'treadmill' || ss === 'indoorRunning' || ss === 'virtualActivity') return { sport: 'run', subSport: 'treadmill' };
      if (ss === 'trail' || ss === 'ultra' || ss === 'obstacle') return { sport: 'run', subSport: 'trail' };
      if (ss === 'track') return { sport: 'run', subSport: 'track' };
      return { sport: 'run', subSport: 'road_run' };
    case 'cycling':
    case 'eBiking':
      if (ss === 'indoorCycling' || ss === 'spin' || ss === 'indoorHandCycling') return { sport: 'bike', subSport: 'indoor' };
      if (ss === 'virtualActivity') return { sport: 'bike', subSport: 'virtual' };
      if (['mountain', 'downhill', 'eBikeMountain', 'bmx', 'enduro', 'eBikeEnduro'].includes(ss)) return { sport: 'bike', subSport: 'mtb' };
      if (ss === 'gravelCycling' || ss === 'cyclocross') return { sport: 'bike', subSport: 'gravel' };
      return { sport: 'bike', subSport: 'road' };
    case 'swimming':
      if (ss === 'openWater') return { sport: 'swim', subSport: 'open_water' };
      return { sport: 'swim', subSport: 'pool' };
    case 'rowing':
      return { sport: 'row', subSport: ss === 'indoorRowing' ? 'erg' : 'on_water' };
    case 'fitnessEquipment':
      if (ss === 'indoorRowing') return { sport: 'row', subSport: 'erg' };
      if (ss === 'treadmill') return { sport: 'run', subSport: 'treadmill' };
      if (ss === 'indoorCycling') return { sport: 'bike', subSport: 'indoor' };
      if (ss === 'strengthTraining') return { sport: 'strength', subSport: 'gym' };
      return { sport: 'other', subSport: 'generic' };
    case 'training':
      if (ss === 'yoga' || ss === 'pilates' || ss === 'breathing') return { sport: 'yoga', subSport: 'generic' };
      if (ss === 'cardioTraining' || ss === 'hiit' || ss === 'amrap' || ss === 'emom' || ss === 'tabata') return { sport: 'strength', subSport: 'hiit' };
      if (ss === 'flexibilityTraining') return { sport: 'strength', subSport: 'mobility' };
      return { sport: 'strength', subSport: 'gym' };
    case 'hiit':
      return { sport: 'strength', subSport: 'hiit' };
    case 'mobility':
      return { sport: 'strength', subSport: 'mobility' };
    case 'walking':
      return { sport: 'walk', subSport: 'generic' };
    case 'hiking':
    case 'mountaineering':
      return { sport: 'hike', subSport: 'generic' };
    case 'crossCountrySkiing':
    case 'alpineSkiing':
    case 'snowboarding':
    case 'snowshoeing':
      return { sport: 'ski', subSport: 'generic' };
    default:
      return { sport: 'other', subSport: 'generic' };
  }
}

const STROKE_MAP: Record<string, string> = {
  freestyle: 'free',
  backstroke: 'back',
  breaststroke: 'breast',
  butterfly: 'fly',
  im: 'im',
  imByRound: 'im',
  drill: 'drill',
  mixed: 'choice',
};

// ───────────────────────────── parsing ─────────────────────────────

type M = Record<string, unknown>;
const n = (m: M | undefined, ...keys: string[]): number | undefined => {
  if (!m) return undefined;
  for (const k of keys) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
};
const ms = (v: unknown): number | undefined =>
  v instanceof Date ? v.getTime() : typeof v === 'number' && Number.isFinite(v) ? Utils.convertDateTimeToDate(v).getTime() : undefined;
const deg = (v: number | undefined): number | null => {
  if (v === undefined) return null;
  const d = Math.abs(v) > 360 ? v * SEMICIRCLE_TO_DEG : v; // semicircles → degrees (already degrees: keep)
  return Math.abs(d) <= 180 ? round(d, 7) : null;
};

export function parseFit(bytes: Uint8Array): FitParseResult {
  const warnings: string[] = [];
  const result: FitParseResult = { ok: false, warnings, summary: {}, laps: [], sessionCount: 0 };
  let messages: Record<string, M[] | undefined>;
  try {
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    if (!decoder.isFIT()) {
      warnings.push('not a FIT file');
      return result;
    }
    if (!decoder.checkIntegrity()) warnings.push('FIT integrity check failed (truncated or bad CRC); decoding what is readable');
    const read = decoder.read({ mergeHeartRates: true, expandComponents: true, expandSubFields: true });
    for (const e of read.errors) warnings.push(`decoder: ${e instanceof Error ? e.message : String(e)}`);
    messages = read.messages as unknown as Record<string, M[] | undefined>;
  } catch (e) {
    warnings.push(`decoder threw: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  try {
    fillFromMessages(messages, result);
  } catch (e) {
    warnings.push(`mapping failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  result.ok = result.startMs !== undefined || !!result.streams || result.laps.length > 0;
  return result;
}

function fillFromMessages(messages: Record<string, M[] | undefined>, r: FitParseResult): void {
  const sessions = messages.sessionMesgs ?? [];
  const records = messages.recordMesgs ?? [];
  const laps = messages.lapMesgs ?? [];
  const lengths = messages.lengthMesgs ?? [];
  const sets = messages.setMesgs ?? [];
  const activity = messages.activityMesgs?.[0];
  r.sessionCount = sessions.length;
  if (sessions.length > 1) r.warnings.push(`multi-session file (${sessions.length} sessions); summary uses the first, laps/streams cover all`);
  const session = sessions[0];
  if (!session) r.warnings.push('no session message');

  r.fitSport = session?.sport === undefined ? (laps[0]?.sport as string | undefined) : String(session.sport);
  r.fitSubSport = session?.subSport === undefined ? undefined : String(session.subSport);
  if (r.fitSport !== undefined) {
    const mapped = mapFitSport(r.fitSport, r.fitSubSport);
    r.sport = mapped.sport;
    if (mapped.subSport) r.subSport = mapped.subSport;
  }

  const firstRecordMs = records.map((x) => ms(x.timestamp)).find((v) => v !== undefined);
  const startMs = ms(session?.startTime) ?? ms(laps[0]?.startTime) ?? firstRecordMs ?? ms(messages.fileIdMesgs?.[0]?.timeCreated);
  if (startMs !== undefined) {
    r.startMs = startMs;
    r.startedAt = toIsoInstant(startMs);
  }
  if (activity && typeof activity.localTimestamp === 'number') {
    const tsMs = ms(activity.timestamp);
    if (tsMs !== undefined) {
      const offsetSec = activity.localTimestamp - Utils.convertDateToDateTime(new Date(tsMs));
      if (Math.abs(offsetSec) <= 14 * 3600) r.utcOffsetMin = Math.round(offsetSec / 60 / 15) * 15;
    }
  }
  if (startMs !== undefined) r.localDate = utcDate(startMs + (r.utcOffsetMin ?? 0) * 60_000);

  // Running/walking cadence in FIT is per leg (strides/min) → steps/min. Guard: data
  // already in steps/min (median > 130) is left alone.
  const legSport = r.sport === 'run' || r.sport === 'walk' || r.sport === 'hike';
  const recCad = records.map((x) => n(x, 'cadence')).filter((v): v is number => v !== undefined && v > 0);
  const cadFactor = legSport && median(recCad) <= 130 ? 2 : 1;
  const sessCad = n(session, 'avgRunningCadence', 'avgCadence');
  const sessCadFactor = legSport && (sessCad ?? 0) <= 130 ? 2 : 1;

  if (session) {
    const fracCad = n(session, 'avgFractionalCadence') ?? 0;
    const work = n(session, 'totalWork');
    r.summary = compact<FitSummary>({
      durationSec: n(session, 'totalElapsedTime'),
      movingSec: n(session, 'totalMovingTime', 'totalTimerTime'),
      distanceM: n(session, 'totalDistance'),
      elevationGainM: n(session, 'totalAscent'),
      elevationLossM: n(session, 'totalDescent'),
      avgHr: n(session, 'avgHeartRate'),
      maxHr: n(session, 'maxHeartRate'),
      avgPower: n(session, 'avgPower'),
      weightedPower: n(session, 'normalizedPower'),
      maxPower: n(session, 'maxPower'),
      avgSpeedMps: n(session, 'enhancedAvgSpeed', 'avgSpeed'),
      maxSpeedMps: n(session, 'enhancedMaxSpeed', 'maxSpeed'),
      avgCadence: sessCad === undefined ? undefined : round((sessCad + (sessCadFactor === 2 ? fracCad : 0)) * sessCadFactor, 1),
      calories: n(session, 'totalCalories'),
      workKj: work === undefined ? undefined : round(work / 1000, 1),
      aerobicEffect: n(session, 'totalTrainingEffect'),
      anaerobicEffect: n(session, 'totalAnaerobicTrainingEffect'),
      deviceTss: n(session, 'trainingStressScore'),
      deviceIf: n(session, 'intensityFactor'),
      thresholdPower: n(session, 'thresholdPower'),
      poolLengthM: r.sport === 'swim' ? n(session, 'poolLength') : undefined,
      strokes: r.sport === 'swim' ? n(session, 'totalStrokes', 'totalCycles') : undefined,
      avgSwolf: n(session, 'avgSwolf'),
      activeLengths: n(session, 'numActiveLengths'),
    });
  }
  r.facts = sessionFacts(session, records, r.sport, legSport, sessCadFactor, messages);
  const rpe = n(session, 'workoutRpe');
  if (rpe !== undefined && rpe > 0) r.rpe = Math.max(1, Math.min(10, Math.round(rpe / 10)));
  const feel = n(session, 'workoutFeel');
  if (feel !== undefined && feel >= 0 && feel <= 100) r.feel = Math.max(1, Math.min(5, Math.round(feel / 25) + 1));

  // ── streams
  if (records.length && startMs !== undefined) {
    const rows = records
      .map((x) => ({ x, t: ms(x.timestamp) }))
      .filter((v): v is { x: M; t: number } => v.t !== undefined);
    if (rows.length < records.length) r.warnings.push(`${records.length - rows.length} record(s) without timestamp skipped`);
    rows.sort((a, b) => a.t - b.t);
    const t0 = Math.min(startMs, rows[0]?.t ?? startMs);
    const ch = {
      hr: [] as (number | null)[],
      power: [] as (number | null)[],
      speed: [] as (number | null)[],
      cadence: [] as (number | null)[],
      altitude: [] as (number | null)[],
      distance: [] as (number | null)[],
      grade: [] as (number | null)[],
      temp: [] as (number | null)[],
      lat: [] as (number | null)[],
      lng: [] as (number | null)[],
    };
    const t: number[] = [];
    for (const { x, t: tm } of rows) {
      t.push(round((tm - t0) / 1000, 3));
      ch.hr.push(n(x, 'heartRate') ?? null);
      ch.power.push(n(x, 'power') ?? null);
      ch.speed.push(n(x, 'enhancedSpeed', 'speed') ?? null);
      const c = n(x, 'cadence');
      ch.cadence.push(c === undefined ? null : round((c + (cadFactor === 2 ? (n(x, 'fractionalCadence') ?? 0) : 0)) * cadFactor, 1));
      ch.altitude.push(n(x, 'enhancedAltitude', 'altitude') ?? null);
      ch.distance.push(n(x, 'distance') ?? null);
      const g = n(x, 'grade');
      ch.grade.push(g === undefined ? null : round(g / 100, 4));
      ch.temp.push(n(x, 'temperature') ?? null);
      ch.lat.push(deg(n(x, 'positionLat')));
      ch.lng.push(deg(n(x, 'positionLong')));
    }
    const streams: ActivityStreams = { t };
    for (const [k, vals] of Object.entries(ch)) if (vals.some((v) => v !== null)) (streams as Record<string, unknown>)[k] = vals;
    if (!streams.lat || !streams.lng) {
      delete streams.lat;
      delete streams.lng;
    }
    r.streams = streams;
  }

  // ── laps (+ swim lengths)
  const lapStart = startMs ?? 0;
  const activeLen = lengths.filter((l) => l.lengthType !== 'idle');
  const strokeOf = (ls: M[]): string | undefined => {
    const counts = new Map<string, number>();
    for (const l of ls) if (typeof l.swimStroke === 'string') counts.set(l.swimStroke, (counts.get(l.swimStroke) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? (STROKE_MAP[top] ?? top) : undefined;
  };
  const swolfOf = (ls: M[]): number | undefined => {
    const v = ls
      .map((l) => {
        const strokes = n(l, 'totalStrokes');
        const time = n(l, 'totalTimerTime', 'totalElapsedTime');
        return strokes !== undefined && time !== undefined ? strokes + time : undefined;
      })
      .filter((x): x is number => x !== undefined);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : undefined;
  };
  if (laps.length) {
    laps.forEach((lap, i) => {
      const st = ms(lap.startTime) ?? ms(lap.timestamp);
      const first = n(lap, 'firstLengthIndex');
      const count = n(lap, 'numLengths');
      const lapLengths =
        first !== undefined && count !== undefined ? lengths.slice(first, first + count).filter((l) => l.lengthType !== 'idle') : [];
      const activeCount = n(lap, 'numActiveLengths') ?? (lapLengths.length || undefined);
      const isSwim = r.sport === 'swim' && (lengths.length > 0 || activeCount !== undefined);
      const lc = n(lap, 'avgRunningCadence', 'avgCadence');
      const lapCadFactor = legSport && (lc ?? 0) <= 130 ? 2 : 1;
      const dist = n(lap, 'totalDistance');
      r.laps.push(
        compact<Lap>({
          index: i,
          startSec: st === undefined ? 0 : round((st - lapStart) / 1000, 1),
          durationSec: round(n(lap, 'totalElapsedTime', 'totalTimerTime') ?? 0, 1),
          movingSec: n(lap, 'totalMovingTime', 'totalTimerTime'),
          distanceM: dist,
          avgHr: n(lap, 'avgHeartRate'),
          maxHr: n(lap, 'maxHeartRate'),
          avgPower: n(lap, 'avgPower'),
          weightedPower: n(lap, 'normalizedPower'),
          avgSpeedMps: n(lap, 'enhancedAvgSpeed', 'avgSpeed'),
          avgCadence: lc === undefined ? undefined : round(lc * lapCadFactor, 1),
          elevationGainM: n(lap, 'totalAscent'),
          lengths: isSwim ? activeCount : undefined,
          stroke: isSwim
            ? typeof lap.swimStroke === 'string'
              ? (STROKE_MAP[lap.swimStroke] ?? lap.swimStroke)
              : strokeOf(lapLengths)
            : undefined,
          swolf: isSwim ? (n(lap, 'avgSwolf') ?? swolfOf(lapLengths)) : undefined,
          isRest: isSwim && (activeCount === 0 || (!dist && lapLengths.length === 0)) ? true : undefined,
          ...lapExtras(lap, r.sport, legSport),
        }),
      );
    });
  } else if (lengths.length) {
    // No lap messages: group consecutive active lengths; idle lengths become rest laps.
    let group: M[] = [];
    const flush = (rest: boolean, ls: M[]) => {
      if (!ls.length) return;
      const st = ms(ls[0]!.startTime) ?? ms(ls[0]!.timestamp) ?? lapStart;
      const dur = ls.reduce((a, l) => a + (n(l, 'totalElapsedTime', 'totalTimerTime') ?? 0), 0);
      const pool = r.summary.poolLengthM;
      r.laps.push(
        compact<Lap>({
          index: r.laps.length,
          startSec: round((st - lapStart) / 1000, 1),
          durationSec: round(dur, 1),
          distanceM: rest || !pool ? undefined : pool * ls.length,
          lengths: rest ? 0 : ls.length,
          stroke: rest ? undefined : strokeOf(ls),
          swolf: rest ? undefined : swolfOf(ls),
          isRest: rest || undefined,
        }),
      );
    };
    for (const l of lengths) {
      if (l.lengthType === 'idle') {
        flush(false, group);
        group = [];
        flush(true, [l]);
      } else group.push(l);
    }
    flush(false, group);
  }
  if (r.sport === 'swim' && lengths.length) r.swimLengths = swimLengthsOf(lengths, laps, lapStart);
  if (r.sport === 'swim' && r.summary.avgSwolf === undefined && activeLen.length) r.summary.avgSwolf = swolfOf(activeLen);
  if (r.sport === 'swim' && r.summary.activeLengths === undefined && activeLen.length) r.summary.activeLengths = activeLen.length;

  // ── strength sets
  if (sets.length) {
    let volume = 0;
    let reps = 0;
    let active = 0;
    r.strengthSets = sets.map((s, index) => {
      const isRest = s.setType === 'rest';
      const cat = Array.isArray(s.category) ? s.category[0] : s.category;
      const sub = Array.isArray(s.categorySubtype) ? s.categorySubtype[0] : s.categorySubtype;
      let exName: string | undefined;
      if (typeof cat === 'string' && typeof sub === 'number') {
        const table = (Profile.types as Record<string, Record<number, string> | undefined>)[`${cat}ExerciseName`];
        exName = table?.[sub];
      }
      const category = typeof cat === 'string' && cat !== 'unknown' ? camelToUpperSnake(cat) : undefined;
      const rep = n(s, 'repetitions');
      const w = n(s, 'weight');
      if (!isRest) {
        active++;
        reps += rep ?? 0;
        volume += (rep ?? 0) * (w ?? 0);
      }
      return compact<StrengthSet>({
        index,
        exercise: isRest ? 'Rest' : exName ? humanizeExercise(camelToUpperSnake(exName)) : category ? humanizeExercise(category) : 'Unknown exercise',
        category,
        reps: isRest ? undefined : rep,
        weightKg: isRest || !w ? undefined : round(w, 2),
        durationSec: n(s, 'duration'),
        isRest: isRest || undefined,
      });
    });
    r.summary.totalSets = active;
    r.summary.totalReps = reps;
    if (volume > 0) r.summary.volumeKg = round(volume, 1);
  }

  const wkt = messages.workoutMesgs?.[0];
  if (wkt && typeof wkt.wktName === 'string') r.workoutName = wkt.wktName;
}

// ───────────────────────────── facts ─────────────────────────────

const r1 = (v: number | undefined) => (v === undefined ? undefined : round(v, 1));
const r3 = (v: number | undefined) => (v === undefined ? undefined : round(v, 3));

/** Average of a record field over records where it is present and > 0. */
function recordMean(records: M[], key: string): number | undefined {
  let s = 0;
  let c = 0;
  for (const x of records) {
    const v = n(x, key);
    if (v !== undefined && v > 0) {
      s += v;
      c++;
    }
  }
  return c ? s / c : undefined;
}

/**
 * FIT `left_right_balance(_100)`: low 14 bits (or 7 for the 8-bit form) = percent contribution of
 * the side flagged by the high bit ("right" when set, else unknown). Returns the LEFT share, or
 * undefined when the side is unknown or the value is implausible.
 */
export function leftBalancePct(raw: unknown, hundredths = true): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const rightFlag = hundredths ? 0x8000 : 0x80;
  const mask = hundredths ? 0x3fff : 0x7f;
  if (!(raw & rightFlag)) return undefined;
  const right = hundredths ? (raw & mask) / 100 : raw & mask;
  if (right <= 0 || right >= 100) return undefined;
  return round(100 - right, 1);
}

const PRODUCT_NAMES: Record<string, string> = {
  hrmPro: 'HRM-Pro',
  hrmProPlus: 'HRM-Pro Plus',
  hrmDual: 'HRM-Dual',
  hrmRun: 'HRM-Run',
  hrmTri: 'HRM-Tri',
  hrmSwim: 'HRM-Swim',
  hrm600: 'HRM 600',
  hrmFit: 'HRM-Fit',
  edgeExplore2: 'Edge Explore 2',
  rally200: 'Rally 200',
  vectorSs: 'Vector S',
  vector3: 'Vector 3',
  varia: 'Varia',
};

/** Garmin product key from the FIT profile ('fr965', 'edge840', 'fenix7xPro') → marketing name. */
export function garminProductName(key: string | undefined): string | undefined {
  if (!key || /^\d+$/.test(key)) return undefined;
  if (PRODUCT_NAMES[key]) return PRODUCT_NAMES[key];
  const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');
  const tail = (s: string) => words(s).replace(/\b(Apac|Asia|Japan|Taiwan|China|Korea|Sea|India)\b/g, '').replace(/\s+/g, ' ').trim();
  let m = /^fr(\d+)(.*)$/.exec(key);
  if (m) return `Forerunner ${m[1]}${tail(m[2]!) ? ' ' + tail(m[2]!) : ''}`.trim();
  m = /^(fenix|epix|edge|venu|vivoactive|instinct|enduro|approach|descent|marq|quatix|tactix|vivomove|lily|swim)(.*)$/.exec(key);
  if (m) {
    const brand = m[1] === 'fenix' ? 'fēnix' : m[1] === 'vivoactive' ? 'vívoactive' : m[1] === 'vivomove' ? 'vívomove' : m[1] === 'marq' ? 'MARQ' : m[1]![0]!.toUpperCase() + m[1]!.slice(1);
    const rest = tail(m[2]!);
    return rest ? `${brand} ${rest}` : brand;
  }
  if (/^hrm/.test(key)) return `HRM ${tail(key.slice(3))}`.trim();
  const w = words(key);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const SENSOR_KIND: Record<string, string> = {
  heartRate: 'Heart rate',
  bikePower: 'Power',
  bikeSpeedCadence: 'Speed & cadence',
  bikeCadence: 'Cadence',
  bikeSpeed: 'Speed',
  strideSpeedDistance: 'Foot pod',
  fitnessEquipment: 'Trainer',
  bikeRadar: 'Radar',
  bikeLightMain: 'Light',
  bikeLightShared: 'Light',
  shifting: 'Shifting',
  muscleOxygen: 'Muscle oxygen',
  envSensor: 'Temperature',
  environmentSensorLegacy: 'Temperature',
  runningDynamics: 'Running dynamics',
};

/** device_info messages → the recording device + paired sensors. Internal (local) sensors are skipped. */
export function deviceFacts(messages: Record<string, M[] | undefined>): Pick<ActivityFacts, 'deviceName' | 'deviceSoftware' | 'sensors'> {
  const out: Pick<ActivityFacts, 'deviceName' | 'deviceSoftware' | 'sensors'> = {};
  const infos = messages.deviceInfoMesgs ?? [];
  const fileId = messages.fileIdMesgs?.[0];
  const isCreator = (d: M) => d.deviceIndex === 'creator' || d.deviceIndex === 0;
  const creator = infos.find((d) => isCreator(d) && (d.productName || d.garminProduct || d.product)) ?? infos.find(isCreator);
  const nameOf = (d: M | undefined): string | undefined => {
    if (!d) return undefined;
    if (typeof d.productName === 'string' && d.productName.trim()) return d.productName.trim();
    if (typeof d.garminProduct === 'string') return garminProductName(d.garminProduct);
    return undefined;
  };
  out.deviceName = nameOf(creator) ?? nameOf(fileId);
  const sw = n(creator, 'softwareVersion');
  if (sw !== undefined && sw > 0) out.deviceSoftware = sw.toFixed(2);
  const sensors: ActivitySensor[] = [];
  const seen = new Set<string>();
  for (const d of infos) {
    if (isCreator(d) || d.sourceType === 'local') continue;
    const name = nameOf(d);
    const type = typeof d.antplusDeviceType === 'string' ? d.antplusDeviceType : typeof d.bleDeviceType === 'string' ? d.bleDeviceType : undefined;
    let kind = type ? SENSOR_KIND[type] : undefined;
    if (!kind && name) kind = /^hrm/i.test(name) ? 'Heart rate' : /rally|vector|assioma|power/i.test(name) ? 'Power' : /kickr|tacx|neo|trainer/i.test(name) ? 'Trainer' : /varia|radar/i.test(name) ? 'Radar' : undefined;
    if (!kind) continue;
    const key = `${kind}|${name ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sensors.push(name ? { kind, name } : { kind });
  }
  if (sensors.length) out.sensors = sensors;
  return compact(out);
}

function sessionFacts(
  session: M | undefined,
  records: M[],
  sport: Sport | undefined,
  legSport: boolean,
  cadFactor: number,
  messages: Record<string, M[] | undefined>,
): ActivityFacts {
  const s = session;
  const elapsed = n(s, 'totalElapsedTime');
  const timer = n(s, 'totalTimerTime');
  const events = (messages.eventMesgs ?? []).filter((e) => e.event === 'timer');
  // A pause = a timer stop that is followed by a later start.
  let pauses = 0;
  let stopped = false;
  for (const e of events) {
    if (e.eventType === 'stop' || e.eventType === 'stopAll' || e.eventType === 'stopDisable' || e.eventType === 'stopDisableAll') stopped = true;
    else if (e.eventType === 'start' && stopped) {
      pauses++;
      stopped = false;
    }
  }
  const maxCad = n(s, 'maxRunningCadence', 'maxCadence');
  const stance = n(s, 'avgStanceTime') ?? recordMean(records, 'stanceTime');
  const vo = n(s, 'avgVerticalOscillation') ?? recordMean(records, 'verticalOscillation');
  const vr = n(s, 'avgVerticalRatio') ?? recordMean(records, 'verticalRatio');
  const step = n(s, 'avgStepLength') ?? recordMean(records, 'stepLength');
  const gctBal = n(s, 'avgStanceTimeBalance') ?? recordMean(records, 'stanceTimeBalance');
  const cycles = n(s, 'totalCycles', 'totalStrokes');
  const negGrade = n(s, 'maxNegGrade');
  const sportProfile = typeof s?.sportProfileName === 'string' ? s.sportProfileName : typeof messages.sportMesgs?.[0]?.name === 'string' ? (messages.sportMesgs[0]!.name as string) : undefined;
  const runLike = legSport && sport === 'run';
  return compact<ActivityFacts>({
    startLat: deg(n(s, 'startPositionLat')) ?? undefined,
    startLng: deg(n(s, 'startPositionLong')) ?? undefined,
    endLat: deg(n(s, 'endPositionLat')) ?? undefined,
    endLng: deg(n(s, 'endPositionLong')) ?? undefined,
    timerSec: r1(timer),
    pausedSec: elapsed !== undefined && timer !== undefined && elapsed - timer >= 1 ? Math.round(elapsed - timer) : undefined,
    pauseCount: pauses || undefined,
    maxSpeedMps: sport === 'swim' ? undefined : r3(n(s, 'enhancedMaxSpeed', 'maxSpeed')),
    elevationLossM: n(s, 'totalDescent'),
    minAltitudeM: r1(n(s, 'enhancedMinAltitude', 'minAltitude')),
    maxAltitudeM: r1(n(s, 'enhancedMaxAltitude', 'maxAltitude')),
    maxGradePct: n(s, 'maxPosGrade'),
    minGradePct: negGrade === undefined ? undefined : -Math.abs(negGrade),
    minHr: n(s, 'minHeartRate'),
    powerBalanceLeftPct: leftBalancePct(s?.leftRightBalance),
    maxCadence: maxCad === undefined ? undefined : Math.round(maxCad * cadFactor),
    avgGroundContactMs: stance === undefined ? undefined : round(stance, 0),
    avgGroundContactBalanceLeftPct: gctBal === undefined || gctBal <= 0 || gctBal >= 100 ? undefined : round(gctBal, 1),
    avgVerticalOscillationCm: vo === undefined ? undefined : round(vo / 10, 1),
    avgVerticalRatioPct: vr === undefined ? undefined : round(vr, 1),
    avgStrideLengthM: step === undefined ? undefined : round(step / 1000, 2),
    steps: runLike && cycles !== undefined ? Math.round(cycles * 2) : undefined,
    activeLengths: sport === 'swim' ? n(s, 'numActiveLengths') : undefined,
    avgStrokesPerLength: sport === 'swim' ? n(s, 'avgStrokesPerLength', 'avgStrokeCount') : undefined,
    avgDistancePerStrokeM: sport === 'swim' || sport === 'row' ? n(s, 'avgStrokeDistance') : undefined,
    totalStrokes: sport === 'row' ? cycles : undefined,
    avgTempC: n(s, 'avgTemperature'),
    minTempC: n(s, 'minTemperature'),
    maxTempC: n(s, 'maxTemperature'),
    sportProfile,
    ...deviceFacts(messages),
  });
}

function lapExtras(lap: M, sport: Sport | undefined, legSport: boolean): Partial<Lap> {
  const maxCad = n(lap, 'maxRunningCadence', 'maxCadence');
  const stance = n(lap, 'avgStanceTime');
  const vo = n(lap, 'avgVerticalOscillation');
  const step = n(lap, 'avgStepLength');
  return {
    maxPower: n(lap, 'maxPower'),
    maxSpeedMps: sport === 'swim' ? undefined : n(lap, 'enhancedMaxSpeed', 'maxSpeed'),
    maxCadence: maxCad === undefined ? undefined : Math.round(maxCad * (legSport && maxCad <= 130 ? 2 : 1)),
    elevationLossM: n(lap, 'totalDescent'),
    avgTempC: n(lap, 'avgTemperature'),
    calories: n(lap, 'totalCalories'),
    strokes: sport === 'swim' || sport === 'row' ? n(lap, 'totalCycles', 'totalStrokes') : undefined,
    avgGroundContactMs: stance === undefined ? undefined : round(stance, 0),
    avgVerticalOscillationCm: vo === undefined ? undefined : round(vo / 10, 1),
    avgVerticalRatioPct: n(lap, 'avgVerticalRatio'),
    avgStrideLengthM: step === undefined ? undefined : round(step / 1000, 2),
  };
}

function swimLengthsOf(lengths: M[], laps: M[], startMs: number): SwimLength[] {
  const lapOf = (i: number): number | undefined => {
    for (let k = 0; k < laps.length; k++) {
      const first = n(laps[k], 'firstLengthIndex');
      const count = n(laps[k], 'numLengths');
      if (first !== undefined && count !== undefined && i >= first && i < first + count) return k;
    }
    return undefined;
  };
  return lengths.map((l, i) => {
    const st = ms(l.startTime) ?? ms(l.timestamp);
    const dur = n(l, 'totalElapsedTime', 'totalTimerTime') ?? 0;
    const rest = l.lengthType === 'idle';
    const strokes = n(l, 'totalStrokes');
    const stroke = typeof l.swimStroke === 'string' ? (STROKE_MAP[l.swimStroke] ?? l.swimStroke) : undefined;
    return compact<SwimLength>({
      index: i,
      lapIndex: lapOf(i),
      startSec: st === undefined ? 0 : round((st - startMs) / 1000, 1),
      durationSec: round(dur, 1),
      stroke: rest ? undefined : stroke,
      strokes: rest ? undefined : strokes,
      strokeRate: rest ? undefined : n(l, 'avgSwimmingCadence'),
      swolf: !rest && strokes !== undefined && dur > 0 ? Math.round(strokes + dur) : undefined,
      isRest: rest || undefined,
    });
  });
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
