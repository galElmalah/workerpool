import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { CalendarResponse, FitnessDay, WeekSummary, type LocalDate, type PlannedWorkout, type Sport } from '@cadence/core/domain';
import { buildFitnessSeries } from '@cadence/core/metrics';
import { addDays, isoWeekOf, weekStart } from '@cadence/core/time';
import { ingestActivity } from '../worker/services/ingest';
import { fitnessSeries, weekSummaries } from '../worker/services/analytics';
import { insertWorkouts } from '../worker/db/workouts';
import { insertPhases, putWeekNote } from '../worker/db/furniture';
import { getToday } from '../worker/services/context';
import { buildCalendar } from '../worker/routes/calendar';
import { json } from './helpers';

let n = 0;
function wk(date: LocalDate, sport: Sport, p: Partial<PlannedWorkout> = {}): PlannedWorkout {
  const now = new Date().toISOString();
  return {
    id: `wk_c${++n}`,
    date,
    sport,
    title: `${sport} plan ${n}`,
    isKey: false,
    intensity: 'endurance',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

async function act(date: LocalDate, sport: Sport, movingSec: number, load: number, extra: Record<string, unknown> = {}) {
  const res = await ingestActivity(env, {
    source: 'demo',
    summary: { startedAt: `${date}T08:00:00.000Z`, utcOffsetMin: 0, localDate: date, sport, title: `${sport} ${date}`, durationSec: movingSec, movingSec, ...extra },
    user: { loadManual: load },
  });
  expect(res.outcome).toBe('created');
  return res.activityId;
}

let today: LocalDate;
let mon: LocalDate; // Monday of the fully past fixture week

beforeAll(async () => {
  today = await getToday(env);
  mon = weekStart(addDays(today, -14));
  // Prior week: one run (for WoW).
  await act(addDays(mon, -6), 'run', 3000, 40);
  // Fixture week: run (Mon), key bike (Wed), missed swim (Fri), unplanned walk (Sat).
  await insertWorkouts(env.DB, [
    wk(mon, 'run', { plannedDurationSec: 3600, plannedLoad: 50 }),
    wk(addDays(mon, 2), 'bike', { plannedDurationSec: 5400, plannedLoad: 80, isKey: true, plannedDistanceM: 45000 }),
    wk(addDays(mon, 4), 'swim', { plannedDurationSec: 1800, plannedLoad: 30, plannedDistanceM: 2000 }),
  ]);
  await act(mon, 'run', 3600, 55, { distanceM: 10000 });
  await act(addDays(mon, 2), 'bike', 5000, 70, { distanceM: 40000, elevationGainM: 300 });
  await act(addDays(mon, 5), 'walk', 3600, 20, { distanceM: 5000 });
  await putWeekNote(env.DB, { isoWeek: isoWeekOf(mon), body: 'Solid week', targetHours: 4 });
  await insertPhases(env.DB, [{ id: 'ph_b1', type: 'build', label: 'Build 1', startDate: addDays(mon, -7), endDate: addDays(mon, 13), weeklyLoadTarget: 150 }]);
  // Current week: one open planned workout today; next week: a planned workout (projection).
  await insertWorkouts(env.DB, [
    wk(today, 'row', { plannedDurationSec: 3600, plannedLoad: 40 }),
    wk(addDays(weekStart(today), 8), 'bike', { plannedDurationSec: 7200, plannedLoad: 100 }),
  ]);
});

describe('calendar & week summaries', () => {
  it('returns a CalendarResponse covering whole ISO weeks', async () => {
    const res = CalendarResponse.parse(await json(`/calendar?from=${addDays(mon, 3)}&to=${addDays(today, 10)}`));
    expect(res.from).toBe(mon);
    expect(res.to >= addDays(today, 10)).toBe(true);
    expect(res.today).toBe(today);
    expect(res.weeks[0].isoWeek).toBe(isoWeekOf(mon));
    expect(res.workouts.every((w) => w.compliance)).toBe(true);
    expect(res.activities.every((a) => a.compliance)).toBe(true);
    expect(res.phases.map((p) => p.id)).toContain('ph_b1');
    const walk = res.activities.find((a) => a.sport === 'walk')!;
    expect(walk.compliance?.state).toBe('unplanned');
    expect(res.workouts.find((w) => w.sport === 'swim')!.compliance?.state).toBe('missed');
  });

  it('computes week numbers that match a hand calculation', async () => {
    const [w] = (await weekSummaries(env, { from: mon, to: mon })).map((x) => WeekSummary.parse(x));
    expect(w.isoWeek).toBe(isoWeekOf(mon));
    expect(w.plannedSec).toBe(3600 + 5400 + 1800);
    expect(w.doneSec).toBe(3600 + 5000 + 3600);
    expect(w.plannedLoad).toBe(160);
    expect(w.doneLoad).toBe(145);
    expect(w.plannedDistanceM).toBe(47000);
    expect(w.doneDistanceM).toBe(55000);
    expect(w.elevationGainM).toBe(300);
    expect(w.projectedSec).toBe(w.doneSec); // past week: nothing remaining
    expect(w.keyPlanned).toBe(1);
    expect(w.keyDone).toBe(1);
    // run 55/50 → capped 1.0; bike 70/80 = 0.875 → rounded to whole % = 0.88; swim missed = 0 → 62.67 %
    expect(w.compliancePct).toBe(62.7);
    expect(w.dailyLoad).toEqual([55, 0, 70, 0, 0, 20, 0]);
    expect(w.wowSec).toBeCloseTo((12200 - 3000) / 3000, 3);
    expect(w.wowLoad).toBeCloseTo((145 - 40) / 40, 3);
    expect(w.targetHours).toBe(4);
    expect(w.targetLoad).toBe(150); // from the phase (the note sets no load target)
    expect(w.phaseId).toBe('ph_b1');
    expect(w.hasNote).toBe(true);
    expect(w.isProjected).toBe(false);
    expect(w.intensitySec.easy + w.intensitySec.moderate + w.intensitySec.hard).toBe(w.doneSec);
    expect(w.bySport.map((s) => s.sport)).toEqual(['bike', 'run', 'swim', 'walk']);
    const bike = w.bySport.find((s) => s.sport === 'bike')!;
    expect(bike).toMatchObject({ plannedSec: 5400, doneSec: 5000, plannedLoad: 80, doneLoad: 70, plannedCount: 1, doneCount: 1, doneDistanceM: 40000 });
    // End-of-week fitness from the EWMA over daily loads (exp form, τ 42/7, seeded at 0).
    const expected = buildFitnessSeries({
      dailyLoad: { [addDays(mon, -6)]: 40, [mon]: 55, [addDays(mon, 2)]: 70, [addDays(mon, 5)]: 20 },
      from: addDays(mon, 6),
      to: addDays(mon, 6),
      today,
    })[0];
    expect(w.fitness).toBeCloseTo(expected.fitness, 1);
    expect(w.fatigue).toBeCloseTo(expected.fatigue, 1);
  });

  it('projects the current and future weeks with planned load', async () => {
    const weeks = await weekSummaries(env, { from: today, to: addDays(today, 8) });
    const cur = weeks[0];
    expect(cur.projectedLoad).toBeCloseTo(cur.doneLoad + 40, 5);
    expect(cur.projectedSec).toBe(cur.doneSec + 3600);
    const next = weeks[1];
    expect(next.isProjected).toBe(true);
    expect(next.plannedLoad).toBe(100);
    expect(next.projectedLoad).toBe(100);
    const days = await fitnessSeries(env, { from: today, to: addDays(weekStart(today), 13) });
    const planned = days.find((d) => d.plannedLoad === 100)!;
    expect(planned.projected).toBe(true);
    const before = days[days.indexOf(planned) - 1];
    expect(planned.fitness).toBeGreaterThan(before.fitness);
  });

  it('keeps the fitness series continuous across the `from` boundary', async () => {
    const a = (await fitnessSeries(env, { from: addDays(mon, -10), to: addDays(mon, 20) })).map((d) => FitnessDay.parse(d));
    const b = await fitnessSeries(env, { from: addDays(mon, 3), to: addDays(mon, 20) });
    const byDate = new Map(a.map((d) => [d.date, d]));
    for (const d of b) {
      expect(d.fitness).toBe(byDate.get(d.date)!.fitness);
      expect(d.fatigue).toBe(byDate.get(d.date)!.fatigue);
      expect(d.form).toBe(byDate.get(d.date)!.form);
    }
    expect(b[0].fitness).toBeGreaterThan(0); // history before `from` counted
  });

  it('serves the weekly review page', async () => {
    const res = await json(`/weeks/${isoWeekOf(mon)}`);
    expect(WeekSummary.parse(res.summary).doneLoad).toBe(145);
    expect(WeekSummary.parse(res.previous).doneLoad).toBe(40);
    expect(res.days).toHaveLength(7);
    expect(res.days[0].activities).toHaveLength(1);
    expect(res.keySessions).toHaveLength(1);
    expect(res.keySessions[0].workout.sport).toBe('bike');
    expect(res.keySessions[0].activity.sport).toBe('bike');
    expect(res.highlights.longest.sport).toBe('bike');
    expect(res.highlights.biggestLoad.load).toBe(70);
    expect(res.note.body).toBe('Solid week');
    expect(WeekSummary.parse(res.next.summary).isoWeek).toBe(isoWeekOf(addDays(mon, 7)));
  });

  it('serves today', async () => {
    const res = await json('/today');
    expect(res.date).toBe(today);
    expect(FitnessDay.parse(res.fitness).date).toBe(today);
    expect(res.weekStrip).toHaveLength(7);
    expect(res.workouts.some((w: PlannedWorkout) => w.sport === 'row' && w.compliance?.state === 'planned')).toBe(true);
    expect(WeekSummary.parse(res.week).isoWeek).toBe(isoWeekOf(today));
    expect(res.wellness.readiness.state).toMatch(/green|amber|red/);
  });

  it('uses at most a couple of D1 round trips for a 12-week calendar', async () => {
    const res = await buildCalendar(env, addDays(today, -70), addDays(today, 7));
    expect(res.roundTrips).toBeLessThanOrEqual(6);
  });
});
