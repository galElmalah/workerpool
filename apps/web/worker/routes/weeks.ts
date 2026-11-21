import { Hono } from 'hono';
import {
  IsoWeek,
  type Activity,
  type BestEffort,
  type Compliance,
  type LocalDate,
  type PeakPoint,
  type PlannedWorkout,
  type Sport,
  type WellnessDay,
} from '@cadence/core/domain';
import { hrvBaseline } from '@cadence/core/metrics';
import { addDays, eachDay, isoWeekStart } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { listPeaks } from '../db/activities';
import { badRequest } from '../lib/http';
import { computeWeeks, loadWindow } from '../services/analytics';

/** Durations / distances reported as "new best" highlights. */
const BEST_DURATIONS = [5, 60, 300, 1200, 3600];

type PeakRow = Awaited<ReturnType<typeof listPeaks>>[number];

export interface NewBest {
  activityId: string;
  date: LocalDate;
  sport: Sport;
  kind: 'power' | 'effort';
  durationSec?: number;
  distanceM?: number;
  value: number;
  previous?: number;
}

/** Bests set by `week` rows against everything before them (power: higher, efforts: faster). */
export function newBests(week: PeakRow[], before: PeakRow[]): NewBest[] {
  const out: NewBest[] = [];
  const bestPower = new Map<string, number>();
  const bestEffort = new Map<string, number>();
  const take = (rows: PeakRow[], record: boolean) => {
    for (const row of [...rows].sort((a, b) => a.localDate.localeCompare(b.localDate))) {
      for (const p of row.peaks.power ?? ([] as PeakPoint[])) {
        if (!BEST_DURATIONS.includes(p.durationSec)) continue;
        const k = `${row.sport}|${p.durationSec}`;
        const prev = bestPower.get(k);
        if (prev === undefined || p.value > prev) {
          if (record && prev !== undefined) out.push({ activityId: row.id, date: row.localDate, sport: row.sport, kind: 'power', durationSec: p.durationSec, value: p.value, previous: prev });
          bestPower.set(k, p.value);
        }
      }
      for (const e of row.peaks.efforts ?? ([] as BestEffort[])) {
        const k = `${row.sport}|${e.distanceM}`;
        const prev = bestEffort.get(k);
        if (prev === undefined || e.timeSec < prev) {
          if (record && prev !== undefined) out.push({ activityId: row.id, date: row.localDate, sport: row.sport, kind: 'effort', distanceM: e.distanceM, value: e.timeSec, previous: prev });
          bestEffort.set(k, e.timeSec);
        }
      }
    }
  };
  take(before, false);
  take(week, true);
  return out;
}

const secOf = (a: Activity) => (a.movingSec > 0 ? a.movingSec : a.durationSec);
const mean = (xs: Array<number | undefined>) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

function wellnessSummary(days: WellnessDay[], all: WellnessDay[], end: LocalDate) {
  const base = hrvBaseline(all, end);
  const hrv = mean(days.map((d) => d.hrvMs));
  const weights = days.filter((d) => d.weightKg).map((d) => d.weightKg!);
  return {
    avgHrvMs: hrv,
    hrvBaselineMs: base.m60 !== null ? Math.round(Math.exp(base.m60) * 10) / 10 : null,
    hrvVsBaselinePct: hrv !== null && base.m60 !== null ? Math.round((100 * (hrv - Math.exp(base.m60))) / Math.exp(base.m60)) : null,
    avgSleepSec: mean(days.map((d) => d.sleepSec)),
    avgRestingHr: mean(days.map((d) => d.restingHr)),
    weightDeltaKg: weights.length >= 2 ? Math.round((weights[weights.length - 1] - weights[0]) * 10) / 10 : null,
    avgFeel: mean(days.map((d) => d.feel)),
  };
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const weeksRoutes = new Hono<AppEnv>().get('/weeks/:isoWeek', async (c) => {
  const parsed = IsoWeek.safeParse(c.req.param('isoWeek'));
  if (!parsed.success) throw badRequest('Expected an ISO week like 2026-W47');
  const start = isoWeekStart(parsed.data);
  const end = addDays(start, 6);
  const prevStart = addDays(start, -7);
  const nextEnd = addDays(end, 7);
  const data = await loadWindow(c.env, prevStart, nextEnd, { wellnessFrom: addDays(end, -59) });
  const { weeks } = computeWeeks(data);
  const [previous, summary, nextSummary] = weeks;

  const workouts = data.workouts.filter((w) => w.date >= start && w.date <= end);
  const activities = data.activities.filter((a) => a.localDate >= start && a.localDate <= end);
  const wellnessWeek = data.wellness.filter((w) => w.date >= start && w.date <= end);
  const days = eachDay(start, end).map((date) => ({
    date,
    workouts: workouts.filter((w) => w.date === date),
    activities: activities.filter((a) => a.localDate === date),
    markers: data.markers.filter((m) => m.date <= date && (m.endDate ?? m.date) >= date),
    note: data.dayNotes.find((n) => n.date === date) ?? null,
    wellness: wellnessWeek.find((w) => w.date === date) ?? null,
  }));

  const actById = new Map(data.activities.map((a) => [a.id, a] as const));
  const rank = (cmp?: Compliance) => (cmp?.state === 'missed' ? 0 : cmp?.state === 'excused' ? 1 : 2);
  const keySessions = workouts
    .filter((w) => w.isKey)
    .map((w: PlannedWorkout) => {
      const a = w.pairedActivityId ? actById.get(w.pairedActivityId) : undefined;
      return { workout: w, ...(a ? { activity: a } : {}), compliance: w.compliance! };
    })
    .sort((x, y) => rank(x.compliance) - rank(y.compliance) || x.workout.date.localeCompare(y.workout.date));

  // Highlights: longest, biggest load (session + day), new bests against all earlier history.
  const sports = [...new Set(activities.map((a) => a.sport))];
  const peakRows = sports.length ? await listPeaks(c.env.DB, { to: end }) : [];
  const inWeek = peakRows.filter((p) => p.localDate >= start && sports.includes(p.sport));
  const before = peakRows.filter((p) => p.localDate < start && sports.includes(p.sport));
  const longest = activities.reduce<Activity | null>((m, a) => (!m || secOf(a) > secOf(m) ? a : m), null);
  const biggest = activities.reduce<Activity | null>((m, a) => (!m || a.load > m.load ? a : m), null);
  const dayLoads = days.map((d) => ({ date: d.date, load: Math.round(d.activities.reduce((s, a) => s + a.load, 0) * 10) / 10 }));
  const biggestDay = dayLoads.reduce<{ date: LocalDate; load: number } | null>((m, d) => (d.load > 0 && (!m || d.load > m.load) ? d : m), null);

  return c.json({
    isoWeek: parsed.data,
    summary,
    previous,
    days,
    keySessions,
    highlights: {
      longest,
      biggestLoad: biggest,
      biggestLoadDay: biggestDay,
      newBests: newBests(inWeek, before),
    },
    wellness: wellnessSummary(wellnessWeek, data.wellness, end),
    note: data.weekNotes.find((n) => n.isoWeek === parsed.data) ?? null,
    next: {
      summary: nextSummary,
      workoutCount: data.workouts.filter((w) => w.date > end && w.date <= nextEnd).length,
      keyCount: data.workouts.filter((w) => w.date > end && w.date <= nextEnd && w.isKey).length,
    },
  });
});
