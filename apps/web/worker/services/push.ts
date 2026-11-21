/**
 * Planned workout → Garmin calendar (create-or-replace + schedule; garmin.md §5.4).
 * Garmin workouts are treated as immutable by `pushPlannedWorkout`; this module resolves the
 * thresholds effective on the workout date, records the resulting link (+ fingerprint) and logs.
 */
import type { GarminLink, LocalDate, PlannedWorkout } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import {
  buildWorkoutDictionary,
  needsPush,
  pushPlannedWorkout,
  removePlannedWorkout,
  toGarminWorkout,
  workoutFingerprint,
  type GarminClient,
} from '@cadence/garmin';
import { getSettings } from '../db/settings';
import { logSync } from '../db/sync';
import { thresholdsOn } from '../db/thresholds';
import { getWorkout, listWorkouts, updateGarminLink } from '../db/workouts';
import { ApiError, notFound } from '../lib/http';
import { errorMessage, getGarminClient, syncNow, syncToday, toApiError } from './garmin';

async function requireWriteClient(env: Env): Promise<GarminClient> {
  const client = await getGarminClient(env);
  if (!client) throw new ApiError(409, 'garmin_not_connected', 'Connect Garmin first (Settings → Garmin).');
  if (!(await client.capabilities()).write) {
    throw new ApiError(409, 'garmin_write_unavailable', 'Pushing workouts needs a Garmin Connect token (garmin_tokens.json).');
  }
  return client;
}

/** Push one workout with an existing client (no logging of success; errors are recorded and rethrown). */
export async function pushWithClient(env: Env, client: GarminClient, w: PlannedWorkout, now?: Date): Promise<GarminLink> {
  const at = now ?? (await syncNow(env));
  try {
    const thresholds = await thresholdsOn(env.DB, w.date, w.sport);
    const result = await pushPlannedWorkout(client, w, thresholds, w.garmin, { now: at });
    // The push already loaded the type dictionary (cached on the client) → no extra request.
    let fingerprint: string | undefined;
    if (result.syncState === 'synced') {
      const dictionary = buildWorkoutDictionary(await client.getWorkoutTypes());
      fingerprint = workoutFingerprint(toGarminWorkout(w, thresholds, { dictionary }));
    }
    // Stamp after the round trips so lastPushedAt ≥ any concurrent updatedAt we saw.
    const link: GarminLink = { ...result, lastPushedAt: new Date(Math.max(at.getTime(), Date.now())).toISOString() };
    await updateGarminLink(env.DB, w.id, fingerprint ? { ...link, fingerprint } : link);
    return link;
  } catch (e) {
    const message = errorMessage(e);
    await updateGarminLink(env.DB, w.id, { ...w.garmin, syncState: 'error', error: message.slice(0, 500) });
    await logSync(env.DB, { kind: 'push_workout', status: 'error', summary: `Push failed: ${w.title} (${w.date})`, detail: message });
    throw toApiError(e);
  }
}

/** Create-or-replace + schedule on Garmin; records the link and a sync_log entry. */
export async function pushWorkout(env: Env, workoutId: string): Promise<GarminLink> {
  const started = Date.now();
  const w = await getWorkout(env.DB, workoutId);
  if (!w) throw notFound('Workout');
  const client = await requireWriteClient(env);
  const link = await pushWithClient(env, client, w);
  await logSync(env.DB, {
    kind: 'push_workout',
    status: 'ok',
    summary: w.status === 'skipped' ? `Removed skipped “${w.title}” (${w.date}) from Garmin` : `Pushed “${w.title}” (${w.date})`,
    durationMs: Date.now() - started,
  });
  return link;
}

/** Unschedule + delete on Garmin and reset the link. Safe when never pushed or not connected. */
export async function unpushWorkout(env: Env, workoutId: string): Promise<void> {
  const w = await getWorkout(env.DB, workoutId);
  if (!w) throw notFound('Workout');
  const hasRemote = !!(w.garmin.workoutId || w.garmin.scheduleId);
  if (hasRemote) {
    const client = await getGarminClient(env);
    if (client && (await client.capabilities()).write) {
      try {
        await removePlannedWorkout(client, w.garmin);
      } catch (e) {
        await logSync(env.DB, { kind: 'push_workout', status: 'error', summary: `Removing “${w.title}” from Garmin failed`, detail: errorMessage(e) });
        throw toApiError(e);
      }
      await logSync(env.DB, { kind: 'push_workout', status: 'ok', summary: `Removed “${w.title}” (${w.date}) from Garmin` });
    }
  }
  if (hasRemote || w.garmin.syncState !== 'none') await updateGarminLink(env.DB, w.id, { syncState: 'none' });
}

/** A planned workout changed (edit / move / skip): a synced one becomes `pending` (re-pushed by cron). */
export async function markWorkoutDirty(env: Env, workoutId: string): Promise<void> {
  const w = await getWorkout(env.DB, workoutId);
  if (!w || w.garmin.syncState !== 'synced') return;
  await updateGarminLink(env.DB, w.id, { ...w.garmin, syncState: 'pending' });
}

/** Workouts in the auto-push window that need a (re)push. */
export async function workoutsToPush(env: Env, today: LocalDate, days: number): Promise<PlannedWorkout[]> {
  const list = await listWorkouts(env.DB, { from: today, to: addDays(today, days) });
  return list.filter((w) => needsPush(w, today, days));
}

export interface PushBatchResult {
  pushed: number;
  removed: number;
  failed: number;
  /** Still pending because the request budget ran out. */
  remaining: number;
  errors: { workoutId: string; message: string }[];
}

/**
 * Push everything pending in `settings.garminAutoPushDays`, stopping when `budget()` says no more
 * requests may be spent. Failures are recorded per workout and do not stop the batch.
 */
export async function pushPending(
  env: Env,
  client: GarminClient,
  opts: { budget?: () => boolean; now?: Date; today?: LocalDate } = {},
): Promise<PushBatchResult> {
  const out: PushBatchResult = { pushed: 0, removed: 0, failed: 0, remaining: 0, errors: [] };
  if (!(await client.capabilities()).write) return out;
  const settings = await getSettings(env.DB);
  const today = opts.today ?? (await syncToday(env));
  const todo = await workoutsToPush(env, today, settings.garminAutoPushDays);
  for (const [i, w] of todo.entries()) {
    if (opts.budget && !opts.budget()) {
      out.remaining = todo.length - i;
      break;
    }
    try {
      await pushWithClient(env, client, w, opts.now);
      if (w.status === 'skipped') out.removed++;
      else out.pushed++;
    } catch (e) {
      out.failed++;
      out.errors.push({ workoutId: w.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** `POST /garmin/push-upcoming`: push all pending in the window now. */
export async function pushUpcoming(env: Env): Promise<PushBatchResult> {
  const started = Date.now();
  const client = await requireWriteClient(env);
  const res = await pushPending(env, client);
  const parts = [`pushed ${res.pushed} workout${res.pushed === 1 ? '' : 's'}`];
  if (res.removed) parts.push(`removed ${res.removed}`);
  if (res.failed) parts.push(`${res.failed} failed`);
  await logSync(env.DB, {
    kind: 'push_workout',
    status: res.failed ? 'error' : 'ok',
    summary: cap(parts.join(', ')),
    ...(res.errors.length ? { detail: res.errors.map((e) => `${e.workoutId}: ${e.message}`).join('\n') } : {}),
    durationMs: Date.now() - started,
  });
  return res;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
