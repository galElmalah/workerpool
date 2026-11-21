import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import type { LocalDate, PlannedWorkout, Sport } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { ingestActivity } from '../worker/services/ingest';
import { autoPairDates, pairManually, unpair } from '../worker/services/pairing';
import { withCompliance } from '../worker/services/compliance';
import { insertWorkouts, listWorkouts } from '../worker/db/workouts';
import { insertMarkers } from '../worker/db/furniture';
import { getActivity } from '../worker/db/activities';
import { getToday } from '../worker/services/context';
import { api, json } from './helpers';

let n = 0;
function wk(date: LocalDate, sport: Sport, p: Partial<PlannedWorkout> = {}): PlannedWorkout {
  const now = new Date().toISOString();
  return {
    id: `wk_p${++n}`,
    date,
    sport,
    title: `${sport} plan ${n}`,
    isKey: false,
    intensity: 'endurance',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

async function act(date: LocalDate, sport: Sport, movingSec: number, hour = 7, extra: Record<string, unknown> = {}) {
  const startedAt = `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const res = await ingestActivity(env, {
    source: 'demo',
    summary: { startedAt, utcOffsetMin: 0, localDate: date, sport, title: `${sport} ${date} ${hour}`, durationSec: movingSec + 60, movingSec, ...extra },
  });
  expect(res.outcome).toBe('created');
  return res;
}

async function workout(id: string): Promise<PlannedWorkout> {
  const [w] = await listWorkouts(env.DB, { ids: [id] });
  return (await withCompliance(env, [w]))[0];
}

let today: LocalDate;

beforeAll(async () => {
  today = await getToday(env);
});

describe('pairing & compliance', () => {
  it('pairs on target and short sessions and keeps both sides consistent', async () => {
    const d = addDays(today, -3);
    const run = wk(d, 'run', { plannedDurationSec: 3600, startTime: '07:00', isKey: true });
    const bike = wk(d, 'bike', { plannedDurationSec: 7200 });
    await insertWorkouts(env.DB, [run, bike]);
    const r1 = await act(d, 'run', 3480, 7);
    const r2 = await act(d, 'bike', 4200, 12);
    expect(r1.pairedWorkoutId).toBe(run.id);
    expect(r2.pairedWorkoutId).toBe(bike.id);
    const wRun = await workout(run.id);
    expect(wRun.pairedActivityId).toBe(r1.activityId);
    expect(wRun.compliance).toEqual({ metric: 'duration', ratio: 0.97, state: 'on_target' });
    expect((await workout(bike.id)).compliance).toMatchObject({ ratio: 0.58, state: 'partial_short' });
    const a = await json(`/activities/${r1.activityId}`);
    expect(a.pairedWorkoutId).toBe(run.id);
    expect(a.isKey).toBe(true); // inherited from the key workout
    expect(a.compliance.state).toBe('on_target');
    expect(a.plannedWorkout.id).toBe(run.id);
  });

  it('marks missed, excused (sick marker / skipped) and planned workouts', async () => {
    const missed = wk(addDays(today, -2), 'swim', { plannedDurationSec: 1800 });
    const sick = wk(addDays(today, -1), 'run', { plannedDurationSec: 2400 });
    const skipped = wk(addDays(today, -2), 'row', { plannedDurationSec: 1800, status: 'skipped', skipReason: 'fatigue' });
    const future = wk(addDays(today, 1), 'run', { plannedDurationSec: 2400 });
    const todays = wk(today, 'strength', { plannedDurationSec: 2400 });
    await insertWorkouts(env.DB, [missed, sick, skipped, future, todays]);
    await insertMarkers(env.DB, [{ id: 'mk_sick1', type: 'sick', date: addDays(today, -1) }]);
    expect((await workout(missed.id)).compliance?.state).toBe('missed');
    expect((await workout(sick.id)).compliance?.state).toBe('excused');
    expect((await workout(skipped.id)).compliance?.state).toBe('excused');
    expect((await workout(future.id)).compliance?.state).toBe('planned');
    expect((await workout(todays.id)).compliance?.state).toBe('planned');
  });

  it('never pairs other-sport or skipped workouts and flags unplanned activities', async () => {
    const d = addDays(today, -5);
    const other = wk(d, 'other', { plannedDurationSec: 3600 });
    await insertWorkouts(env.DB, [other]);
    const res = await act(d, 'other', 3600);
    expect(res.pairedWorkoutId).toBeUndefined();
    expect((await json(`/activities/${res.activityId}`)).compliance.state).toBe('unplanned');
  });

  it('keeps manual pairs when auto-pairing re-runs, and respects unpair', async () => {
    const d = addDays(today, -4);
    const plan = wk(d, 'run', { plannedDurationSec: 3600 });
    await insertWorkouts(env.DB, [plan]);
    const a1 = await act(d, 'run', 3600, 7);
    const a2 = await act(d, 'run', 1500, 18);
    expect(a1.pairedWorkoutId).toBe(plan.id);
    await pairManually(env, plan.id, a2.activityId);
    expect((await workout(plan.id)).pairedActivityId).toBe(a2.activityId);
    expect((await getActivity(env.DB, a1.activityId))!.pairedWorkoutId).toBeUndefined();
    // Another activity that day re-runs auto pairing: the manual pair stands.
    await act(d, 'run', 3550, 12);
    await autoPairDates(env, [d]);
    const w = await workout(plan.id);
    expect(w.pairedActivityId).toBe(a2.activityId);
    expect(w.compliance?.state).toBe('off_short');
    expect((await getActivity(env.DB, a2.activityId))!.pairedWorkoutId).toBe(plan.id);
    // Unpair: both sides manual, auto-pairing does not re-pair the workout.
    await unpair(env, plan.id);
    await autoPairDates(env, [d]);
    const after = await workout(plan.id);
    expect(after.pairedActivityId).toBeUndefined();
    expect(after.compliance?.state).toBe('missed');
    expect((await getActivity(env.DB, a2.activityId))!.pairedWorkoutId).toBeUndefined();
  });

  it('releases the workout when its activity is deleted and re-pairs on restore', async () => {
    const d = addDays(today, -6);
    const plan = wk(d, 'bike', { plannedDurationSec: 3600, plannedLoad: 60 });
    await insertWorkouts(env.DB, [plan]);
    const a = await act(d, 'bike', 3700);
    expect(a.pairedWorkoutId).toBe(plan.id);
    expect((await api(`/activities/${a.activityId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await workout(plan.id)).compliance?.state).toBe('missed');
    await json(`/activities/${a.activityId}/restore`, { method: 'POST' });
    const w = await workout(plan.id);
    expect(w.pairedActivityId).toBe(a.activityId);
    expect(w.compliance?.metric).toBe('load');
  });

  it('re-pairs when the sport of an activity is corrected', async () => {
    const d = addDays(today, -7);
    const plan = wk(d, 'row', { plannedDurationSec: 2400 });
    await insertWorkouts(env.DB, [plan]);
    const a = await act(d, 'other', 2400);
    expect(a.pairedWorkoutId).toBeUndefined();
    const patched = await json(`/activities/${a.activityId}`, { method: 'PATCH', body: { sport: 'row' } });
    expect(patched.sport).toBe('row');
    expect(patched.pairedWorkoutId).toBe(plan.id);
  });
});
