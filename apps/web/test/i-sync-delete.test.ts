/** Integration: an activity deleted on Garmin releases its workout, and the day is re-paired. */
import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { getDemoMock, setDemoConfig, setDemoNow } from '../worker/services/garmin';
import { json } from './helpers';

vi.setConfig({ testTimeout: 120_000 });

const TODAY = '2026-11-20';
const NOW = Date.parse(`${TODAY}T21:00:00Z`);

describe('upstream deletion', () => {
  it('releases the paired workout and re-pairs it with another activity of that day', async () => {
    await setDemoConfig(env, { seed: 11, athleteToday: TODAY, months: 1 });
    await setDemoNow(env, NOW);
    await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
    for (let i = 0; i < 10; i++) {
      const r = await json('/garmin/sync', { method: 'POST' });
      if (r.activities.queued === 0) break;
    }
    const row = await env.DB.prepare(
      `SELECT id, garmin_activity_id, local_date, sport, moving_sec, started_at FROM activities
       WHERE deleted_at IS NULL AND sport IN ('run', 'bike') AND moving_sec > 1200 ORDER BY started_at DESC LIMIT 1`,
    ).first<{ id: string; garmin_activity_id: string; local_date: string; sport: string; moving_sec: number; started_at: string }>();
    expect(row).toBeTruthy();
    const a = row!;
    // Make sure that day has a matching plan paired with the synced activity.
    await env.DB.prepare('UPDATE workouts SET date = date(date, \'+400 days\') WHERE date = ?').bind(a.local_date).run();
    const w = await json('/workouts', { method: 'POST', body: { date: a.local_date, sport: a.sport, title: 'Planned', plannedDurationSec: Math.round(a.moving_sec) } });
    expect(w.pairedActivityId).toBe(a.id);
    // A second, worse-matching activity the same day stays unplanned for now.
    const other = await json('/activities/manual', {
      method: 'POST',
      body: { localDate: a.local_date, startTime: '23:00', sport: a.sport, title: 'Extra', durationSec: Math.round(a.moving_sec * 0.8) },
    });
    expect(other.pairedWorkoutId).toBeUndefined();

    (await getDemoMock(env)).mock.deleteActivity(Number(a.garmin_activity_id));
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities.deleted).toBe(1);
    const after = await json(`/workouts/${w.id}`);
    expect(after.pairedActivityId).toBe(other.id);
    expect((await json(`/activities/${other.id}`)).pairedWorkoutId).toBe(w.id);
  });
});
