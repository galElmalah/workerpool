/** Integration: strength / yoga / other load cascade RPE → HR → duration, updated by PATCH rpe. */
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { addDays } from '@cadence/core/time';
import { getToday } from '../worker/services/context';
import { insertThreshold } from '../worker/db/thresholds';
import { json } from './helpers';

const manual = async (body: Record<string, unknown>) => {
  const today = await getToday(env);
  return json('/activities/manual', { method: 'POST', body: { localDate: addDays(today, -1), startTime: '18:00', title: 'Session', durationSec: 3600, ...body } });
};

beforeAll(async () => {
  for (const [kind, value] of [['lthr', 165], ['hr_max', 190], ['hr_rest', 48]] as const) {
    await insertThreshold(env.DB, { kind, sport: 'all', value, effectiveFrom: '2020-01-01', source: 'manual' });
  }
});

describe('no-power/no-pace load cascade', () => {
  it('strength without RPE or HR falls back to duration × intensity; logging RPE later switches to sRPE', async () => {
    const a = await manual({ sport: 'strength' });
    expect(a.loadSource).toBe('duration');
    const before = a.load;
    const p = await json(`/activities/${a.id}`, { method: 'PATCH', body: { rpe: 8 } });
    expect(p.rpe).toBe(8);
    expect(p.loadSource).toBe('rpe');
    expect(p.load).not.toBe(before);
    expect(p.load).toBeGreaterThan(0);
    const harder = await json(`/activities/${a.id}`, { method: 'PATCH', body: { rpe: 10 } });
    expect(harder.load).toBeGreaterThan(p.load);
    // Clearing RPE goes back down the cascade.
    const cleared = await json(`/activities/${a.id}`, { method: 'PATCH', body: { rpe: null } });
    expect(cleared.loadSource).toBe('duration');
  });

  it('strength with HR but no RPE uses HR; RPE takes precedence once logged', async () => {
    const a = await manual({ sport: 'strength', avgHr: 130 });
    expect(a.loadSource).toBe('hr');
    const p = await json(`/activities/${a.id}`, { method: 'PATCH', body: { rpe: 6 } });
    expect(p.loadSource).toBe('rpe');
  });

  it('yoga and other follow the same cascade', async () => {
    for (const sport of ['yoga', 'other']) {
      const a = await manual({ sport, rpe: 3 });
      expect(a.loadSource).toBe('rpe');
      const b = await manual({ sport });
      expect(b.loadSource).toBe('duration');
    }
  });
});
