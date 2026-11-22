/**
 * Integration: planning changes re-run auto-pairing for the affected dates (old and new date on
 * moves); manual pairs are never touched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import type { LocalDate } from '@cadence/core/domain';
import { addDays, weekStart } from '@cadence/core/time';
import { getToday } from '../worker/services/context';
import { api, json } from './helpers';

let today: LocalDate;

beforeAll(async () => {
  today = await getToday(env);
});

/** A completed run on `date` (manual entry → ingest pipeline). */
async function run(date: LocalDate, durationSec = 3600, startTime = '07:00', sport = 'run'): Promise<string> {
  const a = await json('/activities/manual', { method: 'POST', body: { localDate: date, startTime, sport, title: `${sport} ${date}`, durationSec } });
  return a.id;
}

async function pairOf(activityId: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT paired_workout_id FROM activities WHERE id = ?').bind(activityId).first<string | null>('paired_workout_id')) ?? null;
}

async function workoutPair(id: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT paired_activity_id FROM workouts WHERE id = ?').bind(id).first<string | null>('paired_activity_id')) ?? null;
}

const plan = (date: LocalDate, extra: Record<string, unknown> = {}) =>
  json('/workouts', { method: 'POST', body: { date, sport: 'run', title: 'Easy run', plannedDurationSec: 3600, startTime: '07:00', ...extra } });

describe('re-pairing after planning changes', () => {
  it('create: a workout planned after the activity pairs immediately (response included)', async () => {
    const d = addDays(today, -10);
    const a = await run(d);
    expect(await pairOf(a)).toBeNull();
    const w = await plan(d);
    expect(w.pairedActivityId).toBe(a);
    expect(w.compliance.state).not.toBe('missed');
    expect(await pairOf(a)).toBe(w.id);
    const act = await json(`/activities/${a}`);
    expect(act.pairedWorkoutId).toBe(w.id);
  });

  it('skip releases the activity (unplanned), unskip pairs it again', async () => {
    const d = addDays(today, -11);
    const a = await run(d);
    const w = await plan(d);
    expect(await pairOf(a)).toBe(w.id);
    const skipped = await json(`/workouts/${w.id}/skip`, { method: 'POST', body: { reason: 'fatigue' } });
    expect(skipped.pairedActivityId).toBeUndefined();
    expect(await pairOf(a)).toBeNull();
    expect((await json(`/activities/${a}`)).compliance.state).toBe('unplanned');
    const back = await json(`/workouts/${w.id}/skip`, { method: 'DELETE' });
    expect(back.pairedActivityId).toBe(a);
    expect(await pairOf(a)).toBe(w.id);
  });

  it('PATCH date moves the pair: the old day is released, the new day pairs', async () => {
    const d1 = addDays(today, -12);
    const d2 = addDays(today, -13);
    const a1 = await run(d1);
    const a2 = await run(d2);
    const w = await plan(d1);
    expect(await pairOf(a1)).toBe(w.id);
    const moved = await json(`/workouts/${w.id}`, { method: 'PATCH', body: { date: d2 } });
    expect(moved.date).toBe(d2);
    expect(moved.pairedActivityId).toBe(a2);
    expect(await pairOf(a1)).toBeNull();
    expect(await pairOf(a2)).toBe(w.id);
  });

  it('PATCH sport to an incompatible sport releases the activity', async () => {
    const d = addDays(today, -14);
    const a = await run(d);
    const w = await plan(d);
    expect(await pairOf(a)).toBe(w.id);
    await json(`/workouts/${w.id}`, { method: 'PATCH', body: { sport: 'swim' } });
    expect(await pairOf(a)).toBeNull();
    expect(await workoutPair(w.id)).toBeNull();
  });

  it('delete releases the activity; restore (undo) pairs it again', async () => {
    const d = addDays(today, -15);
    const a = await run(d);
    const w = await plan(d);
    const del = await json(`/workouts/${w.id}`, { method: 'DELETE' });
    expect(await pairOf(a)).toBeNull();
    expect((await json(`/activities/${a}`)).compliance.state).toBe('unplanned');
    const r = await json('/calendar/restore', { method: 'POST', body: { workouts: del.deleted } });
    expect(r.restored[0].pairedActivityId).toBe(a);
    expect(await pairOf(a)).toBe(w.id);
  });

  it('delete with a second workout that day: the released activity pairs with it', async () => {
    const d = addDays(today, -16);
    const a = await run(d);
    const w1 = await plan(d);
    const w2 = await plan(d, { startTime: '18:00', title: 'Evening run' });
    expect(await pairOf(a)).toBe(w1.id);
    await json(`/workouts/${w1.id}`, { method: 'DELETE' });
    expect(await pairOf(a)).toBe(w2.id);
    expect(await workoutPair(w2.id)).toBe(a);
  });

  it('quick-add, duplicate and template schedule pair on creation', async () => {
    const d1 = addDays(today, -17);
    const d2 = addDays(today, -18);
    const d3 = addDays(today, -19);
    const [a1, a2, a3] = [await run(d1), await run(d2), await run(d3)];
    const q = await json('/workouts/quick', { method: 'POST', body: { date: d1, text: 'run 60min easy' } });
    expect(q.workout.pairedActivityId).toBe(a1);
    const dup = await json(`/workouts/${q.workout.id}/duplicate`, { method: 'POST', body: { date: d2 } });
    expect(dup.pairedActivityId).toBe(a2);
    expect(await pairOf(a2)).toBe(dup.id);
    const tpl = await json('/templates', { method: 'POST', body: { sport: 'run', title: 'Template run', plannedDurationSec: 3600, intensity: 'endurance', tags: [] } });
    const sch = await json(`/templates/${tpl.id}/schedule`, { method: 'POST', body: { date: d3 } });
    expect(sch.workouts[0].pairedActivityId).toBe(a3);
  });

  it('copy-week and shift re-pair the affected days', async () => {
    // Source week: a planned run on a Monday ten weeks ago; target week: the week after, with a completed run.
    const srcMon = addDays(weekStart(today), -70);
    const dstMon = addDays(srcMon, 7);
    await plan(srcMon, { title: 'Copy me' });
    const aDst = await run(dstMon);
    const copied = await json('/calendar/copy-week', { method: 'POST', body: { fromWeek: srcMon, toWeek: dstMon } });
    const copy = copied.created.find((w: any) => w.date === dstMon);
    expect(copy.pairedActivityId).toBe(aDst);

    // Shift: a future-dated workout moved back onto a past day that has an unplanned run.
    const target = addDays(today, -90);
    const aShift = await run(target);
    const far = addDays(today, 250);
    const w = await plan(far, { title: 'Shift me' });
    const shifted = await json('/calendar/shift', { method: 'POST', body: { fromDate: far, days: -340 } });
    const m = shifted.moved.find((x: any) => x.id === w.id);
    expect(m.date).toBe(target);
    expect(m.pairedActivityId).toBe(aShift);
    // Undo the shift: the activity is released again.
    await json('/calendar/restore', { method: 'POST', body: { workouts: shifted.previous } });
    expect(await pairOf(aShift)).toBeNull();
  });

  it('manual pairs stay untouched (incl. a cross-date manual pair across delete + undo)', async () => {
    const d = addDays(today, -50);
    const a = await run(d);
    const wManual = await plan(addDays(d, 1), { title: 'Manual target' });
    await json(`/workouts/${wManual.id}/pair`, { method: 'POST', body: { activityId: a } });
    expect(await pairOf(a)).toBe(wManual.id);
    // A better-matching workout on the activity's own day does not steal it.
    const sameDay = await plan(d);
    expect(sameDay.pairedActivityId).toBeUndefined();
    await json(`/workouts/${sameDay.id}/skip`, { method: 'POST', body: { reason: 'other' } });
    await json(`/workouts/${sameDay.id}/skip`, { method: 'DELETE' });
    expect(await pairOf(a)).toBe(wManual.id);
    // Moving the manually paired workout keeps the pair.
    await json(`/workouts/${wManual.id}`, { method: 'PATCH', body: { date: addDays(d, 2) } });
    expect(await pairOf(a)).toBe(wManual.id);
    // Delete + undo of the manual pair restores it (it would not be re-created automatically).
    const del = await json(`/workouts/${wManual.id}`, { method: 'DELETE' });
    // Released: now auto-pairs with the same-day workout.
    expect(await pairOf(a)).toBe(sameDay.id);
    await json(`/workouts/${sameDay.id}`, { method: 'DELETE' });
    expect(await pairOf(a)).toBeNull();
    const r = await json('/calendar/restore', { method: 'POST', body: { workouts: del.deleted } });
    expect(r.restored[0].pairedActivityId).toBe(a);
    expect(await pairOf(a)).toBe(wManual.id);
  });
});

describe('re-pairing after activity deletion (user-facing)', () => {
  it('DELETE /activities/:id releases the workout, which pairs with another activity of that day; restore re-pairs', async () => {
    const d = addDays(today, -40);
    const w = await plan(d);
    const a1 = await run(d, 3600, '07:00');
    expect(await workoutPair(w.id)).toBe(a1);
    const a2 = await run(d, 3300, '17:00');
    expect(await pairOf(a2)).toBeNull();
    const res = await api(`/activities/${a1}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await workoutPair(w.id)).toBe(a2);
    // Restoring a1 does not steal the pair back from a2 unless it scores higher — it is re-evaluated.
    await json(`/activities/${a1}/restore`, { method: 'POST' });
    const pairs = [await pairOf(a1), await pairOf(a2)];
    expect(pairs.filter((p) => p === w.id)).toHaveLength(1);
  });
});
