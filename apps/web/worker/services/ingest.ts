/**
 * The single ingest pipeline (see ./ingest.types.ts and docs/ARCHITECTURE.md → Ingest pipeline).
 *
 *   (FIT) → merge summary → prepare 1 Hz streams → thresholds on the local date →
 *   computeActivityMetrics → upsert activity + gzip streams (+ original FIT) → auto-pair.
 *
 * Re-ingest rules:
 *  - dedupe by garmin_activity_id (uploads without one: by start instant + sport);
 *  - soft-deleted rows are never resurrected (`skipped`);
 *  - an unchanged `editHash` (and no new streams, no `force`) is a no-op (`unchanged`);
 *  - athlete fields (rpe, feel, post_note, tags, is_key, intensity_override, load_manual) are only
 *    written on creation; the title is overwritten only while it still equals the previously
 *    ingested upstream title (`upstream_title`), so a rename by the athlete survives syncs.
 */
import type { ActivityStreams, Lap, LocalDate, Sport, StrengthSet, SubSport, ThresholdSnapshot, ZoneTime } from '@cadence/core/domain';
import { SPORT_META } from '@cadence/core/domain';
import {
  bestEfforts,
  computeActivityMetrics,
  ergPowerFromSpeed,
  meanMaximal,
  prepareStreams,
  ROW_EFFORT_DISTANCES,
  RUN_EFFORT_DISTANCES,
  swimBestEfforts,
  SWIM_EFFORT_DISTANCES,
  volumeLoad,
  type ActivityMetrics,
  type PreparedStreams,
} from '@cadence/core/metrics';
import { localDateOf } from '@cadence/core/time';
import { extractFitFromDownload, parseFit, type FitParseResult } from '@cadence/garmin';
import { getSettings } from '../db/settings';
import { thresholdsOn } from '../db/thresholds';
import { parseJson } from '../db/sql';
import { encodeStreams, getStreams, MAX_FILE_BYTES, putFileStmt, putStreamsStmt, roundStreams } from '../db/streams';
import { newId } from '../lib/ids';
import { autoPairDates } from './pairing';
import type { IngestActivity, IngestResult, IngestSummary, RecomputeActivities } from './ingest.types';

/** Bump when the derived columns change meaning (lets a future job find stale rows). */
export const METRICS_VERSION = 2;

/** Reduced duration ladder stored per activity (the full 518-point ladder is too heavy to keep per row). */
export const PEAK_DURATIONS: readonly number[] = [
  1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600, 720, 900, 1200, 1500, 1800, 2400, 3000,
  3600, 4500, 5400, 7200, 9000, 10800, 14400, 18000,
];

const MULTISPORT_KEYS = new Set(['multi_sport', 'triathlon', 'duathlon', 'multisport', 'swimrun', 'brick']);

// ───────────────────────────── streams ─────────────────────────────

const PREP_CHANNELS = ['hr', 'power', 'speed', 'cadence', 'altitude', 'distance', 'grade'] as const;

/** Resample a raw channel (lat/lng/temp, not handled by prepareStreams) onto whole seconds. */
function resampleOnto(rawT: readonly number[], vals: ReadonlyArray<number | null> | undefined, t0: number, grid: number[]): Array<number | null> | undefined {
  if (!vals) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < rawT.length; i++) {
    const v = vals[i];
    const t = rawT[i];
    if (typeof v === 'number' && Number.isFinite(v) && typeof t === 'number' && Number.isFinite(t)) {
      xs.push(t - t0);
      ys.push(v);
    }
  }
  if (!xs.length) return undefined;
  const out = new Array<number | null>(grid.length);
  let j = 0;
  for (let k = 0; k < grid.length; k++) {
    const g = grid[k];
    while (j + 1 < xs.length && xs[j + 1] <= g) j++;
    if (xs[j] === g) out[k] = ys[j];
    else if (xs[j] < g && j + 1 < xs.length && xs[j + 1] - xs[j] <= 10) {
      const f = (g - xs[j]) / (xs[j + 1] - xs[j]);
      out[k] = ys[j] + f * (ys[j + 1] - ys[j]);
    } else out[k] = null;
  }
  return out;
}

/**
 * Raw device streams → the stored representation: the prepared 1 Hz elapsed series with paused
 * seconds removed, rounded. Returns null when there is nothing usable.
 */
export function buildStoredStreams(raw: ActivityStreams | undefined, sport: Sport, subSport?: SubSport): ActivityStreams | null {
  if (!raw?.t?.length) return null;
  const prep = prepareStreams(raw, { sport, subSport });
  const e = prep.elapsed;
  const N = e.t.length;
  if (!N) return null;
  const keep: number[] = [];
  for (let g = 0; g < N; g++) if (!e.paused[g]) keep.push(g);
  if (!keep.length) return null;
  const out: ActivityStreams = { t: keep };
  for (const ch of PREP_CHANNELS) {
    const src = e[ch];
    if (!src) continue;
    const arr = new Array<number | null>(keep.length);
    let any = false;
    for (let k = 0; k < keep.length; k++) {
      const v = src[keep[k]];
      if (Number.isNaN(v)) arr[k] = null;
      else {
        arr[k] = v;
        any = true;
      }
    }
    if (any) out[ch] = arr;
  }
  let t0 = Infinity;
  for (const t of raw.t) if (typeof t === 'number' && Number.isFinite(t) && t < t0) t0 = t;
  for (const ch of ['temp', 'lat', 'lng'] as const) {
    const r = resampleOnto(raw.t, raw[ch], t0, keep);
    if (r) out[ch] = r;
  }
  if (!out.lat || !out.lng) {
    delete out.lat;
    delete out.lng;
  }
  return roundStreams(out);
}

/** Pauses implied by gaps in a stored `t` (a gap of g seconds = g − 1 paused seconds). */
export function pausesOf(t: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k + 1 < t.length; k++) if (t[k + 1] - t[k] > 1) out.push([t[k] + 1, t[k + 1]]);
  return out;
}

export function prepareStored(stored: ActivityStreams, sport: Sport, subSport?: SubSport): PreparedStreams {
  return prepareStreams(stored, { sport, subSport, pauses: pausesOf(stored.t) });
}

// ───────────────────────────── metrics ─────────────────────────────

export interface AnalyzeInput {
  sport: Sport;
  subSport?: SubSport;
  stored: ActivityStreams | null;
  durationSec: number;
  movingSec?: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  weightedPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  avgCadence?: number;
  laps: Lap[];
  strengthSets?: StrengthSet[];
  rpe?: number;
  loadManual?: number;
  intensityOverride?: string;
  hrTimeInZoneSec?: number[];
  powerTimeInZoneSec?: number[];
  thresholds: ThresholdSnapshot;
  sex?: 'male' | 'female' | 'unspecified';
}

const r = (v: number | undefined, dp: number): number | undefined => (v === undefined || !Number.isFinite(v) ? undefined : Math.round(v * 10 ** dp) / 10 ** dp);

function present(x: Float64Array | undefined): x is Float64Array {
  if (!x) return false;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) return true;
  return false;
}

function reducedPeaks(prep: PreparedStreams, sport: Sport, subSport: SubSport | undefined, laps: Lap[]): ActivityMetrics['peaks'] {
  const el = prep.elapsed;
  const peaks: ActivityMetrics['peaks'] = {};
  const round = (pts: { durationSec: number; value: number; startSec?: number }[], dp: number) =>
    pts.map((p) => ({ durationSec: p.durationSec, value: r(p.value, dp)!, startSec: p.startSec }));
  let power = present(el.power) ? el.power : undefined;
  if (!power && sport === 'row' && subSport !== 'on_water' && present(el.speed)) power = ergPowerFromSpeed(el.speed!);
  if (power && (sport === 'bike' || sport === 'row' || present(el.power))) peaks.power = round(meanMaximal(power, PEAK_DURATIONS), 0);
  if (present(el.hr)) peaks.hr = round(meanMaximal(el.hr!, PEAK_DURATIONS, { missing: 'skip' }), 0);
  const legs = sport === 'run' || sport === 'walk' || sport === 'hike';
  if (legs && present(el.speed)) peaks.speed = round(meanMaximal(el.speed!, PEAK_DURATIONS, { missing: 'zero' }), 3);
  if (present(el.distance)) {
    const targets = legs ? RUN_EFFORT_DISTANCES : sport === 'row' ? ROW_EFFORT_DISTANCES : sport === 'swim' && !laps.length ? SWIM_EFFORT_DISTANCES : null;
    if (targets) peaks.efforts = bestEfforts(el.distance!, targets).map((e) => ({ ...e, timeSec: r(e.timeSec, 1)! }));
  }
  if (sport === 'swim' && laps.length) peaks.efforts = swimBestEfforts(laps);
  for (const k of Object.keys(peaks) as Array<keyof typeof peaks>) if (!peaks[k]?.length) delete peaks[k];
  return peaks;
}

function elevationGainOf(alt: Float64Array | undefined): number | undefined {
  if (!present(alt)) return undefined;
  let gain = 0;
  let ref = NaN;
  for (let i = 0; i < alt.length; i++) {
    const v = alt[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(ref)) ref = v;
    else if (v - ref >= 2) {
      gain += v - ref;
      ref = v;
    } else if (v < ref) ref = v;
  }
  return gain;
}

function meanNonZero(x: Float64Array | undefined): number | undefined {
  if (!x) return undefined;
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) if (x[i] > 0) (s += x[i]), c++;
  return c ? s / c : undefined;
}

const zonesFromSeconds = (secs: number[] | undefined): ZoneTime[] | undefined =>
  secs?.length ? secs.map((seconds, i) => ({ zone: i + 1, name: `Z${i + 1}`, low: null, high: null, seconds })) : undefined;

/** Derived columns (snake_case → value) for the activities row. Shared by ingest and recompute. */
export function analyzeActivity(input: AnalyzeInput): { columns: Record<string, unknown>; metrics: ActivityMetrics } {
  const { sport, subSport, stored } = input;
  const prep = stored ? prepareStored(stored, sport, subSport) : null;
  const metrics = computeActivityMetrics({
    sport,
    subSport,
    streams: stored,
    thresholds: input.thresholds,
    sex: input.sex,
    summary: {
      durationSec: input.durationSec,
      movingSec: input.movingSec,
      distanceM: input.distanceM,
      avgHr: input.avgHr,
      maxHr: input.maxHr,
      avgPower: input.avgPower,
      weightedPower: input.weightedPower,
      maxPower: input.maxPower,
      avgSpeedMps: input.avgSpeedMps,
      rpe: input.rpe,
      manualLoad: input.loadManual,
      laps: sport === 'swim' && input.laps.length ? input.laps : undefined,
    },
    options: {
      pauses: stored ? pausesOf(stored.t) : undefined,
      intensityClass: input.intensityOverride as never,
      peaks: false, // computed below on the reduced ladder (much cheaper than the full ladder)
    },
  });
  const hasStreams = !!prep && prep.movingSec > 0;
  const peaks = hasStreams ? reducedPeaks(prep!, sport, subSport, input.laps) : sport === 'swim' && input.laps.length ? { efforts: swimBestEfforts(input.laps) } : {};
  const zones: Record<string, unknown> = { ...metrics.zones };
  if (!zones.hr) {
    const z = zonesFromSeconds(input.hrTimeInZoneSec);
    if (z) zones.hr = z;
  }
  if (!zones.power) {
    const z = zonesFromSeconds(input.powerTimeInZoneSec);
    if (z) zones.power = z;
  }
  if (metrics.intensitySec) zones.three = metrics.intensitySec;

  const elevation = input.elevationGainM ?? (hasStreams && SPORT_META[sport].hasDistance ? elevationGainOf(prep!.elapsed.altitude) : undefined);
  const cadence = input.avgCadence ?? (hasStreams ? meanNonZero(prep!.active.cadence) : undefined);
  const sets = input.strengthSets;
  const volume = sets?.length ? volumeLoad(sets) : undefined;
  const columns: Record<string, unknown> = {
    duration_sec: r(input.durationSec > 0 ? input.durationSec : metrics.elapsedSec, 1) ?? 0,
    moving_sec: r(metrics.movingSec, 1) ?? 0,
    distance_m: SPORT_META[sport].hasDistance || (metrics.distanceM ?? 0) > 0 ? r(metrics.distanceM, 1) : undefined,
    elevation_gain_m: r(elevation, 1),
    load: r(metrics.load, 1) ?? 0,
    load_source: metrics.loadSource,
    intensity_factor: r(metrics.intensityFactor, 3),
    avg_hr: r(metrics.avgHr, 0),
    max_hr: r(metrics.maxHr, 0),
    avg_power: r(metrics.avgPower, 0),
    weighted_power: r(metrics.weightedPower, 0),
    max_power: r(metrics.maxPower, 0),
    avg_speed_mps: r(metrics.avgSpeedMps, 3),
    adjusted_speed_mps: r(metrics.adjustedSpeedMps, 3),
    avg_cadence: r(cadence, 1),
    work_kj: r(metrics.workKj, 1),
    variability: r(metrics.variability, 3),
    efficiency: r(metrics.efficiency, 4),
    decoupling_pct: r(metrics.decouplingPct, 2),
    volume_kg: volume && volume > 0 ? r(volume, 1) : undefined,
    intensity_auto: metrics.intensityAuto,
    has_streams: hasStreams ? 1 : 0,
    sparkline: metrics.sparkline.length ? metrics.sparkline.map((v) => r(v, 2)) : null,
    zones,
    peaks,
    thresholds_used: input.thresholds,
    metrics_version: METRICS_VERSION,
  };
  return { columns, metrics };
}

// ───────────────────────────── ingest ─────────────────────────────

interface ExistingRow {
  id: string;
  summary_hash: string | null;
  deleted_at: string | null;
  title: string;
  upstream_title: string | null;
  rpe: number | null;
  load_manual: number | null;
  intensity_override: string | null;
  local_date: string;
  has_streams: number;
  paired_workout_id: string | null;
}

const EXISTING_COLS =
  'id, summary_hash, deleted_at, title, upstream_title, rpe, load_manual, intensity_override, local_date, has_streams, paired_workout_id';

function defaultTitle(sport: Sport, subSport?: SubSport): string {
  const label = SPORT_META[sport]?.label ?? 'Activity';
  if (subSport === 'indoor' || subSport === 'virtual') return `Indoor ${label.toLowerCase()}`;
  if (subSport === 'treadmill') return 'Treadmill run';
  if (subSport === 'trail') return 'Trail run';
  if (subSport === 'open_water') return 'Open water swim';
  return label;
}

const pick = <T>(...vals: Array<T | undefined | null>): T | undefined => {
  for (const v of vals) if (v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v))) return v;
  return undefined;
};

function skipped(activityId: string, reason: string, warnings: string[]): IngestResult {
  return { activityId, outcome: 'skipped', reason, warnings };
}

/** Insert/update column order — the values are bound positionally. */
function upsertStmt(db: D1Database, id: string, cols: Record<string, unknown>, isNew: boolean): D1PreparedStatement {
  const keys = Object.keys(cols);
  const vals = keys.map((k) => bindCol(cols[k]));
  if (isNew) {
    return db.prepare(`INSERT INTO activities (id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).bind(id, ...vals);
  }
  return db.prepare(`UPDATE activities SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...vals, id);
}

function bindCol(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

export const ingestActivity: IngestActivity = async (env, input) => {
  const db = env.DB;
  const warnings: string[] = [];
  const s: Partial<IngestSummary> = input.summary ?? {};

  if (s.garminTypeKey && MULTISPORT_KEYS.has(s.garminTypeKey.toLowerCase())) return skipped('', 'multisport parent', warnings);
  if ((s as { isMultisportParent?: boolean }).isMultisportParent) return skipped('', 'multisport parent', warnings);

  // ── parse FIT (never throws)
  let fit: FitParseResult | undefined;
  let fitBytes: Uint8Array | undefined;
  if (input.fit) {
    fitBytes = extractFitFromDownload(input.fit) ?? input.fit;
    try {
      fit = parseFit(fitBytes);
    } catch (e) {
      fit = { ok: false, warnings: [`parse failed: ${e instanceof Error ? e.message : String(e)}`], summary: {}, laps: [], sessionCount: 0 };
    }
    warnings.push(...fit.warnings);
    if (!fit.ok) {
      fit = undefined;
      fitBytes = undefined;
      if (!input.summary) return skipped('', 'unreadable FIT file', warnings);
    }
  }
  if (fit?.fitSport === 'multisport' && !input.summary) return skipped('', 'multisport parent', warnings);
  const fs = fit?.summary ?? {};

  // ── merge: explicit summary wins field by field over the FIT session
  const rawStreams = input.streams ?? fit?.streams;
  const startedAt = pick(s.startedAt, fit?.startedAt);
  const sport: Sport = pick(s.sport, fit?.sport) ?? 'other';
  const subSport = pick<SubSport>(s.subSport, fit?.subSport);
  const lastT = rawStreams?.t?.length ? rawStreams.t[rawStreams.t.length - 1] - rawStreams.t[0] : undefined;
  const durationSec = pick(s.durationSec, fs.durationSec, lastT);
  if (!startedAt || durationSec === undefined) return skipped('', 'missing start time or duration', warnings);
  const utcOffsetMin = pick(s.utcOffsetMin, fit?.utcOffsetMin) ?? 0;
  const localDate: LocalDate = pick(s.localDate, fit?.localDate) ?? localDateOf(startedAt, utcOffsetMin);
  const upstreamTitle = pick(s.title, fit?.workoutName) ?? defaultTitle(sport, subSport);
  const laps = input.laps ?? fit?.laps ?? [];
  const strengthSets = input.strengthSets ?? fit?.strengthSets;

  // ── existing row
  let existing: ExistingRow | null = null;
  if (s.garminActivityId) {
    existing = await db.prepare(`SELECT ${EXISTING_COLS} FROM activities WHERE garmin_activity_id = ?`).bind(s.garminActivityId).first<ExistingRow>();
  } else if (input.source !== 'manual') {
    existing = await db
      .prepare(`SELECT ${EXISTING_COLS} FROM activities WHERE started_at = ? AND sport = ? AND garmin_activity_id IS NULL ORDER BY deleted_at IS NULL DESC LIMIT 1`)
      .bind(startedAt, sport)
      .first<ExistingRow>();
  }
  if (existing?.deleted_at) return skipped(existing.id, 'deleted locally', warnings);
  const bringsStreams = !!rawStreams?.t?.length;
  if (existing && !input.force && s.editHash && existing.summary_hash === s.editHash && (!bringsStreams || existing.has_streams === 1)) {
    const res: IngestResult = { activityId: existing.id, outcome: 'unchanged', warnings };
    if (existing.paired_workout_id) res.pairedWorkoutId = existing.paired_workout_id;
    return res;
  }

  // ── streams (keep stored ones when a summary-only re-ingest arrives)
  let stored = bringsStreams ? buildStoredStreams(rawStreams, sport, subSport) : null;
  if (bringsStreams && !stored) warnings.push('streams had no usable samples');
  let reuseStored = false;
  if (!stored && existing?.has_streams === 1) {
    stored = await getStreams(db, existing.id);
    reuseStored = !!stored;
  }

  const [thresholds, settings] = await Promise.all([thresholdsOn(db, localDate, sport), getSettings(db)]);
  const rpe = existing ? (existing.rpe ?? undefined) : input.user?.rpe;
  const loadManual = existing ? (existing.load_manual ?? undefined) : input.user?.loadManual;
  const intensityOverride = existing?.intensity_override ?? undefined;
  const { columns } = analyzeActivity({
    sport,
    subSport,
    stored,
    durationSec,
    movingSec: pick(s.movingSec, fs.movingSec),
    distanceM: pick(s.distanceM, fs.distanceM),
    elevationGainM: pick(s.elevationGainM, fs.elevationGainM),
    avgHr: pick(s.avgHr, fs.avgHr),
    maxHr: pick(s.maxHr, fs.maxHr),
    avgPower: pick(s.avgPower, fs.avgPower),
    weightedPower: pick(s.weightedPower, fs.weightedPower),
    maxPower: pick(s.maxPower, fs.maxPower),
    avgSpeedMps: pick(s.avgSpeedMps, fs.avgSpeedMps),
    avgCadence: pick(s.avgCadence, fs.avgCadence),
    laps,
    strengthSets,
    rpe,
    loadManual,
    intensityOverride,
    hrTimeInZoneSec: s.hrTimeInZoneSec,
    powerTimeInZoneSec: s.powerTimeInZoneSec,
    thresholds,
    sex: settings.sex,
  });

  const now = new Date().toISOString();
  const upstream: Record<string, unknown> = {
    source: existing ? undefined : input.source,
    garmin_activity_id: s.garminActivityId,
    garmin_type_key: s.garminTypeKey,
    started_at: startedAt,
    utc_offset_min: utcOffsetMin,
    local_date: localDate,
    sport,
    sub_sport: subSport,
    ...columns,
    calories: pick(s.calories, fs.calories),
    aerobic_effect: pick(s.aerobicEffect, fs.aerobicEffect),
    anaerobic_effect: pick(s.anaerobicEffect, fs.anaerobicEffect),
    pool_length_m: pick(s.poolLengthM, fs.poolLengthM),
    strokes: pick(s.strokes, fs.strokes),
    avg_swolf: pick(s.avgSwolf, fs.avgSwolf),
    total_sets: pick(s.totalSets, fs.totalSets),
    total_reps: pick(s.totalReps, fs.totalReps),
    volume_kg: columns.volume_kg ?? fs.volumeKg,
    laps,
    strength_sets: strengthSets ?? null,
    summary_hash: s.editHash ?? null,
    upstream_title: upstreamTitle,
    updated_at: now,
  };
  if (existing) {
    delete upstream.source;
    if (existing.upstream_title === null || existing.title === existing.upstream_title) upstream.title = upstreamTitle;
  } else {
    const u = input.user ?? {};
    Object.assign(upstream, {
      title: upstreamTitle,
      rpe: u.rpe,
      feel: u.feel,
      post_note: u.postNote,
      tags: u.tags ?? [],
      is_key: u.isKey ? 1 : 0,
      load_manual: u.loadManual,
      created_at: now,
    });
  }

  const id = existing?.id ?? newId('act');
  const stmts: D1PreparedStatement[] = [upsertStmt(db, id, upstream, !existing)];
  if (stored && !reuseStored) stmts.push(putStreamsStmt(db, id, await encodeStreams(stored), stored.t.length));
  if (fitBytes && fitBytes.byteLength < MAX_FILE_BYTES) stmts.push(putFileStmt(db, id, fitBytes));
  await db.batch(stmts);

  const dates = [localDate];
  if (existing && existing.local_date !== localDate) dates.push(existing.local_date);
  await autoPairDates(env, dates);
  const paired = await db.prepare('SELECT paired_workout_id FROM activities WHERE id = ?').bind(id).first<{ paired_workout_id: string | null }>();

  const result: IngestResult = { activityId: id, outcome: existing ? 'updated' : 'created', warnings };
  if (paired?.paired_workout_id) result.pairedWorkoutId = paired.paired_workout_id;
  return result;
};

// ───────────────────────────── recompute ─────────────────────────────

interface RecomputeRow {
  id: string;
  local_date: string;
  sport: Sport;
  sub_sport: SubSport | null;
  duration_sec: number;
  moving_sec: number;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  weighted_power: number | null;
  max_power: number | null;
  avg_speed_mps: number | null;
  avg_cadence: number | null;
  rpe: number | null;
  load_manual: number | null;
  intensity_override: string | null;
  has_streams: number;
  laps: string;
  strength_sets: string | null;
  zones: string;
}

const nn = (v: number | null): number | undefined => (v === null ? undefined : v);

/** Re-derive metrics of one stored activity (after a threshold / sport / RPE change). Returns the new columns. */
export async function recomputeOne(env: Env, row: RecomputeRow, ctx?: { sex?: AnalyzeInput['sex']; thresholds?: ThresholdSnapshot }): Promise<Record<string, unknown>> {
  const db = env.DB;
  const stored = row.has_streams ? await getStreams(db, row.id) : null;
  const thresholds = ctx?.thresholds ?? (await thresholdsOn(db, row.local_date, row.sport));
  const sex = ctx?.sex ?? (await getSettings(db)).sex;
  const zones = parseJson<{ hr?: ZoneTime[]; power?: ZoneTime[] }>(row.zones, {});
  const secs = (z: ZoneTime[] | undefined) => (z && z.every((x) => x.low === null && x.high === null) ? z.map((x) => x.seconds) : undefined);
  const { columns } = analyzeActivity({
    sport: row.sport,
    subSport: row.sub_sport ?? undefined,
    stored,
    durationSec: row.duration_sec,
    movingSec: row.moving_sec,
    distanceM: nn(row.distance_m),
    elevationGainM: nn(row.elevation_gain_m),
    avgHr: stored ? undefined : nn(row.avg_hr),
    maxHr: stored ? undefined : nn(row.max_hr),
    avgPower: stored ? undefined : nn(row.avg_power),
    weightedPower: stored ? undefined : nn(row.weighted_power),
    maxPower: stored ? undefined : nn(row.max_power),
    avgSpeedMps: nn(row.avg_speed_mps),
    avgCadence: nn(row.avg_cadence),
    laps: parseJson<Lap[]>(row.laps, []),
    strengthSets: parseJson<StrengthSet[] | undefined>(row.strength_sets, undefined),
    rpe: nn(row.rpe),
    loadManual: nn(row.load_manual),
    intensityOverride: row.intensity_override ?? undefined,
    hrTimeInZoneSec: stored ? undefined : secs(zones.hr),
    powerTimeInZoneSec: stored ? undefined : secs(zones.power),
    thresholds,
    sex,
  });
  return columns;
}

export const RECOMPUTE_COLS = `id, local_date, sport, sub_sport, duration_sec, moving_sec, distance_m, elevation_gain_m, avg_hr, max_hr,
  avg_power, weighted_power, max_power, avg_speed_mps, avg_cadence, rpe, load_manual, intensity_override, has_streams, laps,
  strength_sets, zones`;

/** Persist recomputed columns for one activity (single statement). */
export function recomputeStmt(db: D1Database, id: string, columns: Record<string, unknown>): D1PreparedStatement {
  const cols: Record<string, unknown> = { ...columns, updated_at: new Date().toISOString() };
  delete cols.has_streams;
  return upsertStmt(db, id, cols, false);
}

/** Recompute one activity by id and save it. */
export async function recomputeActivity(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT ${RECOMPUTE_COLS} FROM activities WHERE id = ?`).bind(id).first<RecomputeRow>();
  if (!row) return;
  const cols = await recomputeOne(env, row);
  await recomputeStmt(env.DB, id, cols).run();
}

export const recomputeActivities: RecomputeActivities = async (env, opts) => {
  const db = env.DB;
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const w = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (opts.from) w.push('local_date >= ?'), params.push(opts.from);
  if (opts.to) w.push('local_date <= ?'), params.push(opts.to);
  if (opts.sport) w.push('sport = ?'), params.push(opts.sport);
  if (opts.cursor) w.push('id > ?'), params.push(opts.cursor);
  const { results } = await db
    .prepare(`SELECT ${RECOMPUTE_COLS} FROM activities WHERE ${w.join(' AND ')} ORDER BY id LIMIT ?`)
    .bind(...params, limit + 1)
    .all<RecomputeRow>();
  const page = results.slice(0, limit);
  if (!page.length) return { recomputed: 0 };
  const { sex } = await getSettings(db);
  const thrCache = new Map<string, Promise<ThresholdSnapshot>>();
  const stmts: D1PreparedStatement[] = [];
  for (const row of page) {
    const key = `${row.local_date}|${row.sport}`;
    let thr = thrCache.get(key);
    if (!thr) thrCache.set(key, (thr = thresholdsOn(db, row.local_date, row.sport)));
    stmts.push(recomputeStmt(db, row.id, await recomputeOne(env, row, { sex, thresholds: await thr })));
  }
  await db.batch(stmts);
  const out: { recomputed: number; nextCursor?: string } = { recomputed: page.length };
  if (results.length > limit) out.nextCursor = page[page.length - 1].id;
  return out;
};
