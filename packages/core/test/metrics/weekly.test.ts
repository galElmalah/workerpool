import { describe, expect, it } from 'vitest';
import type { Activity, PlannedWorkout, WeekSummary } from '../../src/domain';
import {
  buildFitnessSeries,
  buildWeekSummaries,
  complianceRatio,
  dayStreak,
  rollingAverage,
  weekStreak,
  weeklyConsistency,
} from '../../src/metrics';
import { near } from './helpers';

const NOW = '2026-11-21T07:00:00Z';

function wo(p: Partial<PlannedWorkout> & Pick<PlannedWorkout, 'id' | 'date' | 'sport'>): PlannedWorkout {
  return {
    title: p.id,
    isKey: false,
    intensity: 'endurance',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

function act(p: Partial<Activity> & Pick<Activity, 'id' | 'localDate' | 'sport'>): Activity {
  return {
    source: 'manual',
    startedAt: `${p.localDate}T07:00:00Z`,
    utcOffsetMin: 0,
    title: p.id,
    durationSec: p.movingSec ?? 0,
    movingSec: 0,
    load: 0,
    loadSource: 'duration',
    intensityAuto: 'endurance',
    intensity: 'endurance',
    isKey: false,
    tags: [],
    hasStreams: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

// ISO week 2026-W47: Mon 2026-11-16 … Sun 2026-11-22. Today = Saturday 21.
const today = '2026-11-21';
const workouts = [
  wo({ id: 'w1', date: '2026-11-16', sport: 'bike', plannedDurationSec: 3600, plannedLoad: 60, isKey: true, pairedActivityId: 'a1' }),
  wo({ id: 'w2', date: '2026-11-18', sport: 'run', plannedDurationSec: 1800, plannedLoad: 30, plannedDistanceM: 6000 }),
  wo({ id: 'w3', date: '2026-11-19', sport: 'swim', plannedDurationSec: 1800, plannedLoad: 25, status: 'skipped', skipReason: 'sick' }),
  wo({ id: 'w4', date: '2026-11-21', sport: 'run', plannedDurationSec: 2700, plannedLoad: 45, isKey: true, plannedDistanceM: 9000 }),
  wo({ id: 'w5', date: '2026-11-22', sport: 'bike', plannedDurationSec: 5400, plannedLoad: 80, plannedDistanceM: 45000 }),
];
const activities = [
  act({ id: 'a0', localDate: '2026-11-10', sport: 'bike', movingSec: 3000, load: 50, distanceM: 25000 }),
  act({ id: 'a1', localDate: '2026-11-16', sport: 'bike', movingSec: 3500, durationSec: 3700, load: 55, distanceM: 30000, elevationGainM: 300, pairedWorkoutId: 'w1' }),
  act({ id: 'a2', localDate: '2026-11-17', sport: 'strength', durationSec: 2700, movingSec: 0, load: 40, intensity: 'tempo' }),
];
const dailyLoad = new Map(activities.map((a) => [a.localDate, a.load] as const));
const plannedLoad = { '2026-11-21': 45, '2026-11-22': 80 };
const fitness = buildFitnessSeries({ dailyLoad, plannedLoad, from: '2026-11-09', to: '2026-11-22', today });

describe('buildWeekSummaries', () => {
  const weeks = buildWeekSummaries({
    workouts,
    activities,
    fitness,
    weekNotes: [{ isoWeek: '2026-W47', body: 'Good week', targetHours: 10, updatedAt: NOW }],
    phases: [{ id: 'p1', type: 'build', label: 'Build 2', startDate: '2026-11-16', endDate: '2026-12-13', weeklyLoadTarget: 400 }],
    from: '2026-11-09',
    to: '2026-11-22',
    today,
  });
  const w = weeks[1];

  it('covers each ISO week in range', () => {
    expect(weeks.map((x) => [x.isoWeek, x.startDate, x.endDate])).toEqual([
      ['2026-W46', '2026-11-09', '2026-11-15'],
      ['2026-W47', '2026-11-16', '2026-11-22'],
    ]);
  });

  it('planned, done and projected totals', () => {
    expect(w).toMatchObject({
      plannedSec: 15300,
      plannedLoad: 240,
      plannedDistanceM: 60000,
      doneSec: 6200,
      doneLoad: 95,
      doneDistanceM: 30000,
      elevationGainM: 300,
      projectedSec: 6200 + 2700 + 5400,
      projectedLoad: 95 + 45 + 80,
      keyPlanned: 2,
      keyDone: 1,
      isProjected: true,
      hasNote: true,
      targetHours: 10,
      targetLoad: 400,
      phaseId: 'p1',
      dailyLoad: [55, 40, 0, 0, 0, 0, 0],
      intensitySec: { easy: 3500, moderate: 2700, hard: 0 },
    });
  });

  it('compliance: paired ratio, missed = 0, skipped excluded, today/future excluded', () => {
    near(w.compliancePct!, (100 * (55 / 60 + 0)) / 2);
    expect(weeks[0].compliancePct).toBeNull();
  });

  it('per-sport totals in canonical sport order', () => {
    expect(w.bySport.map((s) => s.sport)).toEqual(['bike', 'run', 'swim', 'strength']);
    expect(w.bySport[0]).toMatchObject({ plannedSec: 9000, doneSec: 3500, plannedCount: 2, doneCount: 1, elevationGainM: 300, doneDistanceM: 30000 });
    expect(w.bySport[3]).toMatchObject({ plannedCount: 0, doneCount: 1, doneSec: 2700 });
  });

  it('WoW deltas vs the previous week; null when the previous week is empty', () => {
    near(w.wowSec!, (6200 - 3000) / 3000, 1e-12);
    near(w.wowLoad!, 0.9, 1e-12);
    near(w.wowDistanceM!, 0.2, 1e-12);
    expect(weeks[0].wowSec).toBeNull();
  });

  it('end-of-week fitness from the (projected) series', () => {
    const end = fitness.find((f) => f.date === '2026-11-22')!;
    const prevEnd = fitness.find((f) => f.date === '2026-11-15')!;
    expect(end.projected).toBe(true);
    expect(w.fitness).toBe(end.fitness);
    expect(w.fatigue).toBe(end.fatigue);
    expect(w.form).toBe(end.form);
    expect(w.formPct).toBe(end.formPct);
    near(w.fitnessDelta, end.fitness - prevEnd.fitness, 1e-12);
    expect(weeks[0].isProjected).toBe(false);
  });

  it('handles empty input', () => {
    const e = buildWeekSummaries({ workouts: [], activities: [], fitness: [], from: '2026-11-16', to: '2026-11-22', today });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ plannedSec: 0, doneSec: 0, compliancePct: null, fitness: 0, formZone: null, hasNote: false, bySport: [] });
    expect(buildWeekSummaries({ workouts: [], activities: [], fitness: [], from: '2026-11-22', to: '2026-11-16', today })).toEqual([]);
  });
});

describe('helpers', () => {
  it('complianceRatio precedence and clamping', () => {
    const a = act({ id: 'x', localDate: today, sport: 'run', movingSec: 3600, load: 80, distanceM: 10000 });
    expect(complianceRatio(wo({ id: 'p', date: today, sport: 'run', plannedLoad: 40 }), a)).toBe(1);
    near(complianceRatio(wo({ id: 'p', date: today, sport: 'run', plannedDurationSec: 7200 }), a), 0.5);
    near(complianceRatio(wo({ id: 'p', date: today, sport: 'run', plannedDistanceM: 20000 }), a), 0.5);
    expect(complianceRatio(wo({ id: 'p', date: today, sport: 'run', compliance: { metric: 'load', ratio: 0.7, state: 'partial_short' } }), a)).toBe(0.7);
    expect(complianceRatio(wo({ id: 'p', date: today, sport: 'run' }), undefined)).toBe(0);
  });

  it('rollingAverage', () => {
    expect(rollingAverage([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(rollingAverage([1, null, 3], 3, 1)).toEqual([1, 1, 2]);
    expect(rollingAverage([], 7)).toEqual([]);
  });

  it('dayStreak', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-18', '2026-11-19', '2026-11-20'];
    expect(dayStreak(dates, today)).toEqual({ current: 3, longest: 3 });
    expect(dayStreak([...dates, today], today)).toEqual({ current: 4, longest: 4 });
    expect(dayStreak([], today)).toEqual({ current: 0, longest: 0 });
  });

  it('weekStreak and weeklyConsistency', () => {
    const mk = (startDate: string, endDate: string, doneSec: number, plannedSec: number, isProjected = false) =>
      ({ startDate, endDate, doneSec, plannedSec, isProjected }) as WeekSummary;
    const weeks = [
      mk('2026-11-02', '2026-11-08', 3600, 3600),
      mk('2026-11-09', '2026-11-15', 1000, 3600),
      mk('2026-11-16', '2026-11-22', 0, 3600, true),
    ];
    expect(weekStreak(weeks, today)).toBe(2); // running current week skipped
    expect(weekStreak(weeks, today, (x) => x.doneSec >= 3600)).toBe(0);
    near(weeklyConsistency(weeks)!, 0.5);
    expect(weeklyConsistency([])).toBeNull();
  });
});
