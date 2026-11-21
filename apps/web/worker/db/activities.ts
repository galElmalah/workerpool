/**
 * Activities repository (B). Maps `activities` rows ↔ domain `Activity` / `ActivityDetail` parts.
 * List/get queries select only the summary columns; the heavy JSON columns (laps, zones,
 * peaks, strength sets, thresholds) are read by `getActivityExtras` for the detail page.
 */
import type {
  Activity,
  BestEffort,
  IntensityClass,
  Lap,
  LocalDate,
  PeakPoint,
  Sport,
  StrengthSet,
  ThresholdSnapshot,
  ZoneTime,
} from '@cadence/core/domain';
import { chunk, compact, parseJson, placeholders } from './sql';

/** Columns needed to build a domain Activity (no heavy JSON). */
export const ACTIVITY_COLUMNS = `id, source, garmin_activity_id, garmin_type_key, started_at, utc_offset_min, local_date, sport,
  sub_sport, title, duration_sec, moving_sec, distance_m, elevation_gain_m, load, load_source, intensity_factor, avg_hr, max_hr,
  avg_power, weighted_power, max_power, avg_speed_mps, adjusted_speed_mps, avg_cadence, calories, work_kj, variability,
  efficiency, decoupling_pct, aerobic_effect, anaerobic_effect, pool_length_m, strokes, avg_swolf, total_sets, total_reps,
  volume_kg, intensity_auto, intensity_override, is_key, rpe, feel, post_note, tags, paired_workout_id, has_streams,
  sparkline, created_at, updated_at`;

export type ActivityRow = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function rowToActivity(r: ActivityRow): Activity {
  const intensityAuto = (str(r.intensity_auto) ?? 'endurance') as IntensityClass;
  const intensityOverride = str(r.intensity_override) as IntensityClass | undefined;
  const sparkline = parseJson<number[] | null>(r.sparkline, null);
  const a = compact({
    id: r.id as string,
    source: r.source as Activity['source'],
    garminActivityId: str(r.garmin_activity_id),
    garminTypeKey: str(r.garmin_type_key),
    startedAt: r.started_at as string,
    utcOffsetMin: num(r.utc_offset_min) ?? 0,
    localDate: r.local_date as string,
    sport: r.sport as Sport,
    subSport: str(r.sub_sport) as Activity['subSport'],
    title: (r.title as string) ?? '',
    durationSec: num(r.duration_sec) ?? 0,
    movingSec: num(r.moving_sec) ?? 0,
    distanceM: num(r.distance_m),
    elevationGainM: num(r.elevation_gain_m),
    load: num(r.load) ?? 0,
    loadSource: (str(r.load_source) ?? 'duration') as Activity['loadSource'],
    intensityFactor: num(r.intensity_factor),
    avgHr: num(r.avg_hr),
    maxHr: num(r.max_hr),
    avgPower: num(r.avg_power),
    weightedPower: num(r.weighted_power),
    maxPower: num(r.max_power),
    avgSpeedMps: num(r.avg_speed_mps),
    adjustedSpeedMps: num(r.adjusted_speed_mps),
    avgCadence: num(r.avg_cadence),
    calories: num(r.calories),
    workKj: num(r.work_kj),
    variability: num(r.variability),
    efficiency: num(r.efficiency),
    decouplingPct: num(r.decoupling_pct),
    aerobicEffect: num(r.aerobic_effect),
    anaerobicEffect: num(r.anaerobic_effect),
    poolLengthM: num(r.pool_length_m),
    strokes: num(r.strokes),
    avgSwolf: num(r.avg_swolf),
    totalSets: num(r.total_sets),
    totalReps: num(r.total_reps),
    volumeKg: num(r.volume_kg),
    intensityAuto,
    intensityOverride,
    intensity: intensityOverride ?? intensityAuto,
    isKey: r.is_key === 1 || r.is_key === true,
    rpe: num(r.rpe),
    feel: num(r.feel),
    postNote: str(r.post_note),
    tags: parseJson<string[]>(r.tags, []),
    pairedWorkoutId: str(r.paired_workout_id),
    hasStreams: r.has_streams === 1 || r.has_streams === true,
    sparkline: sparkline && sparkline.length ? sparkline : undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  } as Record<string, unknown>) as unknown as Activity;
  return a;
}

export interface ActivityQuery {
  from?: LocalDate;
  to?: LocalDate;
  sport?: Sport;
  ids?: string[];
}

function where(q: ActivityQuery, extra: string[] = [], params: unknown[] = []): { sql: string; params: unknown[] } {
  const w = ['deleted_at IS NULL', ...extra];
  if (q.from) {
    w.push('local_date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    w.push('local_date <= ?');
    params.push(q.to);
  }
  if (q.sport) {
    w.push('sport = ?');
    params.push(q.sport);
  }
  return { sql: w.join(' AND '), params };
}

/** Prepared statement for `listActivities` (exported so callers can batch it). */
export function listActivitiesStmt(db: D1Database, q: Omit<ActivityQuery, 'ids'>): D1PreparedStatement {
  const { sql, params } = where(q);
  return db.prepare(`SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE ${sql} ORDER BY started_at`).bind(...params);
}

/** Non-deleted activities, oldest first. */
export async function listActivities(db: D1Database, q: ActivityQuery): Promise<Activity[]> {
  if (q.ids) {
    if (!q.ids.length) return [];
    const out: Activity[] = [];
    for (const ids of chunk([...new Set(q.ids)], 90)) {
      const { sql, params } = where(q, [`id IN (${placeholders(ids.length)})`], [...ids]);
      const { results } = await db.prepare(`SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE ${sql} ORDER BY started_at`).bind(...params).all<ActivityRow>();
      out.push(...results.map(rowToActivity));
    }
    return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  const { results } = await listActivitiesStmt(db, q).all<ActivityRow>();
  return results.map(rowToActivity);
}

/** A non-deleted activity, or (with `includeDeleted`) a soft-deleted one too. */
export async function getActivity(db: D1Database, id: string, opts: { includeDeleted?: boolean } = {}): Promise<Activity | null> {
  const row = await db
    .prepare(`SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE id = ?${opts.includeDeleted ? '' : ' AND deleted_at IS NULL'}`)
    .bind(id)
    .first<ActivityRow>();
  return row ? rowToActivity(row) : null;
}

export async function getActivityByGarminId(
  db: D1Database,
  garminActivityId: string,
): Promise<{ id: string; summaryHash?: string; deleted: boolean } | null> {
  const row = await db
    .prepare('SELECT id, summary_hash, deleted_at FROM activities WHERE garmin_activity_id = ?')
    .bind(garminActivityId)
    .first<{ id: string; summary_hash: string | null; deleted_at: string | null }>();
  if (!row) return null;
  const out: { id: string; summaryHash?: string; deleted: boolean } = { id: row.id, deleted: row.deleted_at !== null };
  if (row.summary_hash) out.summaryHash = row.summary_hash;
  return out;
}

/**
 * Soft delete (a later sync will not resurrect it). The paired planned workout is released
 * (auto-pairing may pair it again with another activity of that day).
 */
export async function softDeleteActivity(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE workouts SET paired_activity_id = NULL, pair_manual = 0 WHERE paired_activity_id = ?').bind(id),
    db
      .prepare('UPDATE activities SET deleted_at = ?, paired_workout_id = NULL, pair_manual = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(now, now, id),
  ]);
}

export async function restoreActivity(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE activities SET deleted_at = NULL, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
}

/** Heavy per-activity JSON used by the detail page / analytics. */
export interface ActivityExtras {
  laps: Lap[];
  zones: { hr?: ZoneTime[]; power?: ZoneTime[]; pace?: ZoneTime[]; three?: { easy: number; moderate: number; hard: number } };
  peaks: { power?: PeakPoint[]; hr?: PeakPoint[]; speed?: PeakPoint[]; efforts?: BestEffort[] };
  strengthSets?: StrengthSet[];
  thresholdsUsed: ThresholdSnapshot;
  loadManual?: number;
  upstreamTitle?: string;
  summaryHash?: string;
  deletedAt?: string;
  pairManual: boolean;
}

export function rowToExtras(r: ActivityRow): ActivityExtras {
  const out: ActivityExtras = {
    laps: parseJson<Lap[]>(r.laps, []),
    zones: parseJson(r.zones, {}),
    peaks: parseJson(r.peaks, {}),
    thresholdsUsed: parseJson<ThresholdSnapshot>(r.thresholds_used, {}),
    pairManual: r.pair_manual === 1,
  };
  const sets = parseJson<StrengthSet[] | null>(r.strength_sets, null);
  if (sets) out.strengthSets = sets;
  if (num(r.load_manual) !== undefined) out.loadManual = r.load_manual as number;
  if (str(r.upstream_title)) out.upstreamTitle = r.upstream_title as string;
  if (str(r.summary_hash)) out.summaryHash = r.summary_hash as string;
  if (str(r.deleted_at)) out.deletedAt = r.deleted_at as string;
  return out;
}

export async function getActivityFull(
  db: D1Database,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<{ activity: Activity; extras: ActivityExtras } | null> {
  const row = await db
    .prepare(
      `SELECT ${ACTIVITY_COLUMNS}, laps, zones, peaks, strength_sets, thresholds_used, load_manual, upstream_title, summary_hash,
       deleted_at, pair_manual FROM activities WHERE id = ?${opts.includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    )
    .bind(id)
    .first<ActivityRow>();
  return row ? { activity: rowToActivity(row), extras: rowToExtras(row) } : null;
}

/** Completed load per local date over the whole history (fitness model input). One grouped query. */
export function dailyLoadsStmt(db: D1Database, q: { to?: LocalDate; sport?: Sport } = {}): D1PreparedStatement {
  const { sql, params } = where({ to: q.to, sport: q.sport });
  return db.prepare(`SELECT local_date AS date, SUM(load) AS load FROM activities WHERE ${sql} GROUP BY local_date`).bind(...params);
}

export async function dailyLoads(db: D1Database, q: { to?: LocalDate; sport?: Sport } = {}): Promise<Map<LocalDate, number>> {
  const { results } = await dailyLoadsStmt(db, q).all<{ date: string; load: number }>();
  return new Map(results.map((r) => [r.date, r.load ?? 0]));
}

/** Peaks JSON for analytics (trends/peaks), without loading streams. */
export async function listPeaks(
  db: D1Database,
  q: { from?: LocalDate; to?: LocalDate; sport?: Sport },
): Promise<Array<{ id: string; localDate: LocalDate; sport: Sport; subSport?: string; peaks: ActivityExtras['peaks'] }>> {
  const { sql, params } = where(q, ["peaks <> '{}'"]);
  const { results } = await db
    .prepare(`SELECT id, local_date, sport, sub_sport, peaks FROM activities WHERE ${sql} ORDER BY local_date`)
    .bind(...params)
    .all<{ id: string; local_date: string; sport: Sport; sub_sport: string | null; peaks: string }>();
  return results.map((r) => {
    const o: { id: string; localDate: LocalDate; sport: Sport; subSport?: string; peaks: ActivityExtras['peaks'] } = {
      id: r.id,
      localDate: r.local_date,
      sport: r.sport,
      peaks: parseJson(r.peaks, {}),
    };
    if (r.sub_sport) o.subSport = r.sub_sport;
    return o;
  });
}
