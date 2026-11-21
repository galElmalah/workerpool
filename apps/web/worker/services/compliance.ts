/**
 * Compliance decoration (product.md §3.6.3) on read: planned workouts get `compliance` from their
 * paired activity, today and day markers (missed / excused); activities get the compliance of
 * their pair, or `unplanned`.
 */
import type { Activity, DayMarker, LocalDate, PlannedWorkout } from '@cadence/core/domain';
import { computeCompliance, unplannedCompliance } from '@cadence/core/workout';
import { listActivities } from '../db/activities';
import { listMarkers } from '../db/furniture';
import { getToday } from './context';

/** Pure: decorate planned workouts given everything needed. */
export function decorateWorkouts(
  workouts: readonly PlannedWorkout[],
  activities: readonly Activity[],
  markers: readonly DayMarker[],
  today: LocalDate,
): PlannedWorkout[] {
  const byId = new Map(activities.map((a) => [a.id, a] as const));
  const byWorkout = new Map<string, Activity>();
  for (const a of activities) if (a.pairedWorkoutId) byWorkout.set(a.pairedWorkoutId, a);
  return workouts.map((w) => {
    const a = (w.pairedActivityId ? byId.get(w.pairedActivityId) : undefined) ?? byWorkout.get(w.id);
    return { ...w, compliance: computeCompliance(w, a, { today, markers }) };
  });
}

/**
 * Pure: decorate activities. A paired activity carries its planned workout's compliance; an
 * activity whose pair is unknown/missing is `unplanned` (and loses the dangling id).
 */
export function decorateActivities(
  activities: readonly Activity[],
  workouts: readonly PlannedWorkout[],
  markers: readonly DayMarker[],
  today: LocalDate,
): Activity[] {
  const byId = new Map(workouts.map((w) => [w.id, w] as const));
  return activities.map((a) => {
    const w = a.pairedWorkoutId ? byId.get(a.pairedWorkoutId) : undefined;
    if (!w) {
      const { pairedWorkoutId: _drop, ...rest } = a;
      return { ...rest, compliance: unplannedCompliance() };
    }
    return { ...a, compliance: w.compliance ?? computeCompliance(w, a, { today, markers }) };
  });
}

function dateRange(dates: LocalDate[]): { from: LocalDate; to: LocalDate } | null {
  if (!dates.length) return null;
  const s = [...dates].sort();
  return { from: s[0], to: s[s.length - 1] };
}

/** Adds `compliance` to planned workouts (fetches paired activities / markers when not given). */
export async function withCompliance(env: Env, workouts: PlannedWorkout[], activities?: Activity[]): Promise<PlannedWorkout[]> {
  if (!workouts.length) return [];
  const db = env.DB;
  const range = dateRange(workouts.map((w) => w.date))!;
  const known = new Set((activities ?? []).map((a) => a.id));
  const missing = workouts.map((w) => w.pairedActivityId).filter((id): id is string => !!id && !known.has(id));
  const [today, markers, extra] = await Promise.all([
    getToday(env),
    listMarkers(db, range),
    missing.length ? listActivities(db, { ids: missing }) : Promise.resolve([] as Activity[]),
  ]);
  return decorateWorkouts(workouts, [...(activities ?? []), ...extra], markers, today);
}
