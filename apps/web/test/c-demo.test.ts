import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';
import { getDemoMock } from '../worker/services/garmin';

describe('demo seed job (2 months, real pipeline through the mock)', () => {
  let progress: any;

  it('starts a job: plan, furniture, thresholds and Garmin connection are in place', async () => {
    progress = await json('/demo/seed', { method: 'POST', body: { months: 2, seed: 7 } });
    expect(progress).toMatchObject({ phase: 'activities', finished: false, done: 0, months: 2 });
    expect(progress.total).toBeGreaterThan(30);
    expect(progress.planned).toBeGreaterThan(40);
    const settings = await json('/settings');
    expect(settings).toMatchObject({ name: 'Jonas Weber', timezone: 'Europe/Madrid', onboarded: true });
    const status = await json('/garmin/status');
    expect(status).toMatchObject({ connected: true, capabilities: { read: true, write: true } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM thresholds').first('n')).toBeGreaterThan(5);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM templates').first('n')).toBeGreaterThan(10);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM phases').first('n')).toBeGreaterThan(0);
  });

  it('is idempotent: the same request returns the running job', async () => {
    const again = await json('/demo/seed', { method: 'POST', body: { months: 2, seed: 7 } });
    expect(again.jobId).toBe(progress.jobId);
  });

  it('steps to completion in bounded batches', async () => {
    const started = Date.now();
    let steps = 0;
    while (!progress.finished && steps < 60) {
      const before = progress.done;
      progress = await json('/demo/seed/step', { method: 'POST', body: { maxActivities: 15 } });
      expect(progress.done - before).toBeLessThanOrEqual(15);
      steps++;
    }
    expect(progress.finished).toBe(true);
    expect(progress.done).toBe(progress.total);
    console.log(`demo seed 2 months: ${progress.done} activities, ${steps} steps, ${Date.now() - started} ms, ${progress.throughput} act/s`);
  }, 300_000);

  it('produced activities with streams, paired workouts, wellness, pushes and a sync log', async () => {
    const st = await json('/demo/status');
    expect(st.job.phase).toBe('done');
    expect(st.counts.activities).toBe(progress.total);
    expect(st.counts.streams).toBeGreaterThan(st.counts.activities * 0.7);
    expect(st.counts.paired).toBeGreaterThan(st.counts.activities * 0.6);
    expect(st.counts.wellness).toBeGreaterThan(40);
    expect(st.counts.pushed).toBeGreaterThan(0);
    // athlete-entered RPE / notes were applied on creation
    const withRpe = await env.DB.prepare('SELECT count(*) AS n FROM activities WHERE rpe IS NOT NULL').first<number>('n');
    expect(withRpe).toBeGreaterThan(st.counts.activities * 0.5);
    // skipped sessions carry the reason
    const skipped = await env.DB.prepare("SELECT count(*) AS n FROM workouts WHERE status = 'skipped' AND skip_reason IS NOT NULL").first<number>('n');
    expect(skipped).toBe(progress.skipped);
    const log = await json('/sync/log?limit=50');
    const kinds = new Set(log.entries.map((e: any) => e.kind));
    expect(kinds).toEqual(new Set(['auth', 'backfill', 'pull_activities']));
    expect(log.entries[0].summary).toMatch(/Demo seed complete/);
    // the mock calendar holds the pushed workouts
    const { mock } = await getDemoMock(env);
    expect(mock.state.schedules.size).toBe(st.counts.pushed);
  });

  it('a second sync imports nothing new', async () => {
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(r.push.pushed).toBe(0);
  });

  it('demo/advance + sync brings in newly recorded activities', async () => {
    const before = (await json('/demo/status')).counts.activities;
    const adv = await json('/demo/advance', { method: 'POST', body: { days: 3 } });
    expect(adv.today > progress.today).toBe(true);
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities.created).toBeGreaterThan(0);
    const after = (await json('/demo/status')).counts.activities;
    expect(after).toBe(before + r.activities.created);
  }, 120_000);

  it('reset wipes everything but the login', async () => {
    const r = await json('/demo/reset', { method: 'POST' });
    expect(r.tables).toContain('activities');
    expect(r.tables).not.toContain('auth');
    const st = await json('/demo/status');
    expect(st.counts.activities).toBe(0);
    expect(st.job).toBeUndefined();
    expect((await api('/garmin/status')).status).toBe(200);
  });
});
