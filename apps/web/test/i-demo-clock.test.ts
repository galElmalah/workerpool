/** Integration: getToday honours the pinned demo clock (DEMO_MODE=1); real time otherwise. */
import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { todayIn } from '@cadence/core/time';
import { getSettings } from '../worker/db/settings';
import { getToday } from '../worker/services/context';
import { json } from './helpers';

vi.setConfig({ testTimeout: 120_000 });

const SEEDED = '2026-03-10';

describe('demo clock', () => {
  it('POST /demo/seed pins "today" to the seeded date for every route', async () => {
    const p = await json('/demo/seed', { method: 'POST', body: { months: 0.5, seed: 3, fast: true, today: SEEDED } });
    expect(p.today ?? SEEDED).toBe(SEEDED);
    expect(await getToday(env)).toBe(SEEDED);
    expect((await json('/today')).date).toBe(SEEDED);
    expect((await json(`/calendar?from=${SEEDED}&to=${SEEDED}`)).today).toBe(SEEDED);
    expect((await json('/demo/status')).today).toBe(SEEDED);
  });

  it('POST /demo/advance { days: 1 } moves today in /calendar and /today', async () => {
    const r = await json('/demo/advance', { method: 'POST', body: { days: 1 } });
    expect(r.today).toBe('2026-03-11');
    expect((await json('/today')).date).toBe('2026-03-11');
    const cal = await json('/calendar?from=2026-03-09&to=2026-03-15');
    expect(cal.today).toBe('2026-03-11');
    expect(cal.weeks.length).toBeGreaterThan(0);
  });

  it('outside demo mode the stored demo clock is ignored', async () => {
    const settings = await getSettings(env.DB);
    expect(await getToday({ ...env, DEMO_MODE: '0' })).toBe(todayIn(settings.timezone));
  });
});
