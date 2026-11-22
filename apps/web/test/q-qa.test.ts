/** QA regressions: merge semantics, threshold back-dating, re-ingest titles, one intensity definition, … */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { generateActivityDetail, generateAthlete, encodeFit, type SynthAthlete } from '@cadence/garmin/synth';
import { addDays, isoWeekOf } from '@cadence/core/time';
import { ingestActivity } from '../worker/services/ingest';
import { applyGarminThresholds } from '../worker/services/sync';
import { insertThreshold, listThresholds } from '../worker/db/thresholds';
import { insertSyncLog } from '../worker/db/sync';
import { api, json } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

let athlete: SynthAthlete;
const setToday = (d: string) =>
  env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('demo:now', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(String(Date.parse(`${d}T12:00:00Z`)), new Date().toISOString())
    .run();

beforeAll(async () => {
  athlete = generateAthlete({ seed: 11, today: '2026-11-21', months: 2 });
  for (const [kind, sport, value] of [
    ['ftp', 'bike', athlete.profile.ftp],
    ['lthr', 'all', athlete.profile.lthr],
    ['hr_max', 'all', athlete.profile.hrMax],
    ['hr_rest', 'all', athlete.profile.hrRest],
  ] as const) {
    await insertThreshold(env.DB, { kind, sport, value, effectiveFrom: '2020-01-01', source: 'manual' });
  }
});

describe('week notes (PUT is a merge)', () => {
  it('a target-only PUT keeps the reflection; explicit null clears a target', async () => {
    await json('/week-notes/2026-W40', { method: 'PUT', body: { body: 'Solid block', targetHours: 10 } });
    const a = await json('/week-notes/2026-W40', { method: 'PUT', body: { targetLoad: 500 } });
    expect(a).toMatchObject({ body: 'Solid block', targetHours: 10, targetLoad: 500 });
    const b = await json('/week-notes/2026-W40', { method: 'PUT', body: { targetHours: null } });
    expect(b.body).toBe('Solid block');
    expect(b.targetHours).toBeUndefined();
    expect(b.targetLoad).toBe(500);
    const c = await json('/week-notes/2026-W40', { method: 'PUT', body: { body: '' } });
    expect(c.body).toBe('');
    expect(c.targetLoad).toBe(500);
  });
});

describe('one intensity definition', () => {
  it('WeekSummary.intensitySec equals /trends/intensity for the same weeks', async () => {
    // a week of real FITs (zone seconds) plus a manual activity (class fallback)
    const last = athlete.activities.at(-1)!.localDate;
    const week = isoWeekOf(last);
    const inWeek = athlete.activities.filter((a) => isoWeekOf(a.localDate) === week || isoWeekOf(a.localDate) === isoWeekOf(addDays(last, -7)));
    for (const a of inWeek.slice(0, 8)) await ingestActivity(env, { source: 'upload', fit: encodeFit(generateActivityDetail(athlete, a.garminActivityId)) });
    await json('/activities/manual', { method: 'POST', body: { localDate: last, sport: 'strength', title: 'Gym', durationSec: 2400, rpe: 6 } });
    await setToday(last);
    const intensity = await json('/trends/intensity?weeks=3');
    const weekly = await json(`/trends/weekly?weeks=3&end=${last}`);
    let compared = 0;
    for (const w of weekly) {
      const t = intensity.weeks.find((x: any) => x.isoWeek === w.isoWeek);
      expect(t).toBeDefined();
      for (const k of ['easy', 'moderate', 'hard'] as const) expect(Math.round(w.intensitySec[k])).toBe(t[k]);
      if (w.doneSec > 0) compared++;
    }
    expect(compared).toBeGreaterThan(0);
    const zoned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM activities WHERE json_extract(zones, '$.three') IS NOT NULL`).first<{ n: number }>();
    expect(zoned!.n).toBeGreaterThan(0); // both sources of the definition are exercised
  });
});

describe('FIT re-upload', () => {
  it('keeps the existing (synced) title when the upload carries none', async () => {
    const a = athlete.activities.find((x) => x.sport === 'run' && x.distanceM)!;
    const summary = {
      garminActivityId: String(a.garminActivityId),
      garminTypeKey: a.garminTypeKey,
      startedAt: a.startedAt,
      utcOffsetMin: a.utcOffsetMin,
      localDate: a.localDate,
      sport: a.sport,
      title: 'Riverside tempo',
      durationSec: a.durationSec,
      movingSec: a.movingSec,
      distanceM: a.distanceM,
      editHash: 'q1',
    };
    const first = await ingestActivity(env, { source: 'garmin', summary });
    const up = await json('/activities/upload', { method: 'POST', body: encodeFit(generateActivityDetail(athlete, a.garminActivityId)) });
    expect(up.activityId).toBe(first.activityId);
    expect(up.activity.title).toBe('Riverside tempo');
    // a later Garmin rename still applies (the title still follows upstream)
    await ingestActivity(env, { source: 'garmin', summary: { ...summary, title: 'Renamed upstream', editHash: 'q2' } });
    expect((await json(`/activities/${first.activityId}`)).title).toBe('Renamed upstream');
  });
});

describe('Garmin thresholds', () => {
  it('the first value of a kind is dated at the start of the imported history', async () => {
    const today = '2026-11-21';
    const oldest = (await env.DB.prepare('SELECT MIN(local_date) AS d FROM activities').first<{ d: string }>())!.d;
    const ins = await applyGarminThresholds(env, { weightKg: 71.5, raw: {} }, today);
    expect(ins).toMatchObject([{ kind: 'weight', source: 'garmin', effectiveFrom: oldest }]);
    // an existing kind keeps "effective today" semantics
    const ftp = await applyGarminThresholds(env, { ftp: athlete.profile.ftp + 20, raw: {} }, today);
    expect(ftp).toMatchObject([{ kind: 'ftp', effectiveFrom: today }]);
    expect((await listThresholds(env.DB)).filter((t) => t.kind === 'weight')).toHaveLength(1);
  });
});

describe('weeks, today, sync log', () => {
  it('GET /weeks/:isoWeek includes events and the previous week wellness', async () => {
    await json('/events', { method: 'POST', body: { date: '2026-10-07', name: 'Club TT', priority: 'C', sport: 'bike' } });
    await json('/wellness/2026-09-30', { method: 'PUT', body: { feel: 4 } });
    await json('/wellness/2026-10-01', { method: 'PUT', body: { feel: 2 } });
    const w = await json('/weeks/2026-W41');
    expect(w.events.map((e: any) => e.name)).toEqual(['Club TT']);
    expect(w.previousWellness.avgFeel).toBe(3);
    expect(w.wellness).toBeDefined();
  });

  it('GET /today pendingLogs covers the last 7 days, newest first, max 5', async () => {
    const today = '2026-12-20';
    await setToday(today);
    for (let i = 0; i <= 8; i++) {
      await json('/activities/manual', { method: 'POST', body: { localDate: addDays(today, -i), sport: 'run', title: `Run ${i}`, durationSec: 1800 } });
    }
    const t = await json('/today');
    expect(t.pendingLogs).toHaveLength(5);
    const dates = t.pendingLogs.map((a: any) => a.localDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe(today);
    for (const d of dates) expect(d > addDays(today, -7)).toBe(true);
    // a 6-day-old activity is still pending when it is among the newest five
    await env.DB.prepare(`UPDATE activities SET rpe = 5, feel = 3 WHERE local_date > ?`).bind(addDays(today, -5)).run();
    const t2 = await json('/today');
    expect(t2.pendingLogs.map((a: any) => a.localDate)).toEqual([addDays(today, -5), addDays(today, -6)]);
  });

  it('GET /sync/log filters by status', async () => {
    await insertSyncLog(env.DB, { kind: 'pull_activities', status: 'ok', summary: 'fine' });
    await insertSyncLog(env.DB, { kind: 'pull_activities', status: 'error', summary: 'broken' });
    const errs = await json('/sync/log?status=error');
    expect(errs.entries.length).toBeGreaterThan(0);
    expect(errs.entries.every((e: any) => e.status === 'error')).toBe(true);
    expect((await api('/sync/log?status=nope')).status).toBe(400);
  });
});

describe('login throttling (end to end)', () => {
  const login = (passphrase: string) =>
    api('/auth/login', { method: 'POST', body: { passphrase } });

  it('6 wrong passphrases → 429 with a retry hint; the right one works after the window', async () => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await login(`definitely wrong ${i}`);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await last!.json<any>()).error.message).toMatch(/Try again in \d+ s/);
    // still locked for the right passphrase
    expect((await login('correct horse battery staple')).status).toBe(429);
    // age the stored lockout past its window
    const row = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'auth.throttle'`).first<{ value: string }>();
    const t = JSON.parse(row!.value);
    expect(t.fails).toBeGreaterThanOrEqual(5);
    await env.DB.prepare(`UPDATE sync_state SET value = ? WHERE key = 'auth.throttle'`)
      .bind(JSON.stringify({ ...t, lockedUntil: Date.now() - 1000 }))
      .run();
    expect((await login('correct horse battery staple')).status).toBe(200);
    const after = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'auth.throttle'`).first<{ value: string }>();
    expect(JSON.parse(after!.value).fails).toBe(0);
  });
});
