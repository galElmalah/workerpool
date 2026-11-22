/** Integration: the fitness model is seeded (no cold start at 0) and every view shares one series. */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import type { FitnessDay } from '@cadence/core/domain';
import { addDays, isoWeekOf } from '@cadence/core/time';
import { getToday } from '../worker/services/context';
import { json } from './helpers';

const LOAD = 60;
const DAYS = 70;

describe('fitness cold start', () => {
  it('a history that starts abruptly at a steady load starts at a believable level', async () => {
    const today = await getToday(env);
    const first = addDays(today, -DAYS);
    for (let i = 0; i < DAYS; i++) {
      await json('/activities/manual', {
        method: 'POST',
        body: { localDate: addDays(first, i), startTime: '07:00', sport: 'bike', title: 'Steady ride', durationSec: 3600, load: LOAD },
      });
    }
    const res = await json(`/trends/fitness?from=${first}&to=${addDays(first, 59)}`);
    const days: FitnessDay[] = res.days;
    expect(days[0].date).toBe(first);
    expect(days[0].fitness).toBeGreaterThan(0);
    expect(days[0].fitness).toBeCloseTo(LOAD, 0);
    for (const d of days.slice(0, 14)) {
      expect(d.formPct).not.toBeNull();
      expect(d.formPct!).toBeGreaterThanOrEqual(-30);
    }
    // A steady load keeps Form near zero throughout the first two months.
    for (const d of days) expect(Math.abs(d.form)).toBeLessThan(5);
    // The seed does not depend on the requested range.
    const narrow = await json(`/trends/fitness?from=${addDays(first, 3)}&to=${addDays(first, 5)}`);
    expect(narrow.days[0].fitness).toBe(days[3].fitness);
  });

  it('week summaries, /today and /trends/fitness use the same seeded series', async () => {
    const today = await getToday(env);
    const t = await json(`/trends/fitness?from=${addDays(today, -7)}&to=${today}`);
    const fToday: FitnessDay = t.days.find((d: FitnessDay) => d.date === today);
    const td = await json('/today');
    expect(td.fitness.fitness).toBe(fToday.fitness);
    expect(td.fitness.formPct).toBe(fToday.formPct);
    const wk = await json(`/weeks/${isoWeekOf(today)}`);
    const summary = wk.summary ?? wk.week ?? wk;
    expect(summary.fitness).toBeCloseTo(td.week.fitness, 5);
    const yesterday = addDays(today, -1);
    const cal = await json(`/calendar?from=${yesterday}&to=${yesterday}`);
    const fy: FitnessDay = t.days.find((d: FitnessDay) => d.date === yesterday);
    expect(fy.fitness).toBeGreaterThan(LOAD * 0.9);
    expect(cal.weeks.length).toBeGreaterThan(0);
  });
});
