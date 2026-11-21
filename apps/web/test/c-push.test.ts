import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { addDays } from '@cadence/core/time';
import { STARTER_TEMPLATES, instantiateTemplate } from '@cadence/core/workout';
import type { PlannedWorkout } from '@cadence/core/domain';
import { api, json } from './helpers';
import { getWorkout, updateWorkouts } from '../worker/db/workouts';
import { createWorkout } from '../worker/services/planning';
import { DEMO_API_KEY, getDemoMock, setDemoConfig, setDemoNow, syncToday } from '../worker/services/garmin';
import { markWorkoutDirty, unpushWorkout } from '../worker/services/push';

const TODAY = '2026-11-20';
const NOW = Date.parse(`${TODAY}T08:00:00Z`);

async function mock() {
  return (await getDemoMock(env)).mock;
}

async function plan(date: string, key = 'run'): Promise<PlannedWorkout> {
  const t = STARTER_TEMPLATES.find((s) => s.sport === key)!;
  const f = instantiateTemplate(t, {});
  return createWorkout(env, { date, sport: f.sport, title: f.title, structure: f.structure, intensity: f.intensity, tags: f.tags });
}

async function edit(w: PlannedWorkout, patch: Partial<PlannedWorkout>): Promise<PlannedWorkout> {
  const next = { ...w, ...patch, updatedAt: new Date().toISOString() };
  await updateWorkouts(env.DB, [next]);
  await markWorkoutDirty(env, w.id);
  return (await getWorkout(env.DB, w.id))!;
}

describe('push planned workouts', () => {
  let today: string;
  let w: PlannedWorkout;
  let first: any;

  it('setup', async () => {
    await setDemoConfig(env, { seed: 2, athleteToday: TODAY, months: 1 });
    await setDemoNow(env, NOW);
    await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
    today = await syncToday(env);
    w = await plan(addDays(today, 1));
  });

  it('create + schedule, link and fingerprint recorded', async () => {
    first = await json(`/garmin/push/${w.id}`, { method: 'POST' });
    expect(first).toMatchObject({ syncState: 'synced' });
    expect(first.workoutId).toBeTruthy();
    expect(first.scheduleId).toBeTruthy();
    const m = await mock();
    expect(m.state.workouts.size).toBe(1);
    const sched = m.state.schedules.get(Number(first.scheduleId))!;
    expect(sched.calendarDate).toBe(w.date);
    const stored = await getWorkout(env.DB, w.id);
    expect(stored!.garmin).toMatchObject({ syncState: 'synced', workoutId: first.workoutId, scheduleId: first.scheduleId });
    const fp = await env.DB.prepare('SELECT garmin_fingerprint FROM workouts WHERE id = ?').bind(w.id).first<string>('garmin_fingerprint');
    expect(fp).toMatch(/^[0-9a-f]+$/);
    const log = await json('/sync/log?kind=push_workout');
    expect(log.entries[0]).toMatchObject({ status: 'ok' });
  });

  it('pushing unchanged content keeps the Garmin workout', async () => {
    const again = await json(`/garmin/push/${w.id}`, { method: 'POST' });
    expect(again.workoutId).toBe(first.workoutId);
    expect(again.scheduleId).toBe(first.scheduleId);
    expect((await mock()).state.workouts.size).toBe(1);
  });

  it('an edit marks it pending; the push replaces the Garmin workout (immutable) and removes the old one', async () => {
    const other = STARTER_TEMPLATES.filter((s) => s.sport === 'run')[1]!;
    w = await edit(w, { title: 'Edited run', structure: instantiateTemplate(other, {}).structure });
    expect(w.garmin.syncState).toBe('pending');
    const next = await json(`/garmin/push/${w.id}`, { method: 'POST' });
    expect(next.workoutId).not.toBe(first.workoutId);
    const m = await mock();
    expect([...m.state.workouts.keys()]).toEqual([Number(next.workoutId)]);
    expect([...m.state.schedules.values()].map((s) => [s.workoutId, s.calendarDate])).toEqual([[Number(next.workoutId), w.date]]);
    first = next;
  });

  it('moving the date reschedules without a new workout', async () => {
    w = await edit(w, { date: addDays(today, 2) });
    const moved = await json(`/garmin/push/${w.id}`, { method: 'POST' });
    expect(moved.workoutId).toBe(first.workoutId);
    expect(moved.scheduleId).not.toBe(first.scheduleId);
    const m = await mock();
    expect([...m.state.schedules.values()].map((s) => s.calendarDate)).toEqual([w.date]);
  });

  it('unpush unschedules + deletes on Garmin and resets the link', async () => {
    const res = await api(`/garmin/push/${w.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const m = await mock();
    expect(m.state.workouts.size).toBe(0);
    expect(m.state.schedules.size).toBe(0);
    expect((await getWorkout(env.DB, w.id))!.garmin).toEqual({ syncState: 'none' });
    await unpushWorkout(env, w.id); // idempotent
  });

  it('push-upcoming pushes only what needs it inside the auto-push window', async () => {
    const inWindow = await plan(addDays(today, 3), 'bike');
    const outside = await plan(addDays(today, 20), 'swim');
    const past = await plan(addDays(today, -2), 'run');
    const r = await json('/garmin/push-upcoming', { method: 'POST' });
    expect(r).toMatchObject({ pushed: 2, failed: 0 }); // w (unpushed, today+2) + inWindow
    expect((await getWorkout(env.DB, inWindow.id))!.garmin.syncState).toBe('synced');
    expect((await getWorkout(env.DB, outside.id))!.garmin.syncState).toBe('none');
    expect((await getWorkout(env.DB, past.id))!.garmin.syncState).toBe('none');
    const again = await json('/garmin/push-upcoming', { method: 'POST' });
    expect(again.pushed).toBe(0);
  });

  it('a skipped synced workout is removed from Garmin by the next push', async () => {
    const cur = (await getWorkout(env.DB, w.id))!;
    const before = (await mock()).state.workouts.size;
    await edit(cur, { status: 'skipped', skipReason: 'fatigue' });
    const r = await json('/garmin/push-upcoming', { method: 'POST' });
    expect(r.removed).toBe(1);
    expect((await mock()).state.workouts.size).toBe(before - 1);
    expect((await getWorkout(env.DB, w.id))!.garmin.syncState).toBe('none');
  });

  it('failures record state error with a message and are logged', async () => {
    const x = await plan(addDays(today, 4), 'bike');
    const m = await mock();
    m.setScenario('blocked');
    const res = await api(`/garmin/push/${x.id}`, { method: 'POST' });
    m.setScenario('ok');
    expect(res.status).toBe(503);
    expect((await res.json<any>()).error.code).toBe('garmin_blocked');
    const stored = (await getWorkout(env.DB, x.id))!;
    expect(stored.garmin.syncState).toBe('error');
    expect(stored.garmin.error).toBeTruthy();
    const log = await json('/sync/log?kind=push_workout');
    expect(log.entries[0]).toMatchObject({ status: 'error' });
    // retried by the next push
    expect((await json(`/garmin/push/${x.id}`, { method: 'POST' })).syncState).toBe('synced');
  });

  it('read-only connections cannot push', async () => {
    await api('/garmin/connect', { method: 'DELETE' });
    await json('/garmin/connect', { method: 'POST', body: { apiKey: DEMO_API_KEY, initialSync: false } });
    const x = await plan(addDays(today, 5), 'run');
    const res = await api(`/garmin/push/${x.id}`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error.code).toBe('garmin_write_unavailable');
    expect((await api('/garmin/push/wk_missing', { method: 'POST' })).status).toBe(404);
  });
});
