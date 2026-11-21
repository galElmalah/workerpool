import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../worker/index';
import { api, json } from './helpers';
import { acquireLock, releaseLock, getState } from '../worker/db/sync';
import { putWellnessManual, getWellness } from '../worker/db/furniture';
import { insertThreshold, listThresholds } from '../worker/db/thresholds';
import { getDemoMock, setDemoConfig, setDemoNow } from '../worker/services/garmin';
import { applyGarminThresholds, runSync } from '../worker/services/sync';

// Syncs generate + parse FIT files in workerd; keep headroom when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });


const TODAY = '2026-11-20';
const NOW = Date.parse(`${TODAY}T21:00:00Z`);
const DAY = 86_400_000;

async function mock() {
  return (await getDemoMock(env)).mock;
}

async function syncUntilDrained(): Promise<any[]> {
  const reports: any[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await json('/garmin/sync', { method: 'POST' });
    reports.push(r);
    if (r.activities.queued === 0) break;
  }
  return reports;
}

const activeCount = async () => (await env.DB.prepare('SELECT count(*) AS n FROM activities WHERE deleted_at IS NULL').first<number>('n'))!;

describe('incremental sync', () => {
  it('setup: demo athlete (1 month) + connect', async () => {
    await setDemoConfig(env, { seed: 11, athleteToday: TODAY, months: 1 });
    await setDemoNow(env, NOW);
    await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
  });

  it('first run imports the 14-day window, bounded by the request budget per run', async () => {
    const m = await mock();
    const expected = m.visibleActivities().filter((a) => Date.parse(a.startedAt) >= NOW - 14 * DAY).length;
    expect(expected).toBeGreaterThan(5);
    const reqBefore = m.state.requests.length;
    const reports = await syncUntilDrained();
    const created = reports.reduce((s, r) => s + r.activities.created, 0);
    expect(created).toBe(expected);
    for (const r of reports) expect(r.requests).toBeLessThanOrEqual(40);
    expect(m.state.requests.length - reqBefore).toBeLessThanOrEqual(40 * reports.length + 5);
    expect(await activeCount()).toBe(expected);
    expect(reports[0].wellnessDays).toBeGreaterThan(0);
    const st = await json('/garmin/status');
    expect(st.lastSyncAt).toBeTruthy();
    expect(st.lastError).toBeUndefined();
  }, 120_000);

  it('a second run is a no-op (idempotent)', async () => {
    const before = await activeCount();
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities).toMatchObject({ created: 0, updated: 0, deleted: 0, queued: 0 });
    expect(await activeCount()).toBe(before);
    expect(r.summary).toMatch(/^No new activities/);
  });

  it('detects an edit made in Garmin Connect and re-ingests it', async () => {
    const m = await mock();
    const a = m.visibleActivities()[1]!;
    m.editActivity(a.garminActivityId, { activityName: 'Renamed in Garmin' });
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities.updated).toBe(1);
    expect(r.activities.created).toBe(0);
    const row = await env.DB.prepare('SELECT title FROM activities WHERE garmin_activity_id = ?').bind(String(a.garminActivityId)).first<string>('title');
    expect(row).toBe('Renamed in Garmin');
  });

  it('an upstream delete soft-deletes the activity (and a re-sync does not resurrect it)', async () => {
    const m = await mock();
    const a = m.visibleActivities()[2]!;
    m.deleteActivity(a.garminActivityId);
    const before = await activeCount();
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.activities.deleted).toBe(1);
    expect(await activeCount()).toBe(before - 1);
    const row = await env.DB.prepare('SELECT deleted_at FROM activities WHERE garmin_activity_id = ?').bind(String(a.garminActivityId)).first<string>('deleted_at');
    expect(row).toBeTruthy();
    const r2 = await json('/garmin/sync', { method: 'POST' });
    expect(r2.activities).toMatchObject({ created: 0, deleted: 0 });
  });

  it('wellness upsert never clobbers manual check-ins', async () => {
    await putWellnessManual(env.DB, TODAY, { feel: 4, soreness: 2, note: 'legs ok' });
    await env.DB.prepare("DELETE FROM sync_state WHERE key = 'garmin:wellness'").run();
    const r = await runSync(env, { reason: 'manual', wellnessDays: 3 });
    expect(r.wellnessDays).toBeGreaterThan(0);
    const w = await getWellness(env.DB, TODAY);
    expect(w).toMatchObject({ feel: 4, soreness: 2, note: 'legs ok' });
    expect(w!.restingHr ?? w!.hrvMs ?? w!.sleepSec).toBeDefined();
  });

  it('suggests thresholds from Garmin only when changed and not overridden manually', async () => {
    const th = await listThresholds(env.DB);
    expect(th.some((t) => t.source === 'garmin' && t.kind === 'ftp')).toBe(true); // first run had none stored
    const settings = { ftp: 300, lthr: 171, raw: {} };
    // unchanged since Garmin last reported → nothing
    const latestGarminFtp = th.find((t) => t.source === 'garmin' && t.kind === 'ftp')!;
    expect(await applyGarminThresholds(env, { ftp: latestGarminFtp.value, raw: {} }, '2026-11-21')).toHaveLength(0);
    // a manual value dated today wins
    await insertThreshold(env.DB, { kind: 'ftp', sport: 'bike', value: 290, effectiveFrom: '2026-11-22', source: 'manual' });
    expect((await applyGarminThresholds(env, settings, '2026-11-22')).map((t) => t.kind)).toEqual(['lthr']);
    // a later genuine Garmin change is suggested again
    const ins = await applyGarminThresholds(env, { ftp: 305, raw: {} }, '2026-11-25');
    expect(ins).toMatchObject([{ kind: 'ftp', value: 305, source: 'garmin', effectiveFrom: '2026-11-25' }]);
  });

  it('the D1 lock prevents overlapping runs', async () => {
    const lease = await acquireLock(env.DB, 'sync', 60_000);
    expect(lease).toBeTruthy();
    expect(await acquireLock(env.DB, 'sync', 60_000)).toBeNull();
    const res = await api('/garmin/sync', { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json<any>()).error.code).toBe('sync_in_progress');
    const r = await runSync(env, { reason: 'cron' });
    expect(r).toMatchObject({ status: 'skipped', skippedBecause: 'locked' });
    await releaseLock(env.DB, lease!);
    // an expired lease can be taken over
    expect(await acquireLock(env.DB, 'sync', -1)).toBeTruthy();
    expect(await acquireLock(env.DB, 'sync', 60_000)).toBeTruthy();
    await env.DB.prepare("DELETE FROM sync_state WHERE key = 'lock:sync'").run();
  });

  it('a block from Garmin is logged, recorded and pauses later runs', async () => {
    const m = await mock();
    m.setScenario('blocked');
    const res = await api('/garmin/sync', { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json<any>()).error.code).toBe('garmin_blocked');
    m.setScenario('ok');
    const st = await json('/garmin/status');
    expect(st.lastError).toMatch(/refused/);
    const r = await runSync(env, { reason: 'cron' });
    expect(r).toMatchObject({ status: 'skipped', skippedBecause: 'backoff' });
    const log = await json('/sync/log?limit=3&kind=pull_activities');
    expect(log.entries[0]).toMatchObject({ status: 'error' });
    await env.DB.prepare("DELETE FROM sync_state WHERE key = 'garmin:backoff'").run();
  });

  it('rotated tokens are persisted: a sync after the access tokens expire refreshes and stores them', async () => {
    const m = await mock();
    m.expireAccessTokens();
    const refreshes = m.state.refreshCount;
    const r = await json('/garmin/sync', { method: 'POST' });
    expect(r.status).toBe('ok');
    expect(m.state.refreshCount).toBeGreaterThan(refreshes);
  });
});

describe('cron handler', () => {
  it('runs a sync when connected and never throws', async () => {
    await setDemoNow(env, NOW + DAY);
    const before = (await json('/sync/log?kind=pull_activities')).entries.length;
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(NOW + DAY), cron: '*/30 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    const log = await json('/sync/log?kind=pull_activities');
    expect(log.entries.length).toBe(before + 1);
    expect(log.entries[0].status).toBe('ok');
  });

  it('is safe when Garmin is not connected', async () => {
    await api('/garmin/connect', { method: 'DELETE' });
    const before = (await json('/sync/log')).entries.length;
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(), cron: '*/30 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await json('/sync/log')).entries.length).toBe(before);
    expect(await getState(env.DB, 'lock:sync')).toBeUndefined();
  });
});
