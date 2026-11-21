import { describe, expect, it } from 'vitest';
import { api, json } from './helpers';

describe('settings', () => {
  it('returns defaults, then patches', async () => {
    const s = await json('/settings');
    expect(s).toMatchObject({ units: 'metric', timezone: 'UTC', onboarded: false });
    const next = await json('/settings', { method: 'PATCH', body: { name: 'Ada', timezone: 'Europe/Berlin', garminAutoPushDays: 10 } });
    expect(next).toMatchObject({ name: 'Ada', timezone: 'Europe/Berlin', garminAutoPushDays: 10, units: 'metric' });
    expect(await json('/settings')).toMatchObject({ name: 'Ada', timezone: 'Europe/Berlin' });
  });

  it('validates patches', async () => {
    const bad = await api('/settings', { method: 'PATCH', body: { units: 'furlongs' } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'validation' } });
    const tz = await api('/settings', { method: 'PATCH', body: { timezone: 'Mars/Olympus' } });
    expect(tz.status).toBe(400);
    const range = await api('/settings', { method: 'PATCH', body: { garminAutoPushDays: 99 } });
    expect(range.status).toBe(400);
  });
});

describe('thresholds & zones', () => {
  let ftpId = '';

  it('adds thresholds and lists newest first', async () => {
    const a = await json('/thresholds', { method: 'POST', body: { kind: 'ftp', sport: 'bike', value: 250, effectiveFrom: '2026-01-01' } });
    expect(a).toMatchObject({ id: expect.stringMatching(/^thr_/), source: 'manual', value: 250 });
    const b = await json('/thresholds', { method: 'POST', body: { kind: 'ftp', sport: 'bike', value: 270, effectiveFrom: '2026-09-01' } });
    ftpId = b.id;
    await json('/thresholds', { method: 'POST', body: { kind: 'lthr', sport: 'run', value: 172, effectiveFrom: '2026-01-01' } });
    await json('/thresholds', { method: 'POST', body: { kind: 'run_threshold', sport: 'run', value: 4.2, effectiveFrom: '2026-01-01' } });
    const list = await json<any[]>('/thresholds');
    expect(list.map((t) => t.effectiveFrom)).toEqual(['2026-09-01', '2026-01-01', '2026-01-01', '2026-01-01']);
  });

  it('replaces a same-day entry for the same kind/sport', async () => {
    await json('/thresholds', { method: 'POST', body: { kind: 'lthr', sport: 'run', value: 174, effectiveFrom: '2026-01-01' } });
    const lthr = (await json<any[]>('/thresholds')).filter((t) => t.kind === 'lthr');
    expect(lthr).toHaveLength(1);
    expect(lthr[0].value).toBe(174);
  });

  it('validates kind/sport combinations and ranges', async () => {
    for (const body of [
      { kind: 'ftp', sport: 'run', value: 250, effectiveFrom: '2026-01-01' },
      { kind: 'weight', sport: 'bike', value: 70, effectiveFrom: '2026-01-01' },
      { kind: 'ftp', sport: 'bike', value: 5000, effectiveFrom: '2026-01-01' },
      { kind: 'ftp', sport: 'bike', value: 250, effectiveFrom: 'yesterday' },
      { kind: 'vo2', sport: 'bike', value: 50, effectiveFrom: '2026-01-01' },
    ]) {
      const res = await api('/thresholds', { method: 'POST', body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json<any>()).error.code).toBe('validation');
    }
  });

  it('resolves zones for a date', async () => {
    const early = await json('/zones?date=2026-03-01');
    expect(early.sports.bike.power).toMatchObject({ threshold: 250, unit: 'W', defaulted: false });
    expect(early.sports.bike.power.zones[1]).toMatchObject({ zone: 2, label: 'Z2', low: 138, high: 187 });
    const late = await json('/zones?date=2026-10-01');
    expect(late.sports.bike.power.threshold).toBe(270);
    expect(late.sports.run.hr).toMatchObject({ threshold: 174, unit: 'bpm', defaulted: false });
    expect(late.sports.run.pace).toMatchObject({ threshold: 4.2, unit: 'mps' });
    expect(late.sports.run.pace.zones[4].low).toBeCloseTo(4.2, 3);
    // no swim CSS → no pace table; HR falls back to cold-start defaults (flagged)
    expect(late.sports.swim.pace).toBeNull();
    expect(late.sports.swim.hr.defaulted).toBe(true);
    expect((await api('/zones?date=nope')).status).toBe(400);
  });

  it('current snapshot per sport', async () => {
    const cur = await json('/thresholds/current');
    expect(cur.sports.bike.ftp).toBe(270);
    expect(cur.sports.run).toMatchObject({ runThresholdMps: 4.2, lthr: 174 });
    expect(cur.sports.swim.swimCssMps).toBeUndefined();
    expect(cur.sports.swim.lthr).toBeUndefined();
  });

  it('deletes thresholds', async () => {
    const del = await json(`/thresholds/${ftpId}`, { method: 'DELETE' });
    expect(del.id).toBe(ftpId);
    expect((await api(`/thresholds/${ftpId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await json('/thresholds/current')).sports.bike.ftp).toBe(250);
  });

  it('re-derives planned totals of absolute-target workouts after a threshold change', async () => {
    const w = await json('/workouts', {
      method: 'POST',
      body: {
        date: '2026-12-01',
        sport: 'bike',
        title: '',
        structure: { steps: [{ kind: 'step', id: 's1', role: 'active', measure: { type: 'time', sec: 3600 }, target: { type: 'power_w', low: 250, high: 250 } }] },
      },
    });
    expect(w.plannedLoad).toBeCloseTo(100, 0);
    await json('/thresholds', { method: 'POST', body: { kind: 'ftp', sport: 'bike', value: 300, effectiveFrom: '2026-11-01' } });
    // the recompute runs in waitUntil; poll briefly
    let load = w.plannedLoad;
    for (let i = 0; i < 40 && load === w.plannedLoad; i++) {
      await new Promise((r) => setTimeout(r, 25));
      load = (await json(`/workouts/${w.id}`)).plannedLoad;
    }
    expect(load).toBeCloseTo(69.4, 0);
  });
});
