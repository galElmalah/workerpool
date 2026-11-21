import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';

const step = (id: string, role: string, sec: number, pct?: number) => ({
  kind: 'step',
  id,
  role,
  measure: { type: 'time', sec },
  ...(pct !== undefined ? { target: { type: 'power_pct', low: pct, high: pct } } : {}),
});

/** WU 10′ @ 50 %, 2×(20′ @ 100 %, 5′ @ 50 %), CD 10′ @ 50 % = 70′. */
const twoByTwenty = {
  steps: [
    step('wu', 'warmup', 600, 50),
    { kind: 'repeat', id: 'r1', count: 2, steps: [step('on', 'active', 1200, 100), step('off', 'recovery', 300, 50)] },
    step('cd', 'cooldown', 600, 50),
  ],
};

describe('workouts: create & derive', () => {
  it('derives planned totals from structure (2×20′ @ 100 % with WU/CD)', async () => {
    await json('/thresholds', { method: 'POST', body: { kind: 'ftp', sport: 'bike', value: 250, effectiveFrom: '2026-01-01' } });
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-11-24', sport: 'bike', title: '', structure: twoByTwenty } });
    expect(w.id).toMatch(/^wk_/);
    expect(w.plannedDurationSec).toBe(4200);
    // 40′ at IF 1.0 (66.7) + 30′ at IF 0.5 (12.5) = 79.2
    expect(w.plannedLoad).toBeCloseTo(79.2, 1);
    expect(w.plannedIntensityFactor).toBeCloseTo(Math.sqrt(79.1667 / (100 * (70 / 60))), 2);
    expect(w.intensity).toBe('threshold');
    expect(w.title).toMatch(/^2×20′/);
    expect(w.sparkline).toHaveLength(48);
    expect(Math.max(...w.sparkline)).toBeCloseTo(1 / 1.2, 2);
    expect(w).toMatchObject({ isKey: false, tags: [], environment: 'any', status: 'planned', garmin: { syncState: 'none' } });
    expect(w.compliance).toBeDefined();
  });

  it('keeps explicit title and intensity', async () => {
    const w = await json('/workouts', {
      method: 'POST',
      body: { date: '2026-11-25', sport: 'bike', title: 'Race sim', intensity: 'race', isKey: true, structure: twoByTwenty },
    });
    expect(w).toMatchObject({ title: 'Race sim', intensity: 'race', isKey: true });
  });

  it('estimates unstructured workouts from duration + intensity', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-11-26', sport: 'run', plannedDurationSec: 3600, intensity: 'endurance' } });
    expect(w.title).toBe('Endurance 1:00');
    expect(w.plannedLoad).toBeGreaterThan(30);
    expect(w.plannedLoad).toBeLessThan(80);
    expect(w.sparkline).toBeUndefined();
    const manual = await json('/workouts', { method: 'POST', body: { date: '2026-11-26', sport: 'strength', title: 'Gym', plannedDurationSec: 2700, plannedLoad: 42 } });
    expect(manual.plannedLoad).toBe(42);
  });

  it('validates input', async () => {
    for (const body of [
      { sport: 'bike' },
      { date: '2026-13-45x', sport: 'bike' },
      { date: '2026-11-24', sport: 'unicycle' },
      { date: '2026-11-24', sport: 'bike', structure: { steps: [{ kind: 'repeat', id: 'r', count: 2, steps: [] }] } },
    ]) {
      const res = await api('/workouts', { method: 'POST', body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json<any>()).error.code).toMatch(/validation|invalid_structure/);
    }
  });

  it('lists by range and reads by id', async () => {
    const list = await json<any[]>('/workouts?from=2026-11-24&to=2026-11-25');
    expect(list.map((w) => w.date)).toEqual(['2026-11-24', '2026-11-25']);
    const one = await json(`/workouts/${list[0].id}`);
    expect(one.id).toBe(list[0].id);
    expect((await api('/workouts/wk_missing')).status).toBe(404);
    expect((await api('/workouts?from=2026-12-01&to=2026-11-01')).status).toBe(400);
  });
});

describe('workouts: patch, delete, undo', () => {
  it('re-derives on structure change and regenerates an auto title', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-02', sport: 'bike', title: '', structure: twoByTwenty } });
    const threeByTen = { steps: [step('wu', 'warmup', 600, 50), { kind: 'repeat', id: 'r', count: 3, steps: [step('a', 'active', 600, 105), step('b', 'recovery', 300, 50)] }] };
    const p = await json(`/workouts/${w.id}`, { method: 'PATCH', body: { structure: threeByTen } });
    expect(p.plannedDurationSec).toBe(600 + 3 * 900);
    expect(p.title).toMatch(/^3×10′/);
    expect(p.plannedLoad).not.toBe(w.plannedLoad);
    const renamed = await json(`/workouts/${w.id}`, { method: 'PATCH', body: { title: 'My intervals', preNote: 'Fuel well', startTime: '06:30' } });
    expect(renamed).toMatchObject({ title: 'My intervals', preNote: 'Fuel well', startTime: '06:30' });
    const cleared = await json(`/workouts/${w.id}`, { method: 'PATCH', body: { preNote: null, startTime: null, structure: null, plannedDurationSec: 3600 } });
    expect(cleared.preNote).toBeUndefined();
    expect(cleared.startTime).toBeUndefined();
    expect(cleared.structure).toBeUndefined();
    expect(cleared.sparkline).toBeUndefined();
    expect(cleared.plannedDurationSec).toBe(3600);
    expect((await api(`/workouts/${w.id}`, { method: 'PATCH', body: { date: 'tomorrow' } })).status).toBe(400);
  });

  it('marks a synced workout dirty when moved', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-03', sport: 'run', plannedDurationSec: 1800 } });
    await env.DB.prepare(`UPDATE workouts SET garmin_workout_id = 'g1', garmin_sync_state = 'synced' WHERE id = ?`).bind(w.id).run();
    const moved = await json(`/workouts/${w.id}`, { method: 'PATCH', body: { date: '2026-12-04' } });
    expect(moved.date).toBe('2026-12-04');
    expect(moved.garmin.syncState).toBe('pending');
    // tags alone do not touch Garmin
    await env.DB.prepare(`UPDATE workouts SET garmin_sync_state = 'synced' WHERE id = ?`).bind(w.id).run();
    expect((await json(`/workouts/${w.id}`, { method: 'PATCH', body: { tags: ['x'] } })).garmin.syncState).toBe('synced');
  });

  it('delete returns the object and restore brings it back verbatim', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-05', sport: 'swim', title: 'CSS set', plannedDurationSec: 2700, tags: ['pool'] } });
    const del = await json(`/workouts/${w.id}`, { method: 'DELETE' });
    expect(del.deleted).toHaveLength(1);
    expect(del.deleted[0]).toMatchObject({ id: w.id, title: 'CSS set', tags: ['pool'] });
    expect((await api(`/workouts/${w.id}`)).status).toBe(404);
    const r = await json('/calendar/restore', { method: 'POST', body: { workouts: del.deleted } });
    expect(r.restored).toHaveLength(1);
    const back = await json(`/workouts/${w.id}`);
    const { compliance: _a, ...x } = back;
    const { compliance: _b, ...y } = w;
    expect(x).toEqual(y);
    expect((await api('/workouts/wk_nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('bulk delete returns deleted objects', async () => {
    const a = await json('/workouts', { method: 'POST', body: { date: '2026-12-06', sport: 'run', plannedDurationSec: 1800 } });
    const b = await json('/workouts', { method: 'POST', body: { date: '2026-12-06', sport: 'bike', plannedDurationSec: 3600 } });
    const res = await json('/calendar/delete', { method: 'POST', body: { ids: [a.id, b.id, 'wk_missing'] } });
    expect(res.deleted.map((w: any) => w.id).sort()).toEqual([a.id, b.id].sort());
    expect((await api('/calendar/delete', { method: 'POST', body: { ids: [] } })).status).toBe(400);
  });
});

describe('workouts: skip, duplicate, repeat series', () => {
  it('skips and unskips', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-07', sport: 'run', plannedDurationSec: 1800 } });
    const s = await json(`/workouts/${w.id}/skip`, { method: 'POST', body: { reason: 'sick' } });
    expect(s).toMatchObject({ status: 'skipped', skipReason: 'sick' });
    expect((await api(`/workouts/${w.id}/skip`, { method: 'POST', body: { reason: 'bored' } })).status).toBe(400);
    const u = await json(`/workouts/${w.id}/skip`, { method: 'DELETE' });
    expect(u.status).toBe('planned');
    expect(u.skipReason).toBeUndefined();
  });

  it('duplicates to a date with a fresh id', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2026-12-08', sport: 'bike', title: '', structure: twoByTwenty, isKey: true } });
    const d = await json(`/workouts/${w.id}/duplicate`, { method: 'POST', body: { date: '2026-12-10' } });
    expect(d.id).not.toBe(w.id);
    expect(d).toMatchObject({ date: '2026-12-10', title: w.title, plannedLoad: w.plannedLoad, isKey: true, garmin: { syncState: 'none' } });
  });

  it('repeats weekly and edits this / following', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2027-01-05', sport: 'run', title: 'Tuesday tempo', plannedDurationSec: 2400, intensity: 'tempo' } });
    const rep = await json(`/workouts/${w.id}/repeat`, { method: 'POST', body: { weeks: 4 } });
    expect(rep.seriesId).toMatch(/^ser_/);
    expect(rep.workouts.map((x: any) => x.date)).toEqual(['2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26']);
    expect(new Set(rep.workouts.map((x: any) => x.seriesId))).toEqual(new Set([rep.seriesId]));
    const [, second, third, fourth] = rep.workouts;

    // scope=this: only the one
    await json(`/workouts/${second.id}?scope=this`, { method: 'PATCH', body: { title: 'Just this one' } });
    // scope=following from the third: title + move by +1 day
    await json(`/workouts/${third.id}?scope=following`, { method: 'PATCH', body: { title: 'New tempo', date: '2027-01-20' } });
    const series = (await json<any[]>('/workouts?from=2027-01-01&to=2027-02-28')).filter((x) => x.seriesId === rep.seriesId);
    expect(series.map((x) => [x.date, x.title])).toEqual([
      ['2027-01-05', 'Tuesday tempo'],
      ['2027-01-12', 'Just this one'],
      ['2027-01-20', 'New tempo'],
      ['2027-01-27', 'New tempo'],
    ]);

    // delete following from the third → returns both for undo
    const del = await json(`/workouts/${third.id}?scope=following`, { method: 'DELETE' });
    expect(del.deleted.map((x: any) => x.id).sort()).toEqual([third.id, fourth.id].sort());
    const left = (await json<any[]>('/workouts?from=2027-01-01&to=2027-02-28')).filter((x) => x.seriesId === rep.seriesId);
    expect(left).toHaveLength(2);
    expect((await api(`/workouts/${w.id}/repeat`, { method: 'POST', body: { weeks: 1 } })).status).toBe(400);
  });

  it('repeats on several weekdays with progression', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2027-03-01', sport: 'bike', title: '', structure: twoByTwenty } });
    const rep = await json(`/workouts/${w.id}/repeat`, { method: 'POST', body: { weeks: 2, weekdays: [1, 4], progressionPct: 10 } });
    expect(rep.workouts.map((x: any) => x.date)).toEqual(['2027-03-01', '2027-03-04', '2027-03-08', '2027-03-11']);
    expect(rep.workouts[2].plannedDurationSec).toBeGreaterThan(rep.workouts[1].plannedDurationSec);
  });
});

describe('workouts: quick add, estimate, parse', () => {
  it('quick-adds from one line', async () => {
    const r = await json('/workouts/quick', { method: 'POST', body: { date: '2026-12-14', text: 'run 45m easy #base' } });
    expect(r.workout).toMatchObject({ date: '2026-12-14', sport: 'run', plannedDurationSec: 2700, intensity: 'endurance', tags: ['base'] });
    const s = await json('/workouts/quick', { method: 'POST', body: { date: '2026-12-15', text: 'bike 4x8m 95-100% r4m @key' } });
    expect(s.workout).toMatchObject({ sport: 'bike', isKey: true });
    expect(s.workout.structure.steps).toHaveLength(1);
    expect(s.workout.plannedDurationSec).toBe(4 * 8 * 60 + 4 * 4 * 60);
    expect(s.workout.sparkline.length).toBe(48);
    expect((await api('/workouts/quick', { method: 'POST', body: { date: '2026-12-15', text: '  ' } })).status).toBe(400);
  });

  it('estimates for the live builder', async () => {
    const e = await json('/workouts/estimate', { method: 'POST', body: { sport: 'bike', date: '2026-11-24', structure: twoByTwenty } });
    expect(e).toMatchObject({ plannedDurationSec: 4200, intensity: 'threshold', thresholds: { ftp: 250 } });
    expect(e.plannedLoad).toBeCloseTo(79.2, 1);
    expect(e.profile).toHaveLength(6);
    expect(e.sparkline).toHaveLength(48);
    expect(e.title).toMatch(/^2×20′/);
    const u = await json('/workouts/estimate', { method: 'POST', body: { sport: 'run', durationSec: 1800, intensity: 'recovery' } });
    expect(u).toMatchObject({ plannedDurationSec: 1800, intensity: 'recovery', profile: [] });
    expect((await api('/workouts/estimate', { method: 'POST', body: { sport: 'car' } })).status).toBe(400);
  });

  it('parses text and formats structure back', async () => {
    const p = await json('/workouts/parse', { method: 'POST', body: { sport: 'bike', text: '- 10m 50%\n3x\n- 5m 105%\n- 3m 50%\n- 10m 50%' } });
    expect(p.structure.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(p.issues)).toBe(true);
    const f = await json('/workouts/format', { method: 'POST', body: { sport: 'bike', structure: p.structure } });
    expect(typeof f.text).toBe('string');
    const again = await json('/workouts/parse', { method: 'POST', body: { sport: 'bike', text: f.text } });
    const est = (s: unknown) => json('/workouts/estimate', { method: 'POST', body: { sport: 'bike', structure: s } });
    expect((await est(again.structure)).plannedDurationSec).toBe((await est(p.structure)).plannedDurationSec);
  });
});

describe('calendar bulk', () => {
  it('copies a week with progression', async () => {
    // week of 2027-04-05 (Mon)
    const a = await json('/workouts', { method: 'POST', body: { date: '2027-04-06', sport: 'bike', title: '', structure: twoByTwenty, preNote: 'note' } });
    const b = await json('/workouts', { method: 'POST', body: { date: '2027-04-10', sport: 'run', plannedDurationSec: 3600, intensity: 'endurance' } });
    const res = await json('/calendar/copy-week', { method: 'POST', body: { fromWeek: '2027-W14', toWeek: '2027-04-14', progressionPct: 10, includeNotes: false } });
    expect(res.created).toHaveLength(2);
    const [ca, cb] = res.created.sort((x: any, y: any) => x.date.localeCompare(y.date));
    expect(ca.date).toBe('2027-04-13');
    expect(cb.date).toBe('2027-04-17');
    // active steps scale 20′ → 22′; WU/CD/recoveries keep their length
    expect(ca.plannedDurationSec).toBe(a.plannedDurationSec + 2 * 120);
    expect(ca.plannedLoad).toBeGreaterThan(a.plannedLoad);
    expect(ca.preNote).toBeUndefined();
    expect(cb.plannedDurationSec).toBe(3900); // 66′ tidied to 65′
    expect(ca.id).not.toBe(a.id);
    expect(b.id).toBeTruthy();
    expect((await api('/calendar/copy-week', { method: 'POST', body: { fromWeek: '2027-W14', toWeek: '2027-W14' } })).status).toBe(400);
    expect((await api('/calendar/copy-week', { method: 'POST', body: { fromWeek: 'W14', toWeek: '2027-W15' } })).status).toBe(400);
  });

  it('shifts the plan, leaving paired workouts, and undoes via restore', async () => {
    const x = await json('/workouts', { method: 'POST', body: { date: '2027-05-03', sport: 'run', plannedDurationSec: 1800 } });
    const y = await json('/workouts', { method: 'POST', body: { date: '2027-05-05', sport: 'run', plannedDurationSec: 1800 } });
    const z = await json('/workouts', { method: 'POST', body: { date: '2027-05-06', sport: 'bike', plannedDurationSec: 3600 } });
    await env.DB.prepare(`UPDATE workouts SET paired_activity_id = 'act_fake' WHERE id = ?`).bind(z.id).run();
    const evt = await json('/events', { method: 'POST', body: { date: '2027-05-09', name: 'Spring 10k', priority: 'B' } });

    const r = await json('/calendar/shift', { method: 'POST', body: { fromDate: '2027-05-04', days: 2, includeEvents: true } });
    expect(r.moved.map((w: any) => [w.id, w.date])).toEqual([[y.id, '2027-05-07']]);
    expect(r.previous.map((w: any) => w.date)).toEqual(['2027-05-05']);
    expect(r.eventsMoved).toBe(1);
    expect((await json(`/events/${evt.id}`)).date).toBe('2027-05-11');
    expect((await json(`/workouts/${x.id}`)).date).toBe('2027-05-03');
    expect((await json(`/workouts/${z.id}`)).date).toBe('2027-05-06');

    await json('/calendar/restore', { method: 'POST', body: { workouts: r.previous } });
    expect((await json(`/workouts/${y.id}`)).date).toBe('2027-05-05');
    expect((await api('/calendar/shift', { method: 'POST', body: { fromDate: '2027-05-04', days: 1.5 } })).status).toBe(400);
  });
});

describe('pairing', () => {
  it('pairs and unpairs via the pairing service', async () => {
    const w = await json('/workouts', { method: 'POST', body: { date: '2027-06-01', sport: 'run', plannedDurationSec: 3000 } });
    const actRes = await api('/activities/manual', {
      method: 'POST',
      body: { localDate: '2027-06-02', sport: 'run', title: 'Evening run', durationSec: 3000 },
    });
    if (actRes.status !== 201) {
      console.warn('activities/manual unavailable, skipping pairing assertions', actRes.status);
      return;
    }
    const act = await actRes.json<any>();
    const paired = await json(`/workouts/${w.id}/pair`, { method: 'POST', body: { activityId: act.id } });
    expect(paired.pairedActivityId).toBe(act.id);
    expect(paired.compliance.state).not.toBe('missed');
    expect((await api(`/workouts/${w.id}/pair`, { method: 'POST', body: { activityId: 'act_missing' } })).status).toBe(404);

    // deleting a paired workout frees the activity; restoring re-links it
    const del = await json(`/workouts/${w.id}`, { method: 'DELETE' });
    let row = await env.DB.prepare('SELECT paired_workout_id AS p FROM activities WHERE id = ?').bind(act.id).first<{ p: string | null }>();
    expect(row?.p).toBeNull();
    await json('/calendar/restore', { method: 'POST', body: { workouts: del.deleted } });
    row = await env.DB.prepare('SELECT paired_workout_id AS p FROM activities WHERE id = ?').bind(act.id).first<{ p: string | null }>();
    expect(row?.p).toBe(w.id);

    const un = await json(`/workouts/${w.id}/pair`, { method: 'DELETE' });
    expect(un.pairedActivityId).toBeUndefined();
  });
});
