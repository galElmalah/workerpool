/**
 * Realistic dataset: 16 months of the synthetic athlete (≈ 600 activities + plan + wellness),
 * ingested through the real pipeline. Checks endpoint shapes and calendar latency.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { ActivityDetail, CalendarResponse, FitnessDay, WeekSummary, type PlannedWorkout, type ThresholdKind } from '@cadence/core/domain';
import { addDays, isoWeekOf } from '@cadence/core/time';
import { encodeFit, generateActivityDetail, generateAthlete, type SynthAthlete } from '@cadence/garmin/synth';
import { ingestActivity } from '../worker/services/ingest';
import { insertWorkouts } from '../worker/db/workouts';
import { insertEvents, insertMarkers, upsertWellnessDevice } from '../worker/db/furniture';
import { insertThreshold } from '../worker/db/thresholds';
import { getToday } from '../worker/services/context';
import { buildCalendar } from '../worker/routes/calendar';
import { api, json } from './helpers';

let athlete: SynthAthlete;
let today: string;

const KIND: Record<string, ThresholdKind> = { ftp: 'ftp', run_threshold: 'run_threshold', swim_css: 'swim_css', row_threshold: 'row_threshold', lthr: 'lthr', weight: 'weight' };

beforeAll(async () => {
  today = await getToday(env);
  athlete = generateAthlete({ seed: 7, today, months: 16 });
  const p = athlete.profile;
  const start = athlete.activities[0]?.localDate ?? addDays(today, -365);
  const base: Array<[ThresholdKind, 'all' | 'bike' | 'run' | 'swim' | 'row', number]> = [
    ['ftp', 'bike', p.ftp],
    ['run_threshold', 'run', p.runThresholdMps],
    ['swim_css', 'swim', p.swimCssMps],
    ['row_threshold', 'row', p.rowThresholdW],
    ['lthr', 'all', p.lthr],
    ['hr_max', 'all', p.hrMax],
    ['hr_rest', 'all', p.hrRest],
    ['weight', 'all', p.weightKg],
  ];
  for (const [kind, sport, value] of base) await insertThreshold(env.DB, { kind, sport, value, effectiveFrom: addDays(start, -1), source: 'manual' });
  for (const t of athlete.thresholdHistory) {
    const sport = t.kind === 'ftp' ? 'bike' : t.kind === 'run_threshold' ? 'run' : t.kind === 'swim_css' ? 'swim' : t.kind === 'row_threshold' ? 'row' : 'all';
    await insertThreshold(env.DB, { kind: KIND[t.kind], sport, value: t.value, effectiveFrom: t.effectiveFrom, source: 'manual' });
  }
  const now = new Date().toISOString();
  const workouts: PlannedWorkout[] = athlete.plan.map((s, i) => {
    const w: PlannedWorkout = {
      id: `wk_s${i}`,
      date: s.date,
      sport: s.sport,
      title: s.title,
      plannedDurationSec: s.plannedDurationSec,
      plannedLoad: Math.round((s.plannedDurationSec / 3600) * (s.intensity === 'recovery' ? 40 : s.intensity === 'endurance' ? 60 : 80)),
      isKey: s.isKey,
      intensity: s.intensity,
      tags: s.tags,
      environment: s.environment,
      status: s.skipped ? 'skipped' : 'planned',
      garmin: { syncState: 'none' },
      createdAt: now,
      updatedAt: now,
    };
    if (s.startTime) w.startTime = s.startTime;
    if (s.subSport) w.subSport = s.subSport;
    if (s.skipped) w.skipReason = s.skipped.reason;
    return w;
  });
  await insertWorkouts(env.DB, workouts);
  await upsertWellnessDevice(env.DB, athlete.wellness);
  await insertEvents(env.DB, athlete.events.map((e, i) => ({ ...e, id: `evt_s${i}` })));
  await insertMarkers(env.DB, athlete.markers.map((m, i) => ({ ...m, id: `mk_s${i}` })));

  // A few recent rides/runs with full FIT files (peaks, zones); the rest summary-only.
  const withFit = new Set(
    [...athlete.activities.filter((a) => a.sport === 'bike' && a.avgPower).slice(-4), ...athlete.activities.filter((a) => a.sport === 'run').slice(-4)].map((a) => a.garminActivityId),
  );
  for (const a of athlete.activities) {
    const fit = withFit.has(a.garminActivityId) ? encodeFit(generateActivityDetail(athlete, a.garminActivityId)) : undefined;
    const res = await ingestActivity(env, {
      source: 'demo',
      fit,
      summary: {
        garminActivityId: String(a.garminActivityId),
        garminTypeKey: a.garminTypeKey,
        startedAt: a.startedAt,
        utcOffsetMin: a.utcOffsetMin,
        localDate: a.localDate,
        sport: a.sport,
        subSport: a.subSport,
        title: a.title,
        durationSec: a.durationSec,
        movingSec: a.movingSec,
        distanceM: a.distanceM,
        elevationGainM: a.elevationGainM,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        avgPower: a.avgPower,
        weightedPower: a.normPower,
        maxPower: a.maxPower,
        avgSpeedMps: a.avgSpeedMps,
        avgCadence: a.avgCadence,
        calories: a.calories,
        poolLengthM: a.poolLengthM,
        totalSets: a.totalSets,
        totalReps: a.totalReps,
        editHash: `h${a.garminActivityId}`,
      },
      user: { rpe: a.rpe, feel: a.feel, postNote: a.postNote },
    });
    expect(res.outcome).toBe('created');
  }
}, 120_000);

describe('analytics on a year of data', () => {
  it('has a realistic dataset', async () => {
    const all = await json('/activities?limit=1');
    console.log(`dataset: ${all.totals.count} activities, ${athlete.plan.length} planned sessions`);
    expect(all.totals.count).toBeGreaterThanOrEqual(580);
  });

  it('serves a 12-week calendar quickly in ≤ 6 D1 round trips', async () => {
    const from = addDays(today, -77);
    const to = addDays(today, 7);
    const first = await api(`/calendar?from=${from}&to=${to}`);
    const body = CalendarResponse.parse(await first.json());
    expect(body.weeks.length).toBeGreaterThanOrEqual(12);
    expect(body.activities.length).toBeGreaterThan(50);
    expect(body.workouts.some((w) => w.compliance?.state === 'on_target')).toBe(true);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await api(`/calendar?from=${from}&to=${to}`);
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    }
    const best = Math.min(...times);
    console.log(`GET /calendar (12 weeks): best ${best.toFixed(1)} ms, all ${times.map((t) => t.toFixed(0)).join('/')} ms`);
    expect(best).toBeLessThan(100);
    const direct = await buildCalendar(env, from, to);
    expect(direct.roundTrips).toBeLessThanOrEqual(6);
    console.log(`calendar D1 round trips: ${direct.roundTrips}`);
  });

  it('fitness trend with projection, events and threshold changes', async () => {
    const res = await json('/trends/fitness');
    expect(res.days.length).toBeGreaterThan(150);
    res.days.slice(0, 3).forEach((d: unknown) => FitnessDay.parse(d));
    expect(res.days.at(-1).projected).toBe(true);
    expect(res.days.find((d: FitnessDay) => d.date === today).fitness).toBeGreaterThan(10);
    expect(Array.isArray(res.events)).toBe(true);
    expect(Array.isArray(res.thresholdChanges)).toBe(true);
    const bike = await json('/trends/fitness?sport=bike');
    expect(bike.days.find((d: FitnessDay) => d.date === today).fitness).toBeLessThan(res.days.find((d: FitnessDay) => d.date === today).fitness);
  });

  it('weekly summaries', async () => {
    const res = await json('/trends/weekly?weeks=26');
    expect(res).toHaveLength(26);
    res.forEach((w: unknown) => WeekSummary.parse(w));
    expect(res.at(-1).isoWeek).toBe(isoWeekOf(today));
    expect(res.some((w: WeekSummary) => w.compliancePct !== null)).toBe(true);
  });

  it('peaks: power curve per range with sources, efforts and estimates', async () => {
    const bike = await json('/trends/peaks?sport=bike&ranges=42d,90d,season,all');
    expect(bike.ranges).toHaveLength(4);
    const all = bike.ranges[3];
    expect(all.power.length).toBeGreaterThan(10);
    expect(all.power[0].activityId).toMatch(/^act_/);
    expect(all.power[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < all.power.length; i++) expect(all.power[i].value).toBeLessThanOrEqual(all.power[i - 1].value);
    expect(bike.estimate.ftp.value).toBeGreaterThan(100);
    const run = await json('/trends/peaks?sport=run&ranges=all');
    expect(run.ranges[0].efforts.length).toBeGreaterThan(0);
    expect(run.ranges[0].efforts[0].activityId).toMatch(/^act_/);
    expect((await api('/trends/peaks?ranges=nope')).status).toBe(400);
  });

  it('intensity distribution', async () => {
    const res = await json('/trends/intensity?weeks=8');
    expect(res.weeks).toHaveLength(8);
    const w = res.weeks.find((x: { easy: number }) => x.easy > 0);
    expect(['polarized', 'pyramidal', 'threshold', 'high_intensity', 'mixed']).toContain(w.distribution);
    expect(res.bySport.length).toBeGreaterThan(0);
  });

  it('wellness with HRV baseline and readiness', async () => {
    const res = await json('/trends/wellness');
    expect(res.days).toHaveLength(90);
    const d = res.days.at(-1);
    expect(d.hrvBaseline.b7Ms).toBeGreaterThan(0);
    expect(d.hrvBaseline.lowMs).toBeLessThan(d.hrvBaseline.highMs);
    expect(['green', 'amber', 'red']).toContain(d.readiness.state);
  });

  it('consistency heatmap and streaks', async () => {
    const res = await json('/trends/consistency?days=365');
    expect(res.days).toHaveLength(365);
    expect(res.streaks.longestDays).toBeGreaterThan(1);
    expect(res.streaks.longestWeeks).toBeGreaterThan(4);
  });

  it('threshold history and suggestions', async () => {
    const res = await json('/trends/thresholds');
    expect(res.history.ftp.length).toBeGreaterThan(0);
    expect(res.suggestions.some((s: { kind: string }) => s.kind === 'ftp')).toBe(true);
  });

  it('compares periods', async () => {
    const res = await json('/trends/compare?preset=4w');
    expect(res.a.totals.count).toBeGreaterThan(0);
    expect(res.b.totals.count).toBeGreaterThan(0);
    expect(typeof res.delta.load).toBe('number');
    const explicit = await json(`/trends/compare?a=${addDays(today, -6)}..${today}&b=${addDays(today, -13)}..${addDays(today, -7)}`);
    expect(explicit.a.from).toBe(addDays(today, -6));
  });

  it('sport page trends', async () => {
    const res = await json('/trends/sport/bike?weeks=12');
    expect(res.weeks).toHaveLength(12);
    expect(res.points.length).toBeGreaterThan(5);
    expect(res.weeks.some((w: { outputAtRefHr: number | null }) => w.outputAtRefHr !== null)).toBe(true);
    expect((await api('/trends/sport/curling')).status).toBe(400);
  });

  it('weekly review and today on the realistic dataset', async () => {
    const week = await json(`/weeks/${isoWeekOf(addDays(today, -7))}`);
    expect(WeekSummary.parse(week.summary).doneSec).toBeGreaterThan(0);
    expect(week.days).toHaveLength(7);
    expect(Array.isArray(week.highlights.newBests)).toBe(true);
    const t = await json('/today');
    expect(t.weekStrip).toHaveLength(7);
    expect(t.wellness.hrv.status === null || ['normal', 'suppressed', 'elevated'].includes(t.wellness.hrv.status)).toBe(true);
    expect((await api('/weeks/2026-47')).status).toBe(400);
  });

  it('activity detail with previous similar session', async () => {
    const list = await json('/activities?sport=bike&limit=5');
    const detail = ActivityDetail.parse(await json(`/activities/${list.items[0].id}`));
    expect(detail.previousSimilar?.sport).toBe('bike');
  });
});
