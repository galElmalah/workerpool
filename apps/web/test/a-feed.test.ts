import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';
import { parseJumpTargets } from '../worker/routes/search';

async function seed() {
  await json('/day-notes/2026-11-10', { method: 'PUT', body: { body: 'Slept badly, legs ok' } });
  await json('/day-notes/2026-11-12', { method: 'PUT', body: { body: 'Great sleep' } });
  await json('/workouts', { method: 'POST', body: { date: '2026-11-12', sport: 'bike', title: 'Threshold 2x20', plannedDurationSec: 3600, preNote: 'Eat before' } });
  await json('/workouts', { method: 'POST', body: { date: '2026-11-13', sport: 'run', title: 'Easy run', plannedDurationSec: 2400, tags: ['base'] } });
  await json('/week-notes/2026-W46', { method: 'PUT', body: { body: 'Good consistency this week' } });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO activities (id, source, started_at, local_date, sport, title, duration_sec, moving_sec, post_note, rpe, feel, created_at, updated_at)
     VALUES ('act_j1', 'manual', '2026-11-11T07:00:00Z', '2026-11-11', 'run', 'Morning run', 3000, 3000, 'Felt smooth, legs fresh', 4, 4, ?, ?)`,
  )
    .bind(now, now)
    .run();
  await json('/events', { method: 'POST', body: { date: '2027-05-02', name: 'Spring Marathon', priority: 'A', sport: 'run' } });
  await json('/events', { method: 'POST', body: { date: '2027-03-01', name: 'Club 10k', priority: 'C', sport: 'run' } });
}

describe('journal', () => {
  it('returns a unified reverse-chronological feed', async () => {
    await seed();
    const { items, nextCursor } = await json('/journal');
    expect(items.map((i: any) => [i.type, i.date])).toEqual([
      ['week', '2026-11-15'],
      ['day', '2026-11-12'],
      ['workout_pre', '2026-11-12'],
      ['activity_post', '2026-11-11'],
      ['day', '2026-11-10'],
    ]);
    expect(nextCursor).toBeNull();
    expect(items[3]).toMatchObject({ title: 'Morning run', body: 'Felt smooth, legs fresh', ref: 'act_j1', rpe: 4, feel: 4, sport: 'run' });
    expect(items[0]).toMatchObject({ ref: '2026-W46', title: 'Week 46 reflection' });
  });

  it('paginates with a cursor without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: any = await json(`/journal?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.items.map((x: any) => `${x.type}:${x.ref}`));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await api('/journal?cursor=garbage')).status).toBe(400);
  });

  it('filters by type and searches text', async () => {
    const days = await json('/journal?type=day');
    expect(days.items.every((i: any) => i.type === 'day')).toBe(true);
    const legs = await json('/journal?q=legs');
    expect(legs.items.map((i: any) => i.type).sort()).toEqual(['activity_post', 'day']);
    const multi = await json('/journal?type=day,week&q=sle');
    expect(multi.items.map((i: any) => i.date)).toEqual(['2026-11-12', '2026-11-10']);
    expect((await api('/journal?type=tweets')).status).toBe(400);
  });
});

describe('search', () => {
  it('parses jump targets', () => {
    const today = '2026-11-21';
    const events = [{ id: 'evt_1', date: '2027-05-02', name: 'Spring Marathon', priority: 'A' as const }];
    expect(parseJumpTargets('dec 24', today, [])[0]).toMatchObject({ type: 'date', date: '2026-12-24', href: '/calendar/day/2026-12-24' });
    expect(parseJumpTargets('24 December 2027', today, [])[0]).toMatchObject({ date: '2027-12-24' });
    expect(parseJumpTargets('jan 3', today, [])[0].date).toBe('2027-01-03');
    expect(parseJumpTargets('w52', today, [])[0]).toMatchObject({ type: 'week', id: '2026-W52', href: '/calendar/week/2026-W52' });
    expect(parseJumpTargets('2027-W02', today, [])[0].id).toBe('2027-W02');
    expect(parseJumpTargets('+8w', today, [])[0].id).toBe('2027-W02'); // 2026 has 53 ISO weeks
    expect(parseJumpTargets('-3d', today, [])[0].date).toBe('2026-11-18');
    expect(parseJumpTargets('+1m', today, [])[0].date).toBe('2026-12-21');
    expect(parseJumpTargets('tomorrow', today, [])[0].date).toBe('2026-11-22');
    expect(parseJumpTargets('fri', today, [])[0].date).toBe('2026-11-27');
    expect(parseJumpTargets('next mon', today, [])[0].date).toBe('2026-11-23');
    expect(parseJumpTargets('2026-02-30', today, [])).toEqual([]);
    expect(parseJumpTargets('next race', today, events)[0]).toMatchObject({ type: 'event', id: 'evt_1', href: '/events/evt_1' });
    expect(parseJumpTargets('december', today, [])[0]).toMatchObject({ type: 'month', href: '/calendar/month/2026-12' });
    expect(parseJumpTargets('threshold', today, [])).toEqual([]);
  });

  it('returns grouped results', async () => {
    const r = await json('/search?q=threshold');
    const workouts = r.groups.find((g: any) => g.type === 'workouts');
    expect(workouts.items[0]).toMatchObject({ type: 'workout', title: 'Threshold 2x20', date: '2026-11-12' });
    expect(workouts.items[0].href).toMatch(/^\/workouts\/wk_/);

    const run = await json('/search?q=morning');
    expect(run.groups.find((g: any) => g.type === 'activities').items[0]).toMatchObject({ id: 'act_j1', href: '/activities/act_j1' });

    const race = await json('/search?q=next%20race');
    expect(race.groups[0]).toMatchObject({ type: 'jump' });
    expect(race.groups[0].items[0]).toMatchObject({ type: 'event', title: 'Club 10k' });
    const a = await json('/search?q=next%20a%20race');
    expect(a.groups[0].items[0].title).toBe('Spring Marathon');

    const marathon = await json('/search?q=marath');
    expect(marathon.groups.find((g: any) => g.type === 'events').items[0].title).toBe('Spring Marathon');

    // sport words match the sport ("ride" → bike), combined with other words
    const ride = await json('/search?q=ride%20thresh');
    expect(ride.groups.find((g: any) => g.type === 'workouts').items.map((i: any) => i.title)).toEqual(['Threshold 2x20']);

    const dates = await json('/search?q=dec%2024');
    expect(dates.groups[0].items[0].type).toBe('date');
    expect(await json('/search?q=')).toEqual({ q: '', groups: [] });
  });
});
