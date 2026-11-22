/** GET /api/mobile/snapshot (docs/MOBILE_API.md §2) on an empty database and a seeded demo athlete. */
import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { MobileSnapshot, type SnapshotSession } from '@cadence/core/domain';
import { addDays, isoWeekOf, weekStart } from '@cadence/core/time';
import { anon, api, json, TEST_PASSPHRASE } from './helpers';

vi.setConfig({ testTimeout: 300_000 });

const SEEDED = '2026-11-18'; // a Wednesday

async function snapshot(headers?: Record<string, string>): Promise<MobileSnapshot> {
  const res = headers ? await anon('/mobile/snapshot', { headers }) : await api('/mobile/snapshot');
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text.length).toBeLessThan(8 * 1024);
  return MobileSnapshot.parse(JSON.parse(text));
}

const setNow = (iso: string) =>
  env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('demo:now', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(String(Date.parse(iso)), new Date().toISOString())
    .run();

describe('mobile snapshot', () => {
  it('requires auth', async () => {
    expect((await anon('/mobile/snapshot')).status).toBe(401);
  });

  it('empty database: valid, all-empty snapshot', async () => {
    await setNow(`${SEEDED}T12:00:00Z`);
    const s = await snapshot();
    expect(s.today).toBe(SEEDED);
    expect(s.units).toBe('metric');
    expect(s.athleteName).toBeNull();
    expect(s.status).toEqual({ fitness: null, fatigue: null, form: null, formZone: null, rampPerWeek: null, headline: 'Rest day' });
    expect(s.todaySessions).toEqual([]);
    expect(s.tomorrowSessions).toEqual([]);
    expect(s.week.isoWeek).toBe(isoWeekOf(SEEDED));
    expect(s.week.label).toBe(`W${isoWeekOf(SEEDED).slice(6)}`);
    expect(s.week.days.map((d) => d.date)[0]).toBe(weekStart(SEEDED));
    expect(s.week.days.every((d) => d.state === 'rest' && d.doneSec === 0 && d.plannedSec === 0)).toBe(true);
    expect(s.week).toMatchObject({ doneSec: 0, plannedSec: 0, doneLoad: 0, plannedLoad: 0, keyDone: 0, keyPlanned: 0, phase: null });
    expect(s.nextEvent).toBeNull();
    expect(s.fitnessSeries).toEqual([]);
    expect(s.recentWeeks).toHaveLength(9);
    expect(s.recentWeeks.at(-1)!.isoWeek).toBe(isoWeekOf(SEEDED));
    expect(s.recentWeeks.every((w) => w.hours === 0 && w.load === 0)).toBe(true);
    expect(s.lastActivity).toBeNull();
    expect(s.lastSyncAt).toBeNull();
  });

  it('seeded demo athlete: matches /today, /trends/weekly and /trends/fitness', async () => {
    let p = await json('/demo/seed', { method: 'POST', body: { months: 2, seed: 9, fast: true, today: SEEDED, now: `${SEEDED}T19:00:00Z` } });
    for (let i = 0; !p.finished && i < 60; i++) p = await json('/demo/seed/step', { method: 'POST', body: { maxActivities: 40 } });
    expect(p.finished).toBe(true);

    const s = await snapshot();
    const today = await json('/today');
    expect(s.today).toBe(SEEDED);
    expect(today.date).toBe(SEEDED);

    // status = /today's fitness day
    expect(s.status.fitness).toBe(today.fitness.fitness);
    expect(s.status.fatigue).toBe(today.fitness.fatigue);
    expect(s.status.form).toBe(today.fitness.form);
    expect(s.status.formZone).toBe(today.fitness.formZone);
    expect(s.status.rampPerWeek).toBe(today.fitness.ramp);
    expect(s.status.fitness).toBeGreaterThan(0);
    expect(s.status.headline.length).toBeGreaterThan(0);

    // fitness series: the last 42 days incl. today, identical to /trends/fitness
    expect(s.fitnessSeries).toHaveLength(42);
    expect(s.fitnessSeries[0].date).toBe(addDays(SEEDED, -41));
    expect(s.fitnessSeries.at(-1)!.date).toBe(SEEDED);
    const trend = await json(`/trends/fitness?from=${addDays(SEEDED, -41)}&to=${SEEDED}`);
    const series = Array.isArray(trend) ? trend : (trend.days ?? trend.series);
    for (const f of s.fitnessSeries) {
      const t = series.find((x: any) => x.date === f.date);
      expect({ fitness: t.fitness, fatigue: t.fatigue, form: t.form }).toEqual({ fitness: f.fitness, fatigue: f.fatigue, form: f.form });
    }

    // week = /today's week summary
    expect(s.week.isoWeek).toBe(today.week.isoWeek);
    expect(s.week.doneSec).toBe(Math.round(today.week.doneSec));
    expect(s.week.plannedSec).toBe(Math.round(today.week.plannedSec));
    expect(s.week.doneLoad).toBe(today.week.doneLoad);
    expect(s.week.plannedLoad).toBe(today.week.plannedLoad);
    expect(s.week.keyDone).toBe(today.week.keyDone);
    expect(s.week.keyPlanned).toBe(today.week.keyPlanned);
    expect(s.week.days).toHaveLength(7);
    expect(s.week.days.reduce((n, d) => n + d.doneSec, 0)).toBeCloseTo(s.week.doneSec, -1);
    expect(s.week.days.reduce((n, d) => n + d.plannedSec, 0)).toBeCloseTo(s.week.plannedSec, -1);
    for (const d of s.week.days) {
      if (d.date > SEEDED) expect(['rest', 'planned']).toContain(d.state);
      if (d.date < SEEDED) expect(['rest', 'done', 'partial', 'missed']).toContain(d.state);
    }
    expect(s.week.days.some((d) => d.state !== 'rest')).toBe(true);

    // recent weeks = /trends/weekly (8 complete weeks + current)
    const weekly = await json(`/trends/weekly?weeks=9&end=${SEEDED}`);
    expect(s.recentWeeks.map((w) => w.isoWeek)).toEqual(weekly.map((w: any) => w.isoWeek));
    for (const [i, w] of s.recentWeeks.entries()) {
      expect(w.hours).toBe(Math.round((weekly[i].doneSec / 3600) * 10) / 10);
      expect(w.load).toBe(weekly[i].doneLoad);
    }
    expect(s.recentWeeks.some((w) => w.hours > 0)).toBe(true);

    // today / tomorrow sessions
    const pairedIds = new Set(today.workouts.map((w: any) => w.pairedActivityId).filter(Boolean));
    const unplanned = today.activities.filter((a: any) => !pairedIds.has(a.id) && !today.workouts.some((w: any) => w.id === a.pairedWorkoutId));
    expect(s.todaySessions).toHaveLength(today.workouts.length + unplanned.length);
    const tomorrow = await json(`/workouts?from=${addDays(SEEDED, 1)}&to=${addDays(SEEDED, 1)}`);
    const tomorrowWorkouts = Array.isArray(tomorrow) ? tomorrow : tomorrow.workouts;
    expect(s.tomorrowSessions.map((x) => x.id).sort()).toEqual(tomorrowWorkouts.map((w: any) => w.id).sort());
    expect(s.tomorrowSessions.every((x) => x.kind === 'planned' && x.state === 'planned')).toBe(true);
    const checkSession = (x: SnapshotSession) => {
      if (x.kind === 'planned') expect(x).toMatchObject({ workoutId: x.id, activityId: null });
      if (x.kind === 'activity') expect(x).toMatchObject({ activityId: x.id, state: 'done' });
      if (x.kind === 'paired') expect(x).toMatchObject({ workoutId: x.id, state: 'done' });
      if (x.kind !== 'planned') expect(x.activityId).toBeTruthy();
    };
    [...s.todaySessions, ...s.tomorrowSessions].forEach(checkSession);
    const times = s.todaySessions.map((x) => x.startTime).filter((t): t is string => !!t);
    expect(times).toEqual([...times].sort());

    // next event = /today's
    if (today.nextEvent) {
      expect(s.nextEvent).toEqual({
        id: today.nextEvent.event.id,
        name: today.nextEvent.event.name,
        date: today.nextEvent.event.date,
        daysTo: today.nextEvent.daysUntil,
        priority: today.nextEvent.event.priority,
      });
    } else expect(s.nextEvent).toBeNull();

    // last activity = the newest non-deleted activity on/before today
    const newest = await env.DB.prepare(
      `SELECT id, local_date FROM activities WHERE deleted_at IS NULL AND local_date <= ? ORDER BY started_at DESC LIMIT 1`,
    )
      .bind(SEEDED)
      .first<{ id: string }>();
    expect(s.lastActivity).not.toBeNull();
    checkSession(s.lastActivity!);
    expect(s.lastActivity!.activityId).toBe(newest!.id);
    expect(s.lastActivity!.state).toBe('done');

    expect(s.lastSyncAt).not.toBeNull();
  });

  it('honours units, name and the athlete time zone (with the demo clock)', async () => {
    await json('/settings', { method: 'PATCH', body: { units: 'imperial', name: 'Gal', timezone: 'Pacific/Auckland' } });
    await setNow(`${SEEDED}T23:30:00Z`); // already the next morning in Auckland
    const s = await snapshot();
    expect(s.units).toBe('imperial');
    expect(s.athleteName).toBe('Gal');
    expect(s.today).toBe(addDays(SEEDED, 1));
    expect(s.fitnessSeries.at(-1)!.date).toBe(addDays(SEEDED, 1));
    expect((await json('/today')).date).toBe(addDays(SEEDED, 1));
    await json('/settings', { method: 'PATCH', body: { units: 'metric', timezone: 'UTC' } });
    await setNow(`${SEEDED}T19:00:00Z`);
  });

  it('works with a device token', async () => {
    const res = await anon('/auth/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: TEST_PASSPHRASE, name: 'Widget test', platform: 'ios' }),
    });
    expect(res.status).toBe(201);
    const { token } = await res.json<{ token: string }>();
    const s = await snapshot({ authorization: `Bearer ${token}`, accept: 'application/json', 'x-cadence-client': 'ios/1.0' });
    expect(s.today).toBe(SEEDED);
    expect((await anon('/mobile/snapshot', { headers: { authorization: 'Bearer cad_' + 'x'.repeat(43) } })).status).toBe(401);
  });
});
