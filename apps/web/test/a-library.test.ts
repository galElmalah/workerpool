import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES } from '@cadence/core/workout';
import { api, json } from './helpers';

const structure = {
  steps: [
    { kind: 'step', id: 'a', role: 'warmup', measure: { type: 'time', sec: 600 }, target: { type: 'power_pct', low: 55, high: 55 } },
    { kind: 'step', id: 'b', role: 'active', measure: { type: 'time', sec: 1800 }, target: { type: 'power_pct', low: 88, high: 92 } },
  ],
};

describe('templates', () => {
  it('auto-seeds the starter library on the first GET', async () => {
    const list = await json<any[]>('/templates');
    expect(list).toHaveLength(STARTER_TEMPLATES.length);
    const t = list.find((x) => x.id === `tpl_${STARTER_TEMPLATES[0].key}`);
    expect(t).toMatchObject({ sport: STARTER_TEMPLATES[0].sport, usageCount: 0 });
    expect(t.plannedDurationSec).toBeGreaterThan(0);
    expect(t.plannedLoad).toBeGreaterThan(0);
    expect(t.sparkline).toBeUndefined();
  });

  it('seed-starter is idempotent; a deleted starter is not re-added by GET', async () => {
    const again = await json('/templates/seed-starter', { method: 'POST' });
    expect(again.installed).toBe(0);
    const id = `tpl_${STARTER_TEMPLATES[0].key}`;
    expect((await json(`/templates/${id}`, { method: 'DELETE' })).id).toBe(id);
    expect((await json<any[]>('/templates')).some((t) => t.id === id)).toBe(false);
    expect((await json('/templates/seed-starter', { method: 'POST' })).installed).toBe(1);
  });

  it('filters by sport, intensity and text', async () => {
    const runs = await json<any[]>('/templates?sport=run');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((t) => t.sport === 'run')).toBe(true);
    const rec = await json<any[]>('/templates?intensity=recovery');
    expect(rec.every((t) => t.intensity === 'recovery')).toBe(true);
    const q = await json<any[]>('/templates?q=recovery%20spin');
    expect(q.map((t) => t.id)).toContain('tpl_bike-recovery-45');
    expect((await api('/templates?sport=car')).status).toBe(400);
  });

  let tplId = '';
  it('creates, patches and derives totals', async () => {
    const t = await json('/templates', { method: 'POST', body: { sport: 'bike', title: '', structure, folder: 'Mine', tags: ['tempo'] } });
    tplId = t.id;
    expect(t.id).toMatch(/^tpl_/);
    expect(t.plannedDurationSec).toBe(2400);
    expect(t.title).toBeTruthy();
    expect(t.intensity).toBe('tempo');
    const p = await json(`/templates/${t.id}`, { method: 'PATCH', body: { title: 'Sweet spot 30', folder: null } });
    expect(p).toMatchObject({ title: 'Sweet spot 30', plannedDurationSec: 2400 });
    expect(p.folder).toBeUndefined();
    expect((await api('/templates', { method: 'POST', body: { title: 'x' } })).status).toBe(400);
    expect((await api('/templates/tpl_nope')).status).toBe(404);
  });

  it('schedules a template, bumping usage', async () => {
    const r = await json(`/templates/${tplId}/schedule`, { method: 'POST', body: { date: '2026-12-01' } });
    expect(r.workouts).toHaveLength(1);
    expect(r.workouts[0]).toMatchObject({ date: '2026-12-01', title: 'Sweet spot 30', templateId: tplId, plannedDurationSec: 2400 });
    expect(r.template.usageCount).toBe(1);
    expect(r.template.lastUsedAt).toBeTruthy();
    const multi = await json(`/templates/${tplId}/schedule`, { method: 'POST', body: { dates: ['2026-12-08', '2026-12-15'] } });
    expect(multi.workouts).toHaveLength(2);
    expect(multi.template.usageCount).toBe(3);
    expect((await api(`/templates/${tplId}/schedule`, { method: 'POST', body: {} })).status).toBe(400);
  });

  it('saves a workout to the library', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-02', sport: 'run', title: 'Hill reps', isKey: true, structure, description: 'Find a 6% hill' } });
    const t = await json(`/templates/from-workout/${w.id}`, { method: 'POST', body: { folder: 'Run' } });
    expect(t).toMatchObject({ sport: 'run', title: 'Hill reps', description: 'Find a 6% hill', folder: 'Run', usageCount: 0 });
    expect(t.tags).toContain('key');
    expect(t.structure.steps).toHaveLength(2);
    expect((await api('/templates/from-workout/wk_nope', { method: 'POST', body: {} })).status).toBe(404);
  });

  it('delete + restore', async () => {
    const del = await json(`/templates/${tplId}`, { method: 'DELETE' });
    expect((await api(`/templates/${tplId}`)).status).toBe(404);
    await json('/templates/restore', { method: 'POST', body: { templates: [del] } });
    expect((await json(`/templates/${tplId}`)).usageCount).toBe(3);
  });
});

describe('furniture', () => {
  it('events CRUD', async () => {
    const e = await json('/events', { method: 'POST', body: { date: '2027-06-20', name: 'Half Ironman', priority: 'A', sport: 'other', location: 'Nice' } });
    expect(e.id).toMatch(/^evt_/);
    const p = await json(`/events/${e.id}`, { method: 'PATCH', body: { goal: 'sub 5', location: null } });
    expect(p).toMatchObject({ goal: 'sub 5', name: 'Half Ironman' });
    expect(p.location).toBeUndefined();
    expect((await json<any[]>('/events?from=2027-06-01&to=2027-06-30')).map((x) => x.id)).toEqual([e.id]);
    expect((await json<any[]>('/events')).length).toBe(1);
    expect((await api('/events', { method: 'POST', body: { date: '2027-06-20', name: 'X', priority: 'Z' } })).status).toBe(400);
    expect((await json(`/events/${e.id}`, { method: 'DELETE' })).id).toBe(e.id);
    expect((await api(`/events/${e.id}`)).status).toBe(404);
  });

  it('phases must run Monday → Sunday', async () => {
    const ok = await json('/phases', { method: 'POST', body: { type: 'base', label: 'Base 1', startDate: '2026-11-23', endDate: '2026-12-20' } });
    expect(ok.id).toMatch(/^ph_/);
    const notMonday = await api('/phases', { method: 'POST', body: { type: 'build', label: 'B', startDate: '2026-11-24', endDate: '2026-12-20' } });
    expect(notMonday.status).toBe(400);
    const notSunday = await api('/phases', { method: 'POST', body: { type: 'build', label: 'B', startDate: '2026-11-23', endDate: '2026-12-19' } });
    expect(notSunday.status).toBe(400);
    const reversed = await api('/phases', { method: 'POST', body: { type: 'build', label: 'B', startDate: '2026-12-21', endDate: '2026-12-13' } });
    expect(reversed.status).toBe(400);
    expect((await json<any[]>('/phases?from=2026-12-01&to=2026-12-05')).map((p) => p.id)).toEqual([ok.id]);
    expect((await api(`/phases/${ok.id}`, { method: 'PATCH', body: { endDate: '2026-12-16' } })).status).toBe(400);
    expect((await json(`/phases/${ok.id}`, { method: 'PATCH', body: { weeklyLoadTarget: 450 } })).weeklyLoadTarget).toBe(450);
    expect((await json(`/phases/${ok.id}`, { method: 'DELETE' })).id).toBe(ok.id);
  });

  it('markers with ranges', async () => {
    const m = await json('/markers', { method: 'POST', body: { type: 'travel', date: '2026-12-10', endDate: '2026-12-14', label: 'Lisbon' } });
    expect((await json<any[]>('/markers?from=2026-12-12&to=2026-12-12')).map((x) => x.id)).toEqual([m.id]);
    expect((await api('/markers', { method: 'POST', body: { type: 'sick', date: '2026-12-10', endDate: '2026-12-01' } })).status).toBe(400);
    const p = await json(`/markers/${m.id}`, { method: 'PATCH', body: { endDate: null } });
    expect(p.endDate).toBeUndefined();
    expect((await json(`/markers/${m.id}`, { method: 'DELETE' })).id).toBe(m.id);
  });

  it('day notes', async () => {
    const n = await json('/day-notes/2026-12-01', { method: 'PUT', body: { body: 'Legs heavy' } });
    expect(n).toMatchObject({ date: '2026-12-01', body: 'Legs heavy' });
    expect((await json('/day-notes/2026-12-01')).body).toBe('Legs heavy');
    const del = await json('/day-notes/2026-12-01', { method: 'DELETE' });
    expect(del.deleted.body).toBe('Legs heavy');
    expect(await json('/day-notes/2026-12-01')).toBeNull();
    expect((await api('/day-notes/12-01', { method: 'PUT', body: { body: 'x' } })).status).toBe(400);
  });

  it('week notes', async () => {
    expect(await json('/week-notes/2026-W49')).toBeNull();
    const w = await json('/week-notes/2026-W49', { method: 'PUT', body: { body: 'Solid week', targetHours: 9 } });
    expect(w).toMatchObject({ isoWeek: '2026-W49', body: 'Solid week', targetHours: 9 });
    const w2 = await json('/week-notes/2026-W49', { method: 'PUT', body: { body: 'Solid week!' } });
    expect(w2.targetHours).toBe(9);
    expect((await json('/week-notes/2026-W49', { method: 'PUT', body: { body: 'x', targetHours: null } })).targetHours).toBeUndefined();
    expect((await api('/week-notes/2026-49', { method: 'PUT', body: { body: 'x' } })).status).toBe(400);
  });

  it('wellness check-in only touches manual fields', async () => {
    expect(await json('/wellness/2026-12-02')).toEqual({ date: '2026-12-02' });
    const w = await json('/wellness/2026-12-02', { method: 'PUT', body: { feel: 4, soreness: 2, note: 'ok', weightKg: 71.2 } });
    expect(w).toMatchObject({ date: '2026-12-02', feel: 4, soreness: 2, note: 'ok', weightKg: 71.2 });
    const w2 = await json('/wellness/2026-12-02', { method: 'PUT', body: { note: null } });
    expect(w2.note).toBeUndefined();
    expect(w2.feel).toBe(4);
    expect((await api('/wellness/2026-12-02', { method: 'PUT', body: { feel: 9 } })).status).toBe(400);
    const strict = await api('/wellness/2026-12-02', { method: 'PUT', body: { hrvMs: 80 } });
    expect(strict.status).toBe(200);
    expect((await strict.json<any>()).hrvMs).toBeUndefined();
  });
});
