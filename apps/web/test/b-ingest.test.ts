import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { Activity, ActivityDetail, ActivityStreams } from '@cadence/core/domain';
import { generateActivityDetail, generateAthlete, encodeFit, type SynthAthlete } from '../../../packages/garmin/src/synth';
import { ingestActivity, recomputeActivities } from '../worker/services/ingest';
import { getActivityByGarminId } from '../worker/db/activities';
import { decodeStreams, getStreamsBlob } from '../worker/db/streams';
import { insertThreshold } from '../worker/db/thresholds';
import { api, json } from './helpers';

let athlete: SynthAthlete;
let rideId: number;
let fit: Uint8Array;

beforeAll(async () => {
  athlete = generateAthlete({ seed: 7, today: '2026-11-21', months: 3 });
  // Longest outdoor ride with power.
  const rides = athlete.activities.filter((a) => a.sport === 'bike' && a.avgPower && a.hasGps).sort((a, b) => b.durationSec - a.durationSec);
  rideId = rides[0].garminActivityId;
  fit = encodeFit(generateActivityDetail(athlete, rideId));
  await insertThreshold(env.DB, { kind: 'ftp', sport: 'bike', value: athlete.profile.ftp, effectiveFrom: '2020-01-01', source: 'manual' });
  await insertThreshold(env.DB, { kind: 'lthr', sport: 'all', value: athlete.profile.lthr, effectiveFrom: '2020-01-01', source: 'manual' });
  await insertThreshold(env.DB, { kind: 'hr_max', sport: 'all', value: athlete.profile.hrMax, effectiveFrom: '2020-01-01', source: 'manual' });
  await insertThreshold(env.DB, { kind: 'hr_rest', sport: 'all', value: athlete.profile.hrRest, effectiveFrom: '2020-01-01', source: 'manual' });
});

describe('ingest', () => {
  let activityId = '';

  it('ingests a real FIT file with streams, metrics, laps and the original file', async () => {
    const t0 = performance.now();
    const res = await ingestActivity(env, { source: 'upload', fit });
    const ms = performance.now() - t0;
    console.log(`ingest of a ${(fit.byteLength / 1024).toFixed(0)} KB FIT: ${ms.toFixed(0)} ms`);
    expect(res.outcome).toBe('created');
    activityId = res.activityId;
    const detail = ActivityDetail.parse(await json(`/activities/${activityId}`));
    expect(detail.sport).toBe('bike');
    expect(detail.hasStreams).toBe(true);
    expect(detail.load).toBeGreaterThan(20);
    expect(detail.loadSource).toBe('power');
    expect(detail.weightedPower).toBeGreaterThan(0);
    expect(detail.intensityFactor).toBeGreaterThan(0.3);
    expect(detail.peaks.power?.length).toBeGreaterThan(10);
    expect(detail.zones.power?.length).toBeGreaterThan(3);
    expect(detail.laps.length).toBeGreaterThan(0);
    expect(detail.thresholdsUsed.ftp).toBe(athlete.profile.ftp);
    expect(detail.sparkline?.length).toBeGreaterThan(10);
    const orig = await api(`/activities/${activityId}/original`);
    expect(orig.status).toBe(200);
    expect(new Uint8Array(await orig.arrayBuffer()).byteLength).toBe(fit.byteLength);
  });

  it('ingests a ~3 h ride well within the CPU budget (warm)', async () => {
    const target = athlete.activities
      .filter((a) => a.sport === 'bike' && a.garminActivityId !== rideId && a.hasGps)
      .sort((a, b) => Math.abs(a.durationSec - 10_800) - Math.abs(b.durationSec - 10_800))[0];
    const bytes = encodeFit(generateActivityDetail(athlete, target.garminActivityId));
    const t0 = performance.now();
    const res = await ingestActivity(env, { source: 'upload', fit: bytes });
    const ms = performance.now() - t0;
    console.log(`warm ingest of a ${(target.durationSec / 3600).toFixed(2)} h ride (${(bytes.byteLength / 1024).toFixed(0)} KB FIT): ${ms.toFixed(0)} ms`);
    expect(res.outcome).toBe('created');
    expect(ms).toBeLessThan(400); // generous: tests run in parallel; typically ≈ 100 ms
    const blob = await getStreamsBlob(env.DB, res.activityId);
    console.log(`  streams ${(blob!.data.byteLength / 1024).toFixed(0)} KB gzipped`);
    expect(blob!.data.byteLength).toBeLessThan(220_000);
  });

  it('stores gzip columnar streams within the size bound and round-trips them', async () => {
    const blob = await getStreamsBlob(env.DB, activityId);
    expect(blob).not.toBeNull();
    const s = ActivityStreams.parse(await decodeStreams(blob!.data));
    const hours = s.t[s.t.length - 1] / 3600;
    console.log(`streams: ${s.t.length} samples (${hours.toFixed(2)} h), ${(blob!.data.byteLength / 1024).toFixed(0)} KB gzipped`);
    expect(blob!.data.byteLength / Math.max(1, hours)).toBeLessThan(70_000); // ≤ ~200 KB for 3 h
    expect(s.power?.length).toBe(s.t.length);
    expect(s.lat?.[100]).toBeTypeOf('number');
    // Served pre-gzipped when the client accepts gzip.
    const res = await api(`/activities/${activityId}/streams`, { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    const served = ActivityStreams.parse(await res.json());
    expect(served.t.length).toBe(s.t.length);
    const thin = ActivityStreams.parse(await json(`/activities/${activityId}/streams?maxPoints=500`));
    expect(thin.t.length).toBeLessThanOrEqual(500);
    expect(thin.t.length).toBeGreaterThan(200);
    expect(thin.hr?.length).toBe(thin.t.length);
  });

  it('serves selection stats and CSV', async () => {
    const sel = await json(`/activities/${activityId}/selection?startSec=600&endSec=1800`);
    expect(sel.movingSec).toBeGreaterThan(0);
    expect(sel.avgPower).toBeGreaterThan(0);
    expect(sel.avgHr).toBeGreaterThan(60);
    const csv = await (await api(`/activities/${activityId}/export.csv`)).text();
    expect(csv.split('\n')[0]).toContain('time_s');
  });

  it('re-ingests idempotently and keeps athlete fields', async () => {
    const synthAct = athlete.activities.find((a) => a.garminActivityId === rideId)!;
    // Garmin-style summary ingest of the same activity creates a new row keyed by garmin id.
    const summary = {
      garminActivityId: String(rideId),
      garminTypeKey: synthAct.garminTypeKey,
      startedAt: synthAct.startedAt,
      utcOffsetMin: synthAct.utcOffsetMin,
      localDate: synthAct.localDate,
      sport: synthAct.sport,
      subSport: synthAct.subSport,
      title: synthAct.title,
      durationSec: synthAct.durationSec,
      movingSec: synthAct.movingSec,
      distanceM: synthAct.distanceM,
      avgHr: synthAct.avgHr,
      avgPower: synthAct.avgPower,
      editHash: 'h1',
    };
    // The Garmin sync adopts the row of the FIT uploaded earlier (same start + sport).
    const first = await ingestActivity(env, { source: 'garmin', summary, fit });
    expect(first.outcome).toBe('updated');
    expect(first.activityId).toBe(activityId);
    const id = first.activityId;
    expect((await getActivityByGarminId(env.DB, String(rideId)))?.id).toBe(id);
    await json(`/activities/${id}`, { method: 'PATCH', body: { title: 'My big day', rpe: 7, feel: 4, postNote: 'Legs ok', tags: ['long'] } });
    const again = await ingestActivity(env, { source: 'garmin', summary, fit });
    expect(again.outcome).toBe('unchanged');
    const updated = await ingestActivity(env, { source: 'garmin', summary: { ...summary, title: 'Renamed upstream', editHash: 'h2' } });
    expect(updated.outcome).toBe('updated');
    const a = Activity.parse(await json(`/activities/${id}`));
    expect(a.title).toBe('My big day');
    expect(a.rpe).toBe(7);
    expect(a.feel).toBe(4);
    expect(a.postNote).toBe('Legs ok');
    expect(a.tags).toEqual(['long']);
    expect(a.hasStreams).toBe(true); // summary-only re-ingest keeps the stored streams
    // An unedited title follows upstream renames.
    await json(`/activities/${id}`, { method: 'PATCH', body: { title: 'Renamed upstream' } });
    await ingestActivity(env, { source: 'garmin', summary: { ...summary, title: 'Second rename', editHash: 'h3' } });
    expect((await json(`/activities/${id}`)).title).toBe('Second rename');
  });

  it('never resurrects a soft-deleted activity', async () => {
    const synthAct = athlete.activities.find((a) => a.garminActivityId === rideId)!;
    const row = await getActivityByGarminId(env.DB, String(rideId));
    const del = await api(`/activities/${row!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { id: string }).id).toBe(row!.id);
    const res = await ingestActivity(env, {
      source: 'garmin',
      force: true,
      summary: {
        garminActivityId: String(rideId),
        startedAt: synthAct.startedAt,
        utcOffsetMin: synthAct.utcOffsetMin,
        localDate: synthAct.localDate,
        sport: 'bike',
        title: 'x',
        durationSec: synthAct.durationSec,
        movingSec: synthAct.movingSec,
        editHash: 'h9',
      },
    });
    expect(res.outcome).toBe('skipped');
    expect((await api(`/activities/${row!.id}`)).status).toBe(404);
    expect((await getActivityByGarminId(env.DB, String(rideId)))!.deleted).toBe(true);
    const restored = await json(`/activities/${row!.id}/restore`, { method: 'POST' });
    expect(restored.id).toBe(row!.id);
  });

  it('skips bad FIT files and multisport parents without throwing', async () => {
    const bad = await ingestActivity(env, { source: 'upload', fit: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) });
    expect(bad.outcome).toBe('skipped');
    expect(bad.warnings.length).toBeGreaterThan(0);
    const truncated = await ingestActivity(env, { source: 'upload', fit: fit.slice(0, 2000) });
    expect(['skipped', 'created', 'updated']).toContain(truncated.outcome);
    const multi = await ingestActivity(env, {
      source: 'garmin',
      summary: { garminActivityId: '999', garminTypeKey: 'multi_sport', startedAt: '2026-11-01T08:00:00Z', utcOffsetMin: 0, localDate: '2026-11-01', sport: 'other', title: 'Tri', durationSec: 3600, movingSec: 3600 },
    });
    expect(multi.outcome).toBe('skipped');
    const res = await api('/activities/upload', { method: 'POST', body: new Uint8Array([0, 1, 2]) });
    expect(res.status).toBe(400);
  });

  it('uploads a FIT through the API and dedupes a second upload', async () => {
    const other = athlete.activities.filter((a) => a.sport === 'run' && a.distanceM).at(-1)!;
    const bytes = encodeFit(generateActivityDetail(athlete, other.garminActivityId));
    const r1 = await json('/activities/upload', { method: 'POST', body: bytes });
    expect(r1.outcome).toBe('created');
    expect(Activity.parse(r1.activity).sport).toBe('run');
    const r2 = await json('/activities/upload', { method: 'POST', body: bytes });
    expect(r2.activityId).toBe(r1.activityId);
    const detail = ActivityDetail.parse(await json(`/activities/${r1.activityId}`));
    expect(detail.peaks.efforts?.length).toBeGreaterThan(0);
  });

  it('creates manual activities with a manual load', async () => {
    const a = Activity.parse(
      await json('/activities/manual', {
        method: 'POST',
        body: { localDate: '2026-11-20', sport: 'strength', title: 'Gym', durationSec: 3600, rpe: 6, load: 55 },
      }),
    );
    expect(a.load).toBe(55);
    expect(a.loadSource).toBe('manual');
    expect(a.compliance?.state).toBe('unplanned');
    const patched = Activity.parse(await json(`/activities/${a.id}`, { method: 'PATCH', body: { loadManual: null } }));
    expect(patched.loadSource).toBe('rpe');
  });

  it('recomputes stored activities after a threshold change, in cursor batches', async () => {
    const before = await json(`/activities/${activityId}`);
    await insertThreshold(env.DB, { kind: 'ftp', sport: 'bike', value: Math.round(athlete.profile.ftp * 1.2), effectiveFrom: '2021-01-01', source: 'manual' });
    let cursor: string | undefined;
    let total = 0;
    do {
      const r = await recomputeActivities(env, { limit: 2, cursor });
      total += r.recomputed;
      cursor = r.nextCursor;
    } while (cursor);
    expect(total).toBeGreaterThanOrEqual(3);
    const after = await json(`/activities/${activityId}`);
    expect(after.load).toBeLessThan(before.load);
    expect(after.thresholdsUsed.ftp).toBe(Math.round(athlete.profile.ftp * 1.2));
  });

  it('lists activities newest first with totals and filters', async () => {
    const all = await json('/activities?limit=2');
    expect(all.items.length).toBe(2);
    expect(all.totals.count).toBeGreaterThanOrEqual(3);
    expect(all.items[0].startedAt >= all.items[1].startedAt).toBe(true);
    const next = await json(`/activities?limit=2&cursor=${encodeURIComponent(all.nextCursor)}`);
    expect(next.items[0].id).not.toBe(all.items[0].id);
    const runs = await json('/activities?sport=run');
    expect(runs.items.every((a: Activity) => a.sport === 'run')).toBe(true);
    const q = await json('/activities?q=Gym');
    expect(q.items.length).toBe(1);
  });
});
