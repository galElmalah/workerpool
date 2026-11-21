/**
 * Planned ↔ completed pairing (product.md §3.6.1), built on core `pairActivities`.
 *
 * Invariants:
 *  - both sides are kept consistent (`workouts.paired_activity_id` ⇄ `activities.paired_workout_id`)
 *    and written in one `db.batch`;
 *  - manual pair/unpair sets `pair_manual = 1` on both rows; auto-pairing never touches those rows;
 *  - an auto-paired activity inherits `isKey` from its planned workout.
 */
import type { Activity, LocalDate, PlannedWorkout } from '@cadence/core/domain';
import { pairActivities } from '@cadence/core/workout';
import { listActivities } from '../db/activities';
import { chunk, parseJson, placeholders } from '../db/sql';
import { badRequest, notFound } from '../lib/http';

interface WorkoutPairRow {
  id: string;
  date: string;
  start_time: string | null;
  sport: PlannedWorkout['sport'];
  title: string;
  planned_duration_sec: number | null;
  planned_distance_m: number | null;
  tags: string;
  status: PlannedWorkout['status'];
  is_key: number;
  paired_activity_id: string | null;
  pair_manual: number;
}

const WORKOUT_PAIR_COLS =
  'id, date, start_time, sport, title, planned_duration_sec, planned_distance_m, tags, status, is_key, paired_activity_id, pair_manual';

/** Just enough of a PlannedWorkout for core pairing. */
function toPairable(r: WorkoutPairRow): PlannedWorkout {
  const w = {
    id: r.id,
    date: r.date,
    sport: r.sport,
    title: r.title,
    tags: parseJson<string[]>(r.tags, []),
    status: r.status,
    isKey: r.is_key === 1,
  } as PlannedWorkout;
  if (r.start_time) w.startTime = r.start_time;
  if (r.planned_duration_sec !== null) w.plannedDurationSec = r.planned_duration_sec;
  if (r.planned_distance_m !== null) w.plannedDistanceM = r.planned_distance_m;
  return w;
}

async function workoutsOn(db: D1Database, dates: LocalDate[]): Promise<WorkoutPairRow[]> {
  const out: WorkoutPairRow[] = [];
  for (const part of chunk(dates, 90)) {
    const { results } = await db
      .prepare(`SELECT ${WORKOUT_PAIR_COLS} FROM workouts WHERE date IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<WorkoutPairRow>();
    out.push(...results);
  }
  return out;
}

async function activityPairState(db: D1Database, ids: string[]): Promise<Map<string, { manual: boolean; isKey: boolean }>> {
  const out = new Map<string, { manual: boolean; isKey: boolean }>();
  for (const part of chunk(ids, 90)) {
    const { results } = await db
      .prepare(`SELECT id, pair_manual, is_key FROM activities WHERE id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ id: string; pair_manual: number; is_key: number }>();
    for (const r of results) out.set(r.id, { manual: r.pair_manual === 1, isKey: r.is_key === 1 });
  }
  return out;
}

/**
 * Re-run automatic pairing for the given local dates. Rows marked `pair_manual` (paired or
 * explicitly unpaired by the athlete) are left alone; every other pair on those dates is
 * re-evaluated from scratch. Returns the number of automatic pairs now present.
 */
export async function autoPairDates(env: Env, dates: LocalDate[]): Promise<number> {
  const db = env.DB;
  const uniq = [...new Set(dates)].sort();
  if (!uniq.length) return 0;
  const from = uniq[0];
  const to = uniq[uniq.length - 1];
  const [wRows, actsInRange] = await Promise.all([workoutsOn(db, uniq), listActivities(db, { from, to })]);
  const dateSet = new Set(uniq);
  const acts = actsInRange.filter((a) => dateSet.has(a.localDate));
  if (!acts.length && !wRows.some((w) => w.paired_activity_id)) return 0;
  const state = await activityPairState(db, acts.map((a) => a.id));

  const autoW = wRows.filter((w) => w.pair_manual !== 1);
  const autoA = acts.filter((a) => !state.get(a.id)?.manual);
  const planned = autoW.map(toPairable);
  const activities: Activity[] = autoA.map((a) => ({ ...a, pairedWorkoutId: undefined }));
  const result = pairActivities(planned, activities, { manualPlannedIds: [] });

  const wantW = new Map<string, string | null>(autoW.map((w) => [w.id, null]));
  const wantA = new Map<string, string | null>(autoA.map((a) => [a.id, null]));
  for (const p of result.pairs) {
    wantW.set(p.plannedId, p.activityId);
    wantA.set(p.activityId, p.plannedId);
  }
  const keyOf = new Map(autoW.map((w) => [w.id, w.is_key === 1]));
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const w of autoW) {
    const want = wantW.get(w.id) ?? null;
    if (want !== w.paired_activity_id) {
      stmts.push(db.prepare('UPDATE workouts SET paired_activity_id = ?, updated_at = ? WHERE id = ? AND pair_manual = 0').bind(want, now, w.id));
    }
  }
  for (const a of autoA) {
    const want = wantA.get(a.id) ?? null;
    const inheritKey = want !== null && keyOf.get(want) === true && !state.get(a.id)?.isKey;
    if (want !== (a.pairedWorkoutId ?? null) || inheritKey) {
      stmts.push(
        db
          .prepare(`UPDATE activities SET paired_workout_id = ?${inheritKey ? ', is_key = 1' : ''}, updated_at = ? WHERE id = ? AND pair_manual = 0`)
          .bind(want, now, a.id),
      );
    }
  }
  // An auto-paired activity's previous workout outside these dates (only possible after a date change).
  for (const a of autoA) {
    const prev = a.pairedWorkoutId;
    if (prev && !wantW.has(prev)) {
      stmts.push(db.prepare('UPDATE workouts SET paired_activity_id = NULL WHERE id = ? AND paired_activity_id = ? AND pair_manual = 0').bind(prev, a.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return result.pairs.length;
}

/** Pair a planned workout with an activity (any dates). Both rows become manual. */
export async function pairManually(env: Env, workoutId: string, activityId: string): Promise<void> {
  const db = env.DB;
  const [w, a] = await Promise.all([
    db.prepare('SELECT id, date, is_key, paired_activity_id FROM workouts WHERE id = ?').bind(workoutId).first<{ id: string; date: string; is_key: number; paired_activity_id: string | null }>(),
    db
      .prepare('SELECT id, local_date, paired_workout_id, deleted_at FROM activities WHERE id = ?')
      .bind(activityId)
      .first<{ id: string; local_date: string; paired_workout_id: string | null; deleted_at: string | null }>(),
  ]);
  if (!w) throw notFound('Workout');
  if (!a || a.deleted_at) throw notFound('Activity');
  const now = new Date().toISOString();
  const released: LocalDate[] = [];
  const stmts: D1PreparedStatement[] = [];
  if (w.paired_activity_id && w.paired_activity_id !== activityId) {
    // The workout's previous activity becomes free (and eligible for auto-pairing again).
    stmts.push(db.prepare('UPDATE activities SET paired_workout_id = NULL, pair_manual = 0, updated_at = ? WHERE id = ?').bind(now, w.paired_activity_id));
    const prev = await db.prepare('SELECT local_date FROM activities WHERE id = ?').bind(w.paired_activity_id).first<{ local_date: string }>();
    if (prev) released.push(prev.local_date);
  }
  if (a.paired_workout_id && a.paired_workout_id !== workoutId) {
    stmts.push(db.prepare('UPDATE workouts SET paired_activity_id = NULL, pair_manual = 0, updated_at = ? WHERE id = ?').bind(now, a.paired_workout_id));
    const prev = await db.prepare('SELECT date FROM workouts WHERE id = ?').bind(a.paired_workout_id).first<{ date: string }>();
    if (prev) released.push(prev.date);
  }
  stmts.push(
    db.prepare('UPDATE workouts SET paired_activity_id = ?, pair_manual = 1, updated_at = ? WHERE id = ?').bind(activityId, now, workoutId),
    db
      .prepare(`UPDATE activities SET paired_workout_id = ?, pair_manual = 1${w.is_key === 1 ? ', is_key = 1' : ''}, updated_at = ? WHERE id = ?`)
      .bind(workoutId, now, activityId),
  );
  await db.batch(stmts);
  if (released.length) await autoPairDates(env, released);
}

/** Unpair a planned workout. Both sides become manual so auto-pairing leaves them apart. */
export async function unpair(env: Env, workoutId: string): Promise<void> {
  const db = env.DB;
  const w = await db.prepare('SELECT id, paired_activity_id FROM workouts WHERE id = ?').bind(workoutId).first<{ id: string; paired_activity_id: string | null }>();
  if (!w) throw notFound('Workout');
  const now = new Date().toISOString();
  const stmts = [db.prepare('UPDATE workouts SET paired_activity_id = NULL, pair_manual = 1, updated_at = ? WHERE id = ?').bind(now, workoutId)];
  if (w.paired_activity_id) {
    stmts.push(db.prepare('UPDATE activities SET paired_workout_id = NULL, pair_manual = 1, updated_at = ? WHERE id = ?').bind(now, w.paired_activity_id));
  }
  // Also clear any activity still pointing at this workout (defensive: keeps both sides consistent).
  stmts.push(db.prepare('UPDATE activities SET paired_workout_id = NULL, pair_manual = 1, updated_at = ? WHERE paired_workout_id = ?').bind(now, workoutId));
  await db.batch(stmts);
}

/** Unpair from the activity side (activity page "Unpair"). */
export async function unpairActivity(env: Env, activityId: string): Promise<void> {
  const a = await env.DB.prepare('SELECT paired_workout_id FROM activities WHERE id = ?').bind(activityId).first<{ paired_workout_id: string | null }>();
  if (!a) throw notFound('Activity');
  if (!a.paired_workout_id) throw badRequest('Activity is not paired', 'not_paired');
  await unpair(env, a.paired_workout_id);
}
