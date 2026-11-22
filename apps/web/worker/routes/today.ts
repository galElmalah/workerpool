import { Hono } from 'hono';
import type { ComplianceState } from '@cadence/core/domain';
import { hrvBaseline, readiness, restingHrTrend, sleepShort } from '@cadence/core/metrics';
import { addDays, diffDays, eachDay, weekEnd, weekStart } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { getToday } from '../services/context';
import { computeWeeks, loadWindow } from '../services/analytics';

const r = (v: number | null, dp = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const todayRoutes = new Hono<AppEnv>().get('/today', async (c) => {
  const today = await getToday(c.env);
  const data = await loadWindow(c.env, today, today, { wellnessFrom: addDays(today, -59), eventsTo: addDays(today, 366) });
  const { weeks, fitness } = computeWeeks(data);
  const week = weeks[weeks.length - 1];

  const workouts = data.workouts.filter((w) => w.date === today);
  const activities = data.activities.filter((a) => a.localDate === today);
  const fitnessToday = fitness.find((f) => f.date === today)!;

  const wellToday = data.wellness.find((w) => w.date === today) ?? null;
  const hrv = hrvBaseline(data.wellness, today);
  const rhr = restingHrTrend(data.wellness, today);
  const sleep = sleepShort(data.wellness, today);
  const rd = readiness(data.wellness, today, { formPct: fitnessToday.formPct });
  const ms = (v: number | null) => (v === null ? null : r(Math.exp(v), 1));

  const weekStrip = eachDay(weekStart(today), weekEnd(today)).map((date) => {
    const ws = data.workouts.filter((w) => w.date === date);
    const as = data.activities.filter((a) => a.localDate === date);
    const states: ComplianceState[] = [
      ...ws.map((w) => w.compliance?.state ?? 'planned'),
      ...as.filter((a) => a.compliance?.state === 'unplanned').map(() => 'unplanned' as const),
    ];
    return {
      date,
      plannedCount: ws.length,
      doneCount: as.length,
      load: r(as.reduce((s, a) => s + a.load, 0))!,
      plannedLoad: r(ws.reduce((s, w) => s + (w.plannedLoad ?? 0), 0))!,
      states,
      isToday: date === today,
      hasKey: ws.some((w) => w.isKey) || as.some((a) => a.isKey),
    };
  });

  const upcoming = data.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.priority.localeCompare(b.priority));
  const next = upcoming[0];
  const nextA = upcoming.find((e) => e.priority === 'A');
  const pendingLogs = data.activities
    // last 7 days (today included; the window always reaches back ≥ 7 days), newest first, max 5
    .filter((a) => a.localDate > addDays(today, -7) && a.localDate <= today && (a.rpe === undefined || a.feel === undefined))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 5);

  return c.json({
    date: today,
    workouts,
    activities,
    wellness: {
      today: wellToday,
      hrv: { b7Ms: r(hrv.b7Ms), lowMs: ms(hrv.low), highMs: ms(hrv.high), status: hrv.status },
      restingHr: { today: wellToday?.restingHr ?? null, rhr7: r(rhr.rhr7), rhr60: r(rhr.rhr60), elevated: rhr.elevated },
      sleep: { lastHours: r(sleep.lastHours, 2), mean3Hours: r(sleep.mean3Hours, 2), short: sleep.short },
      readiness: { state: rd.state, reasons: rd.reasons, inputs: rd.inputs, label: rd.label },
    },
    fitness: fitnessToday,
    weekStrip,
    week,
    nextEvent: next ? { event: next, daysUntil: diffDays(today, next.date) } : null,
    nextAEvent: nextA ? { event: nextA, daysUntil: diffDays(today, nextA.date) } : null,
    dayNote: data.dayNotes.find((n) => n.date === today) ?? null,
    markers: data.markers.filter((m) => m.date <= today && (m.endDate ?? m.date) >= today),
    pendingLogs,
  });
});
