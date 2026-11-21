import { describe, expect, it } from 'vitest';
import type { DayMarker } from '../../src/domain';
import {
  chooseMetric,
  computeCompliance,
  pairActivities,
  pairScore,
  sportsCompatible,
  stateForRatio,
  unplannedCompliance,
  weeklyCompliance,
} from '../../src/workout';
import { activity, planned } from './fixtures';

const today = '2026-11-21';

describe('stateForRatio (§3.6.3 bands)', () => {
  it.each([
    [0.49, 'off_short'],
    [0.5, 'partial_short'],
    [0.79, 'partial_short'],
    [0.8, 'on_target'],
    [1.0, 'on_target'],
    [1.2, 'on_target'],
    [1.21, 'partial_long'],
    [1.5, 'partial_long'],
    [1.51, 'off_long'],
  ] as const)('%s → %s', (r, s) => expect(stateForRatio(r)).toBe(s));
});

describe('computeCompliance', () => {
  const p = planned({ id: 'p', date: '2026-11-20', plannedLoad: 80, plannedDurationSec: 3600, plannedDistanceM: 10000 });
  it('metric precedence: load → duration → distance', () => {
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', load: 72 }), { today })).toEqual({ metric: 'load', ratio: 0.9, state: 'on_target' });
    // activity without load → duration (moving time)
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', load: 0, movingSec: 2700, durationSec: 3000 }), { today })).toEqual({
      metric: 'duration',
      ratio: 0.75,
      state: 'partial_short',
    });
    const distOnly = planned({ id: 'd', date: '2026-11-20', plannedDistanceM: 10000 });
    expect(computeCompliance(distOnly, activity({ id: 'a', localDate: '2026-11-20', distanceM: 16000 }), { today })).toEqual({
      metric: 'distance',
      ratio: 1.6,
      state: 'off_long',
    });
    expect(chooseMetric(p, undefined, ['distance', 'load'])).toBe('distance');
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', distanceM: 13000 }), { today, metricOrder: ['distance'] }).state).toBe('partial_long');
  });
  it('ratio is rounded to whole % before banding', () => {
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', load: 63.6 }), { today })).toEqual({ metric: 'load', ratio: 0.8, state: 'on_target' });
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', load: 63.5 }), { today }).ratio).toBe(0.79);
    expect(computeCompliance(p, activity({ id: 'a', localDate: '2026-11-20', load: 30 }), { today }).state).toBe('off_short');
  });
  it('paired plan without planned values counts as done', () => {
    const bare = planned({ id: 'b', date: '2026-11-20' });
    expect(computeCompliance(bare, activity({ id: 'a', localDate: '2026-11-20' }), { today })).toEqual({ metric: 'duration', ratio: 1, state: 'on_target' });
  });
  it('unpaired: future/today planned, past missed, excused by marker or skip', () => {
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-22', plannedDurationSec: 60 }), undefined, { today }).state).toBe('planned');
    expect(computeCompliance(planned({ id: 'x', date: today, plannedDurationSec: 60 }), undefined, { today }).state).toBe('planned');
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-20', plannedDurationSec: 60 }), undefined, { today })).toEqual({
      metric: 'duration',
      ratio: 0,
      state: 'missed',
    });
    const markers: DayMarker[] = [
      { id: 'm1', type: 'sick', date: '2026-11-18', endDate: '2026-11-20' },
      { id: 'm2', type: 'rest', date: '2026-11-15' },
    ];
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-19' }), undefined, { today, markers }).state).toBe('excused');
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-15' }), undefined, { today, markers }).state).toBe('missed');
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-10', status: 'skipped', skipReason: 'travel' }), undefined, { today }).state).toBe('excused');
    expect(computeCompliance(planned({ id: 'x', date: '2026-11-25', status: 'skipped' }), undefined, { today }).state).toBe('excused');
  });
  it('unplanned and weekly aggregate', () => {
    expect(unplannedCompliance().state).toBe('unplanned');
    const wk = weeklyCompliance(
      [
        { date: '2026-11-16', compliance: { metric: 'load', ratio: 1.3, state: 'partial_long' } }, // clamped to 1
        { date: '2026-11-17', compliance: { metric: 'load', ratio: 0.6, state: 'partial_short' } },
        { date: '2026-11-18', compliance: { metric: 'load', ratio: 0, state: 'missed' } },
        { date: '2026-11-19', compliance: { metric: 'load', ratio: 0, state: 'excused' } },
        { date: '2026-11-22', compliance: { metric: 'load', ratio: 0, state: 'planned' } },
      ],
      today,
    );
    expect(wk).toBeCloseTo(1.6 / 3);
    expect(weeklyCompliance([], today)).toBeNull();
  });
});

describe('pairing (§3.6.1)', () => {
  it('sportsCompatible', () => {
    expect(sportsCompatible('bike', 'bike')).toBe(true);
    expect(sportsCompatible('run', 'bike')).toBe(false);
    expect(sportsCompatible('other', 'other')).toBe(false);
  });
  it('pairScore formula', () => {
    const p = planned({ id: 'p', date: today, plannedDurationSec: 3600, startTime: '07:00', tags: ['long'] });
    expect(pairScore(p, activity({ id: 'a', localDate: today, movingSec: 3600, tags: ['long'] }))).toBeCloseTo(1);
    // 30 % off, 90 min late, no tag → 0.5·0.7 + 0.3·0.5 + 0 = 0.5
    expect(pairScore(p, activity({ id: 'a', localDate: today, movingSec: 2520, startedAt: `${today}T08:30:00Z` }))).toBeCloseTo(0.5);
    // no planned start → proximity 0.5; local time uses utcOffset
    const ns = planned({ id: 'q', date: today, plannedDurationSec: 3600 });
    expect(pairScore(ns, activity({ id: 'a', localDate: today }))).toBeCloseTo(0.65);
    expect(pairScore({ ...p, tags: [] }, activity({ id: 'a', localDate: today, startedAt: `${today}T06:00:00Z`, utcOffsetMin: 60 }))).toBeCloseTo(0.8);
    // planned title equal to activity title counts as a match
    expect(pairScore({ ...ns, title: 'Morning Run' }, activity({ id: 'a', localDate: today }))).toBeCloseTo(0.85);
  });
  it('pairs the obvious candidate on the same date and compatible sport', () => {
    const r = pairActivities(
      [planned({ id: 'run', date: today, plannedDurationSec: 3600 }), planned({ id: 'bike', date: today, sport: 'bike', plannedDurationSec: 3600 })],
      [activity({ id: 'a', localDate: today })],
    );
    expect(r.pairs).toEqual([{ plannedId: 'run', activityId: 'a', score: 0.65, manual: false }]);
    expect(r.unpairedPlannedIds).toEqual(['bike']);
    expect(r.unpairedActivityIds).toEqual([]);
  });
  it('different dates, "other" sport and low scores stay unplanned', () => {
    expect(pairActivities([planned({ id: 'p', date: '2026-11-20', plannedDurationSec: 3600 })], [activity({ id: 'a', localDate: today })]).pairs).toEqual([]);
    expect(
      pairActivities([planned({ id: 'p', date: today, sport: 'other', plannedDurationSec: 3600 })], [activity({ id: 'a', localDate: today, sport: 'other' })]).pairs,
    ).toEqual([]);
    // duration way off (sim 0), no start time (0.15), no match → 0.15 < 0.35
    const r = pairActivities([planned({ id: 'p', date: today, plannedDurationSec: 600 })], [activity({ id: 'a', localDate: today, movingSec: 7200 })]);
    expect(r.pairs).toEqual([]);
    expect(r.unpairedActivityIds).toEqual(['a']);
  });
  it('one-to-one, best scores first', () => {
    const r = pairActivities(
      [
        planned({ id: 'short', date: today, plannedDurationSec: 1800, startTime: '18:00' }),
        planned({ id: 'long', date: today, plannedDurationSec: 5400, startTime: '07:00' }),
      ],
      [
        activity({ id: 'am', localDate: today, movingSec: 5000, startedAt: `${today}T07:05:00Z` }),
        activity({ id: 'pm', localDate: today, movingSec: 1900, startedAt: `${today}T18:10:00Z` }),
      ],
    );
    expect(r.pairs.map((x) => `${x.plannedId}:${x.activityId}`).sort()).toEqual(['long:am', 'short:pm']);
  });
  it('never overrides existing (manual) pairs; manualPlannedIds allows re-evaluating auto pairs', () => {
    const plans = [
      planned({ id: 'p1', date: today, plannedDurationSec: 3600, pairedActivityId: 'a2' }),
      planned({ id: 'p2', date: today, plannedDurationSec: 3000 }),
    ];
    const acts = [
      activity({ id: 'a1', localDate: today, movingSec: 3600 }),
      activity({ id: 'a2', localDate: '2026-11-19', movingSec: 1200, pairedWorkoutId: 'p1' }),
    ];
    const r = pairActivities(plans, acts);
    expect(r.pairs).toContainEqual({ plannedId: 'p1', activityId: 'a2', manual: true });
    expect(r.pairs.find((x) => x.activityId === 'a1')?.plannedId).toBe('p2');
    const re = pairActivities(plans, acts, { manualPlannedIds: [] });
    expect(re.pairs.find((x) => x.activityId === 'a1')?.plannedId).toBe('p1');
  });
  it('skipped plans are not auto-paired', () => {
    const r = pairActivities([planned({ id: 'p', date: today, plannedDurationSec: 3600, status: 'skipped' })], [activity({ id: 'a', localDate: today })]);
    expect(r.pairs).toEqual([]);
  });
});
