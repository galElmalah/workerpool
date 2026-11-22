/**
 * `GET /api/mobile/snapshot` (docs/MOBILE_API.md §2): one small payload for the iOS widgets, the
 * Lock Screen and the app's first paint.
 *
 * Built only from the services behind `/today`, `/calendar` and `/trends/weekly` — `loadWindow`
 * (decorated workouts/activities, compliance) and `computeWeeks` (fitness model + week summaries).
 * No metric is computed a second time here; this module only selects and reshapes.
 *
 * Cost: two D1 round trips (today + settings + last sync; then the window — eight weeks of
 * summary rows, no streams or heavy JSON), plus one tiny query only when the athlete has no
 * activity in the last nine weeks.
 */
import type { Activity, LocalDate, MobileSnapshot, PlannedWorkout, SnapshotSession } from '@cadence/core/domain';
import { addDays, diffDays, eachDay, isoWeekOf, weekEnd, weekStart } from '@cadence/core/time';
import { getSettings } from '../db/settings';
import { first } from '../db/sql';
import { ACTIVITY_COLUMNS, rowToActivity, type ActivityRow } from '../db/activities';
import { batchedEnv, computeWeeks, loadWindow, type WindowData } from './analytics';
import { getToday } from './context';

/** Complete weeks before the current one in `recentWeeks`. */
const PAST_WEEKS = 8;
const FITNESS_DAYS = 42;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);
const orNull = (v: number | undefined | null, round: (v: number) => number = r1): number | null =>
  v === undefined || v === null || !Number.isFinite(v) ? null : round(v);

/** Same rule as the week summaries (core/metrics/weekly `activitySec`): moving time, else elapsed. */
const activitySec = (a: Activity): number => (a.movingSec > 0 ? a.movingSec : a.durationSec) || 0;

/** Local "HH:MM" of an activity start. */
const localTime = (a: Activity): string => new Date(Date.parse(a.startedAt) + a.utcOffsetMin * 60_000).toISOString().slice(11, 16);

const weekLabel = (isoWeek: string): string => `W${isoWeek.slice(6)}`;

function workoutSession(w: PlannedWorkout, a: Activity | undefined): SnapshotSession {
  const done = !!a || !!w.pairedActivityId;
  const cs = w.compliance?.state;
  const state: SnapshotSession['state'] = done
    ? 'done'
    : w.status === 'skipped' || cs === 'excused'
      ? 'skipped'
      : cs === 'missed'
        ? 'missed'
        : 'planned';
  return {
    id: w.id,
    kind: a ? 'paired' : 'planned',
    sport: w.sport,
    title: w.title,
    startTime: a ? localTime(a) : (w.startTime ?? null),
    durationSec: a ? r0(activitySec(a)) : orNull(w.plannedDurationSec, r0),
    distanceM: a ? orNull(a.distanceM, r0) : orNull(w.plannedDistanceM, r0),
    load: a ? r1(a.load) : orNull(w.plannedLoad),
    isKey: w.isKey || !!a?.isKey,
    intensity: a?.intensity ?? w.intensity ?? null,
    state,
    workoutId: w.id,
    activityId: a?.id ?? w.pairedActivityId ?? null,
  };
}

function activitySession(a: Activity): SnapshotSession {
  return {
    id: a.id,
    kind: 'activity',
    sport: a.sport,
    title: a.title,
    startTime: localTime(a),
    durationSec: r0(activitySec(a)),
    distanceM: orNull(a.distanceM, r0),
    load: r1(a.load),
    isKey: a.isKey,
    intensity: a.intensity ?? null,
    state: 'done',
    workoutId: a.pairedWorkoutId ?? null,
    activityId: a.id,
  };
}

/** A day's sessions in day order: each planned workout (with its activity when paired), then unplanned activities. */
function sessionsOn(date: LocalDate, data: WindowData): SnapshotSession[] {
  const acts = data.activities.filter((a) => a.localDate === date);
  const actById = new Map(data.activities.map((a) => [a.id, a] as const));
  const used = new Set<string>();
  const out: SnapshotSession[] = [];
  for (const w of data.workouts) {
    if (w.date !== date) continue;
    const a = (w.pairedActivityId ? actById.get(w.pairedActivityId) : undefined) ?? acts.find((x) => x.pairedWorkoutId === w.id);
    if (a) used.add(a.id);
    out.push(workoutSession(w, a));
  }
  for (const a of acts) if (!used.has(a.id)) out.push(activitySession(a));
  // stable: timed sessions by time, untimed ones keep their order at the end
  return out.map((s, i) => ({ s, i })).sort((x, y) => (x.s.startTime ?? '99:99').localeCompare(y.s.startTime ?? '99:99') || x.i - y.i).map((x) => x.s);
}

function dayState(date: LocalDate, today: LocalDate, ws: PlannedWorkout[], as: Activity[]): MobileSnapshot['week']['days'][number]['state'] {
  const open = ws.filter((w) => !w.pairedActivityId && w.status === 'planned' && w.compliance?.state !== 'excused');
  if (as.length) return open.length ? 'partial' : 'done';
  if (!open.length) return 'rest'; // nothing planned, or only skipped / excused workouts
  return date < today ? 'missed' : 'planned';
}

function headline(status: { formZone: string | null }, todaySessions: SnapshotSession[]): string {
  const open = todaySessions.filter((s) => s.state === 'planned');
  let part: string;
  if (open.length) {
    const s = open.find((x) => x.isKey) ?? open[0];
    part = open.length > 1 ? `${s.title} + ${open.length - 1} more today` : `${s.title} today`;
  } else if (todaySessions.some((s) => s.state === 'done')) part = 'done for today';
  else part = 'rest day';
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return status.formZone ? `${cap(status.formZone)} · ${part}` : cap(part);
}

async function latestActivityBefore(db: D1Database, date: LocalDate): Promise<Activity | null> {
  const row = await first<ActivityRow>(
    db,
    `SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE deleted_at IS NULL AND local_date <= ? ORDER BY started_at DESC LIMIT 1`,
    date,
  );
  return row ? rowToActivity(row) : null;
}

export async function buildMobileSnapshot(env: Env): Promise<MobileSnapshot> {
  // Round trip 1: today (demo clock + time zone), settings, last Garmin sync.
  const { env: benv } = batchedEnv(env);
  const [today0, settings, sync] = await Promise.all([
    getToday(benv),
    getSettings(benv.DB),
    first<{ last_sync_at: string | null }>(benv.DB, 'SELECT last_sync_at FROM garmin_auth WHERE id = 1'),
  ]);
  // Round trip 2: the window — 8 complete weeks + this week (+ next week when tomorrow is Monday).
  const data = await loadWindow(env, addDays(weekStart(today0), -7 * PAST_WEEKS), addDays(today0, 1), {
    wellnessFrom: addDays(today0, 1), // wellness is not needed: keep that query empty
    eventsTo: addDays(today0, 366),
  });
  const today = data.today;
  const tomorrow = addDays(today, 1);
  const { weeks, fitness } = computeWeeks(data);

  const hasHistory = [...data.daily].some(([d, v]) => v > 0 && d <= today);
  const fToday = hasHistory ? fitness.find((f) => f.date === today) : undefined;
  const todaySessions = sessionsOn(today, data);
  const statusCore = {
    fitness: fToday ? r1(fToday.fitness) : null,
    fatigue: fToday ? r1(fToday.fatigue) : null,
    form: fToday ? r1(fToday.form) : null,
    formZone: fToday?.formZone ?? null,
    rampPerWeek: fToday ? orNull(fToday.ramp) : null,
  };

  const thisWeek = isoWeekOf(today);
  const week = weeks.find((w) => w.isoWeek === thisWeek)!;
  const phase =
    (week.phaseId ? data.phases.find((p) => p.id === week.phaseId) : undefined) ??
    data.phases.find((p) => p.startDate <= today && p.endDate >= today);
  const days = eachDay(weekStart(today), weekEnd(today)).map((date) => {
    const ws = data.workouts.filter((w) => w.date === date);
    const as = data.activities.filter((a) => a.localDate === date);
    return {
      date,
      plannedSec: r0(ws.reduce((s, w) => s + (w.plannedDurationSec ?? 0), 0)),
      doneSec: r0(as.reduce((s, a) => s + activitySec(a), 0)),
      state: dayState(date, today, ws, as),
    };
  });

  const next = data.events
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.priority.localeCompare(b.priority))[0];

  const firstDay = addDays(today, -(FITNESS_DAYS - 1));
  const fitnessSeries = hasHistory
    ? fitness.filter((f) => f.date >= firstDay && f.date <= today).map((f) => ({ date: f.date, fitness: r1(f.fitness), fatigue: r1(f.fatigue), form: r1(f.form) }))
    : [];

  const recentWeeks = weeks
    .filter((w) => w.startDate <= today)
    .slice(-(PAST_WEEKS + 1))
    .map((w) => ({ isoWeek: w.isoWeek, label: weekLabel(w.isoWeek), hours: r1(w.doneSec / 3600), load: r1(w.doneLoad) }));

  // Most recent completed activity: from the window when there is one (decorated with its pair).
  const done = data.activities.filter((a) => a.localDate <= today);
  const lastAct = done[done.length - 1];
  let lastActivity: SnapshotSession | null = null;
  if (lastAct) {
    const w = lastAct.pairedWorkoutId ? data.workouts.find((x) => x.id === lastAct.pairedWorkoutId) : undefined;
    lastActivity = w ? workoutSession(w, lastAct) : activitySession(lastAct);
  } else {
    const older = await latestActivityBefore(env.DB, today);
    lastActivity = older ? activitySession(older) : null;
  }

  return {
    generatedAt: new Date().toISOString(),
    today,
    units: settings.units,
    athleteName: settings.name.trim() || null,
    status: { ...statusCore, headline: headline(statusCore, todaySessions) },
    todaySessions,
    tomorrowSessions: sessionsOn(tomorrow, data),
    week: {
      isoWeek: week.isoWeek,
      label: weekLabel(week.isoWeek),
      phase: phase?.label ?? null,
      doneSec: r0(week.doneSec),
      plannedSec: r0(week.plannedSec),
      doneLoad: r1(week.doneLoad),
      plannedLoad: r1(week.plannedLoad),
      keyDone: week.keyDone,
      keyPlanned: week.keyPlanned,
      days,
    },
    nextEvent: next ? { id: next.id, name: next.name, date: next.date, daysTo: diffDays(today, next.date), priority: next.priority } : null,
    fitnessSeries,
    recentWeeks,
    lastActivity,
    lastSyncAt: sync?.last_sync_at ?? null,
  };
}
