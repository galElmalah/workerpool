import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';
import { queueSize } from '../worker/db/sync';
import { getDemoMock, setDemoConfig, setDemoNow } from '../worker/services/garmin';

// Syncs generate + parse FIT files in workerd; keep headroom when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });


const TODAY = '2026-11-20';
const NOW = Date.parse(`${TODAY}T21:00:00Z`);

describe('backfill', () => {
  it('setup', async () => {
    await setDemoConfig(env, { seed: 5, athleteToday: TODAY, months: 2 });
    await setDemoNow(env, NOW);
    await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
  });

  it('steps to completion with a bounded number of Garmin requests per step', async () => {
    const { mock } = await getDemoMock(env);
    const visible = mock.visibleActivities().length;
    let reqs = mock.state.requests.length;
    let p = await json('/garmin/backfill', { method: 'POST', body: { months: 3 } });
    const perStep: number[] = [mock.state.requests.length - reqs];
    let steps = 1;
    while (p.running && steps < 50) {
      reqs = mock.state.requests.length;
      p = await json('/garmin/backfill/step', { method: 'POST' });
      perStep.push(mock.state.requests.length - reqs);
      steps++;
      if (p.phase === 'activities') expect(p.total).not.toBeNull();
      if (steps === 3 && p.running) {
        // Mid-import the status says so and counts what has landed: the web app polls it to show
        // "Importing history" on the calendar and to refresh the training views as activities arrive.
        const mid = await json('/garmin/status');
        const stored = await env.DB.prepare('SELECT count(*) AS n FROM activities WHERE deleted_at IS NULL').first<number>('n');
        expect(mid.backfill).toMatchObject({ running: true, done: p.done });
        expect(mid.counts.activities).toBe(stored);
        expect(stored).toBeGreaterThan(0);
      }
    }
    expect(p).toMatchObject({ running: false, phase: 'done', failed: 0 });
    expect(p.done).toBe(visible);
    expect(p.total).toBe(visible);
    expect(p.wellnessDays).toBeGreaterThan(40);
    expect(Math.max(...perStep)).toBeLessThanOrEqual(41);
    expect(steps).toBeGreaterThan(1);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM activities').first('n')).toBe(visible);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM activity_streams').first<number>('n')).toBeGreaterThan(visible * 0.7);
    expect(await queueSize(env.DB, 'bf')).toBe(0);
    const st = await json('/garmin/status');
    expect(st.backfill).toMatchObject({ running: false, done: visible, total: visible });
    const log = await json('/sync/log?kind=backfill');
    expect(log.entries[0].summary).toMatch(/^Backfill complete/);
  }, 300_000);

  it('a re-run skips everything already stored', async () => {
    let p = await json('/garmin/backfill', { method: 'POST', body: { months: 3, wellness: false } });
    for (let i = 0; p.running && i < 10; i++) p = await json('/garmin/backfill/step', { method: 'POST' });
    expect(p).toMatchObject({ phase: 'done', listed: 0, created: 0, done: 0 });
  }, 60_000);

  it('cancel stops the job and clears its queue', async () => {
    await env.DB.prepare('DELETE FROM activities').run();
    await json('/garmin/backfill', { method: 'POST', body: { months: 3 } });
    const c = await json('/garmin/backfill', { method: 'DELETE' });
    expect(c).toMatchObject({ running: false, phase: 'cancelled' });
    expect(await queueSize(env.DB, 'bf')).toBe(0);
    const res = await api('/garmin/backfill/step', { method: 'POST' });
    expect((await res.json<any>()).phase).toBe('cancelled');
  }, 60_000);

  it('sync log pages newest first with a cursor', async () => {
    const all = await json('/sync/log?limit=200');
    const p1 = await json('/sync/log?limit=2');
    expect(p1.entries).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await json(`/sync/log?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`);
    expect([...p1.entries, ...p2.entries].map((e: any) => e.id)).toEqual(all.entries.slice(0, 4).map((e: any) => e.id));
    const ats = all.entries.map((e: any) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });
});
