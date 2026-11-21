import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';

const WIPE = ['thresholds', 'templates', 'events', 'phases', 'day_markers', 'day_notes', 'week_notes', 'wellness_days', 'activities', 'workouts', 'settings'];

describe('data export / import', () => {
  it('round-trips a full backup into an empty database', async () => {
    await json('/settings', { method: 'PATCH', body: { name: 'Backup Tester', units: 'imperial' } });
    await json('/thresholds', { method: 'POST', body: { kind: 'ftp', sport: 'bike', value: 260, effectiveFrom: '2026-01-01' } });
    const w = await json('/workouts', {
      method: 'POST',
      body: {
        date: '2026-12-01',
        sport: 'bike',
        title: 'Over-unders, "hard"',
        preNote: 'line1\nline2',
        tags: ['key', 'vo2'],
        structure: { steps: [{ kind: 'step', id: 's', role: 'active', measure: { type: 'time', sec: 1200 }, target: { type: 'power_pct', low: 95, high: 105 } }] },
      },
    });
    await json('/events', { method: 'POST', body: { date: '2027-05-02', name: 'Marathon', priority: 'A' } });
    await json('/phases', { method: 'POST', body: { type: 'base', label: 'Base', startDate: '2026-11-23', endDate: '2026-12-20' } });
    await json('/markers', { method: 'POST', body: { type: 'sick', date: '2026-11-30' } });
    await json('/day-notes/2026-12-01', { method: 'PUT', body: { body: 'note' } });
    await json('/week-notes/2026-W49', { method: 'PUT', body: { body: 'week', targetLoad: 500 } });
    await json('/wellness/2026-12-01', { method: 'PUT', body: { feel: 3 } });
    await json('/templates'); // seeds the starter library
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO activities (id, source, started_at, local_date, sport, title, duration_sec, moving_sec, has_streams, laps, created_at, updated_at)
       VALUES ('act_x', 'manual', '2026-11-20T07:00:00Z', '2026-11-20', 'run', 'Run', 1800, 1800, 1, '[{"index":0}]', ?, ?)`,
    )
      .bind(now, now)
      .run();

    const res = await api('/export/json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="cadence-backup-\d{4}-\d{2}-\d{2}\.json"/);
    const backup = await res.json<any>();
    expect(backup).toMatchObject({ format: 'cadence-backup', schemaVersion: 1 });
    expect(backup.tables.auth).toBeUndefined();
    expect(backup.tables.garmin_auth).toBeUndefined();
    expect(backup.tables.activity_streams).toBeUndefined();
    expect(backup.tables.workouts).toHaveLength(1);
    expect(backup.counts.templates).toBeGreaterThan(10);

    // importing into a non-empty database is refused
    const refused = await api('/import/json', { method: 'POST', body: backup });
    expect(refused.status).toBe(409);
    expect((await refused.json<any>()).error.code).toBe('not_empty');

    for (const t of WIPE) await env.DB.prepare(`DELETE FROM ${t}`).run();
    expect((await json<any[]>('/workouts?from=2026-01-01&to=2027-12-31')).length).toBe(0);

    const imp = await json('/import/json', { method: 'POST', body: backup });
    expect(imp.imported).toMatchObject({ workouts: 1, events: 1, phases: 1, day_markers: 1, thresholds: 1, activities: 1, settings: 1 });

    const again = await json('/export/json');
    for (const t of Object.keys(backup.tables)) {
      if (t === 'activities') continue;
      expect(again.tables[t], t).toEqual(backup.tables[t]);
    }
    // streams are not part of a backup, so imported activities have none
    expect(again.tables.activities[0]).toMatchObject({ id: 'act_x', has_streams: 0, laps: '[{"index":0}]' });

    const back = await json(`/workouts/${w.id}`);
    expect(back).toMatchObject({ title: 'Over-unders, "hard"', tags: ['key', 'vo2'], plannedLoad: w.plannedLoad });
    expect((await json('/settings')).name).toBe('Backup Tester');
  });

  it('validates the backup shape', async () => {
    expect((await api('/import/json', { method: 'POST', body: { format: 'other', schemaVersion: 1, tables: {} } })).status).toBe(400);
    expect((await api('/import/json', { method: 'POST', body: { format: 'cadence-backup', schemaVersion: 99, tables: {} } })).status).toBe(400);
    for (const t of WIPE) await env.DB.prepare(`DELETE FROM ${t}`).run();
    const bad = await api('/import/json', { method: 'POST', body: { format: 'cadence-backup', schemaVersion: 1, tables: { auth: [{ id: 1 }] } } });
    expect(bad.status).toBe(400);
    const col = await api('/import/json', {
      method: 'POST',
      body: { format: 'cadence-backup', schemaVersion: 1, tables: { events: [{ id: 'e', date: '2026-01-01', name: 'x', 'name); DROP TABLE x; --': 1 }] } },
    });
    expect(col.status).toBe(400);
  });

  it('exports workouts as CSV', async () => {
    await json('/workouts', { method: 'POST', body: { date: '2026-12-03', sport: 'run', title: 'Tempo, with "quotes"', plannedDurationSec: 2700, intensity: 'tempo' } });
    const res = await api('/export/workouts.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0].split(',').slice(0, 5)).toEqual(['date', 'start_time', 'sport', 'sub_sport', 'title']);
    const row = lines.find((l) => l.startsWith('2026-12-03'))!;
    expect(row).toContain('"Tempo, with ""quotes"""');
    expect(row).toContain('0:45:00');
  });
});
