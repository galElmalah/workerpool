/**
 * Planned workouts repository. Objects are returned WITHOUT `compliance`
 * (services/compliance.withCompliance decorates them on read).
 */
import type { GarminLink, LocalDate, PlannedWorkout, WorkoutStructure } from '@cadence/core/domain';
import { all, bindValue, chunk, compact, first, parseJson, placeholders, run } from './sql';

export interface WorkoutRow {
  id: string;
  date: string;
  start_time: string | null;
  sport: string;
  sub_sport: string | null;
  title: string;
  description: string | null;
  pre_note: string | null;
  planned_duration_sec: number | null;
  planned_distance_m: number | null;
  planned_load: number | null;
  planned_if: number | null;
  structure: string | null;
  sparkline: string | null;
  is_key: number;
  intensity: string;
  tags: string;
  environment: string;
  template_id: string | null;
  series_id: string | null;
  event_id: string | null;
  paired_activity_id: string | null;
  pair_manual: number;
  status: string;
  skip_reason: string | null;
  garmin_workout_id: string | null;
  garmin_schedule_id: string | null;
  garmin_sync_state: string;
  garmin_pushed_at: string | null;
  garmin_error: string | null;
  garmin_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

export function workoutFromRow(r: WorkoutRow): PlannedWorkout {
  const garmin = compact({
    workoutId: r.garmin_workout_id ?? undefined,
    scheduleId: r.garmin_schedule_id ?? undefined,
    syncState: (r.garmin_sync_state || 'none') as GarminLink['syncState'],
    lastPushedAt: r.garmin_pushed_at ?? undefined,
    error: r.garmin_error ?? undefined,
  }) as GarminLink;
  const structure = r.structure ? parseJson<WorkoutStructure | null>(r.structure, null) : null;
  const sparkline = r.sparkline ? parseJson<number[] | null>(r.sparkline, null) : null;
  return compact({
    id: r.id,
    date: r.date,
    startTime: r.start_time ?? undefined,
    sport: r.sport,
    subSport: r.sub_sport ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    preNote: r.pre_note ?? undefined,
    plannedDurationSec: r.planned_duration_sec ?? undefined,
    plannedDistanceM: r.planned_distance_m ?? undefined,
    plannedLoad: r.planned_load ?? undefined,
    plannedIntensityFactor: r.planned_if ?? undefined,
    structure: structure ?? undefined,
    isKey: !!r.is_key,
    intensity: r.intensity,
    tags: parseJson<string[]>(r.tags, []),
    environment: r.environment,
    templateId: r.template_id ?? undefined,
    seriesId: r.series_id ?? undefined,
    eventId: r.event_id ?? undefined,
    pairedActivityId: r.paired_activity_id ?? undefined,
    status: r.status,
    skipReason: r.skip_reason ?? undefined,
    sparkline: sparkline ?? undefined,
    garmin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as Record<string, unknown>) as unknown as PlannedWorkout;
}

/** Column → value for an insert/replace (pair_manual and fingerprint are left to their owners). */
function rowValues(w: PlannedWorkout): Record<string, unknown> {
  return {
    id: w.id,
    date: w.date,
    start_time: w.startTime,
    sport: w.sport,
    sub_sport: w.subSport,
    title: w.title,
    description: w.description,
    pre_note: w.preNote,
    planned_duration_sec: w.plannedDurationSec,
    planned_distance_m: w.plannedDistanceM,
    planned_load: w.plannedLoad,
    planned_if: w.plannedIntensityFactor,
    structure: w.structure,
    sparkline: w.sparkline,
    is_key: w.isKey,
    intensity: w.intensity,
    tags: w.tags ?? [],
    environment: w.environment ?? 'any',
    template_id: w.templateId,
    series_id: w.seriesId,
    event_id: w.eventId,
    paired_activity_id: w.pairedActivityId,
    status: w.status ?? 'planned',
    skip_reason: w.skipReason,
    garmin_workout_id: w.garmin?.workoutId,
    garmin_schedule_id: w.garmin?.scheduleId,
    garmin_sync_state: w.garmin?.syncState ?? 'none',
    garmin_pushed_at: w.garmin?.lastPushedAt,
    garmin_error: w.garmin?.error,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

const INSERT_COLS = Object.keys(
  rowValues({
    id: '',
    date: '',
    sport: 'bike',
    title: '',
    isKey: false,
    intensity: 'endurance',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: '',
    updatedAt: '',
  }),
);

function insertStatement(db: D1Database, w: PlannedWorkout): D1PreparedStatement {
  const v = rowValues(w);
  return db
    .prepare(`INSERT OR REPLACE INTO workouts (${INSERT_COLS.join(', ')}) VALUES (${placeholders(INSERT_COLS.length)})`)
    .bind(...INSERT_COLS.map((c) => bindValue(v[c])));
}

/** Content columns written by an update (Garmin link columns are only touched by updateGarminLink / markDirty). */
const UPDATE_COLS = INSERT_COLS.filter((c) => c !== 'id' && c !== 'created_at' && !c.startsWith('garmin_'));

function updateStatement(db: D1Database, w: PlannedWorkout): D1PreparedStatement {
  const v = rowValues(w);
  return db
    .prepare(`UPDATE workouts SET ${UPDATE_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...UPDATE_COLS.map((c) => bindValue(v[c])), w.id);
}

export async function listWorkouts(db: D1Database, q: { from?: LocalDate; to?: LocalDate; ids?: string[] }): Promise<PlannedWorkout[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.from) {
    where.push('date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('date <= ?');
    params.push(q.to);
  }
  const order = ' ORDER BY date, start_time IS NULL, start_time, created_at, id';
  if (q.ids) {
    if (!q.ids.length) return [];
    const out: PlannedWorkout[] = [];
    for (const ids of chunk([...new Set(q.ids)], 90)) {
      const sql = `SELECT * FROM workouts WHERE ${[...where, `id IN (${placeholders(ids.length)})`].join(' AND ')}`;
      out.push(...(await all<WorkoutRow>(db, sql, ...params, ...ids)).map(workoutFromRow));
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startTime ?? '~').localeCompare(b.startTime ?? '~')));
  }
  const sql = `SELECT * FROM workouts${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${order}`;
  return (await all<WorkoutRow>(db, sql, ...params)).map(workoutFromRow);
}

export async function getWorkout(db: D1Database, id: string): Promise<PlannedWorkout | null> {
  const r = await first<WorkoutRow>(db, 'SELECT * FROM workouts WHERE id = ?', id);
  return r ? workoutFromRow(r) : null;
}

/** Insert (or replace) verbatim, ids included. One statement per row (31 params), batched. */
export async function insertWorkouts(db: D1Database, workouts: PlannedWorkout[]): Promise<void> {
  for (const part of chunk(workouts, 50)) {
    if (part.length) await db.batch(part.map((w) => insertStatement(db, w)));
  }
}

/** Write the content columns of existing workouts (not the Garmin link). */
export async function updateWorkouts(db: D1Database, workouts: PlannedWorkout[]): Promise<void> {
  for (const part of chunk(workouts, 50)) {
    if (part.length) await db.batch(part.map((w) => updateStatement(db, w)));
  }
}

export async function deleteWorkouts(db: D1Database, ids: string[]): Promise<void> {
  for (const part of chunk([...new Set(ids)], 90)) {
    if (part.length) await run(db, `DELETE FROM workouts WHERE id IN (${placeholders(part.length)})`, ...part);
  }
}

export async function updateGarminLink(db: D1Database, id: string, link: GarminLink & { fingerprint?: string }): Promise<void> {
  const sets = [
    'garmin_workout_id = ?',
    'garmin_schedule_id = ?',
    'garmin_sync_state = ?',
    'garmin_pushed_at = ?',
    'garmin_error = ?',
  ];
  const params: unknown[] = [link.workoutId ?? null, link.scheduleId ?? null, link.syncState, link.lastPushedAt ?? null, link.error ?? null];
  if (link.fingerprint !== undefined) {
    sets.push('garmin_fingerprint = ?');
    params.push(link.fingerprint);
  }
  await run(db, `UPDATE workouts SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
}

/** Members of a series dated on/after `from` (inclusive). */
export async function listSeries(db: D1Database, seriesId: string, from?: LocalDate): Promise<PlannedWorkout[]> {
  const rows = from
    ? await all<WorkoutRow>(db, 'SELECT * FROM workouts WHERE series_id = ? AND date >= ? ORDER BY date, id', seriesId, from)
    : await all<WorkoutRow>(db, 'SELECT * FROM workouts WHERE series_id = ? ORDER BY date, id', seriesId);
  return rows.map(workoutFromRow);
}

/** True when the workout has been pushed to Garmin. */
export const isOnGarmin = (w: PlannedWorkout): boolean =>
  !!(w.garmin.workoutId || w.garmin.scheduleId) || w.garmin.syncState === 'synced';
