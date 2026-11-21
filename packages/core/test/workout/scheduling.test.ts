import { describe, expect, it } from 'vitest';
import type { Repeat, Step } from '../../src/domain';
import {
  copyWeek,
  estimateWorkout,
  formatWorkoutText,
  parseWorkoutText,
  repeatWeekly,
  scaleStructure,
  shiftWorkouts,
  stripIds,
  tidyStepMeters,
  tidyStepSeconds,
  tidyTotalMeters,
  tidyTotalSeconds,
} from '../../src/workout';
import { planned } from './fixtures';

const now = '2026-11-21T10:00:00Z';
const s2x20 = parseWorkoutText('- 15m 60%\n2x\n  - 20m 95-100%\n  - 5m 50%\n- 10m 50%', 'bike').structure;

describe('tidy rounding', () => {
  it('steps', () => {
    expect(tidyStepSeconds(31.5)).toBe(30);
    expect(tidyStepSeconds(252)).toBe(255);
    expect(tidyStepSeconds(504)).toBe(510);
    expect(tidyStepSeconds(1260)).toBe(1260);
    expect(tidyStepSeconds(1)).toBe(5);
    expect(tidyStepMeters(840)).toBe(850);
    expect(tidyStepMeters(2100)).toBe(2100);
    expect(tidyStepMeters(105)).toBe(100);
    expect(tidyStepMeters(8800)).toBe(8800);
  });
  it('totals', () => {
    expect(tidyTotalSeconds(3960)).toBe(3900);
    expect(tidyTotalSeconds(1300)).toBe(1320);
    expect(tidyTotalMeters(11000 * 1.1, 'run')).toBe(12000);
    expect(tidyTotalMeters(2750, 'swim')).toBe(2800);
  });
});

describe('scaleStructure', () => {
  it('scales active steps only, keeps ids and counts', () => {
    const s = scaleStructure(s2x20, 1.1);
    const rep = s.steps[1] as Repeat;
    expect((rep.steps[0] as Step).measure).toEqual({ type: 'time', sec: 1320 });
    expect((rep.steps[1] as Step).measure).toEqual({ type: 'time', sec: 300 });
    expect((s.steps[0] as Step).measure).toEqual({ type: 'time', sec: 900 });
    expect(rep.count).toBe(2);
    expect(rep.steps[0].id).toBe((s2x20.steps[1] as Repeat).steps[0].id);
    expect(scaleStructure(s2x20, 1)).toBe(s2x20);
  });
  it('scales distances tidily and can include other roles', () => {
    const run = parseWorkoutText('- 2km z2\n6x\n  - 800m 106%\n  - r 400m', 'run').structure;
    const s = scaleStructure(run, 1.05, { roles: ['active', 'warmup'] });
    expect((s.steps[0] as Step).measure).toEqual({ type: 'distance', m: 2100 });
    expect(((s.steps[1] as Repeat).steps[0] as Step).measure).toEqual({ type: 'distance', m: 850 });
    expect(((s.steps[1] as Repeat).steps[1] as Step).measure).toEqual({ type: 'distance', m: 400 });
  });
  it('leaves strength prescriptions alone', () => {
    const st = parseWorkoutText('Back squat 4x6', 'strength').structure;
    expect(stripIds(scaleStructure(st, 1.2))).toEqual(stripIds(st));
  });
});

describe('copyWeek', () => {
  const week = [
    planned({ id: 'mon', date: '2026-11-16', plannedDurationSec: 3600, plannedLoad: 50, title: 'Endurance 1:00', pairedActivityId: 'act1', garmin: { syncState: 'synced', workoutId: 'g1' }, compliance: { metric: 'load', ratio: 1, state: 'on_target' } }),
    planned({ id: 'wed', date: '2026-11-18', sport: 'bike', structure: s2x20, plannedDurationSec: 4500, plannedLoad: 84, title: 'Threshold', isKey: true, preNote: 'go', seriesId: 's1' }),
    planned({ id: 'sun', date: '2026-11-22', status: 'skipped', skipReason: 'sick', plannedDistanceM: 11000, title: 'Long' }),
    planned({ id: 'next', date: '2026-11-23' }),
  ];
  it('copies the week onto the target week with state reset', () => {
    const out = copyWeek(week, '2026-11-16', '2026-11-30', { now, newId: (() => { let i = 0; return () => `n${++i}`; })() });
    expect(out.map((w) => [w.id, w.date])).toEqual([
      ['n1', '2026-11-30'],
      ['n2', '2026-12-02'],
      ['n3', '2026-12-06'],
    ]);
    expect(out[0].pairedActivityId).toBeUndefined();
    expect(out[0].compliance).toBeUndefined();
    expect(out[0].garmin).toEqual({ syncState: 'none' });
    expect(out[0].createdAt).toBe(now);
    expect(out[1].seriesId).toBeUndefined();
    expect(out[1].isKey).toBe(true);
    expect(out[1].preNote).toBe('go');
    expect(out[2].status).toBe('planned');
    expect(out[2].skipReason).toBeUndefined();
    // structure ids are fresh, content identical at 0 %
    expect(out[1].structure!.steps[0].id).not.toBe(s2x20.steps[0].id);
    expect(stripIds(out[1].structure!)).toEqual(stripIds(s2x20));
    expect(out[1].plannedLoad).toBe(84);
  });
  it('applies progression sensibly', () => {
    const out = copyWeek(week, '2026-11-16', '2026-11-23', { progressionPct: 10, now, includeNotes: false, includeKey: false });
    expect(out[0].plannedDurationSec).toBe(3900); // 66′ → tidy 65′
    expect(out[0].plannedLoad).toBe(55);
    expect(out[0].title).toBe('Endurance 1:05'); // auto title follows
    expect(out[2].plannedDistanceM).toBe(12000);
    expect(out[2].title).toBe('Long'); // user title kept
    const st = out[1].structure!;
    expect(formatWorkoutText(st, 'bike')).toBe('- 15m 60%\n2x\n  - 22m 95-100%\n  - 5m 50%\n- 10m 50%');
    // totals follow the structure change: 75′ → 79′
    expect(out[1].plannedDurationSec).toBe(Math.round((4500 * 4740) / 4500));
    expect(out[1].isKey).toBe(false);
    expect(out[1].preNote).toBeUndefined();
  });
  it('recomputes exact totals when thresholds are given', () => {
    const out = copyWeek(week, '2026-11-16', '2026-11-23', { progressionPct: 10, now, thresholds: { ftp: 250 } });
    const e = estimateWorkout(out[1].structure!, 'bike', { ftp: 250 });
    expect(out[1].plannedDurationSec).toBe(4740);
    expect(out[1].plannedLoad).toBeCloseTo(e.load, 1);
  });
});

describe('shiftWorkouts', () => {
  it('moves planned items from a date, never completed ones, flags Garmin re-schedule', () => {
    const ws = [
      planned({ id: 'a', date: '2026-11-17' }),
      planned({ id: 'b', date: '2026-11-18', garmin: { syncState: 'synced', workoutId: 'g', scheduleId: 's' } }),
      planned({ id: 'c', date: '2026-11-19', pairedActivityId: 'x' }),
      planned({ id: 'd', date: '2026-11-20' }),
    ];
    const out = shiftWorkouts(ws, '2026-11-18', 2, { now });
    expect(out.map((w) => w.date)).toEqual(['2026-11-17', '2026-11-20', '2026-11-19', '2026-11-22']);
    expect(out[1].garmin).toEqual({ syncState: 'pending', workoutId: 'g', scheduleId: 's' });
    expect(out[3].garmin).toEqual({ syncState: 'none' });
    expect(out[0]).toBe(ws[0]);
    expect(shiftWorkouts(ws, '2026-11-18', -7)[3].date).toBe('2026-11-13');
  });
});

describe('repeatWeekly', () => {
  it('creates a linked weekly series with compounding progression', () => {
    const w = planned({ id: 'w', date: '2026-11-17', plannedDurationSec: 3600, title: 'Easy' });
    const out = repeatWeekly(w, 3, { progressionPct: 10, seriesId: 'S', now });
    expect(out.map((x) => [x.id === 'w', x.date, x.seriesId, x.plannedDurationSec])).toEqual([
      [true, '2026-11-17', 'S', 3600],
      [false, '2026-11-24', 'S', 3900],
      [false, '2026-12-01', 'S', 4500], // 1.21 h → 72.6′ → 75′ (5′ rounding)
    ]);
    expect(repeatWeekly(w, 1)).toHaveLength(1);
    expect(repeatWeekly(w, 2)[0].seriesId).toMatch(/^series_/);
  });
});
