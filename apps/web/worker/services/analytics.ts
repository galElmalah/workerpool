/**
 * Derived-on-read aggregates: the fitness model (Fitness / Fatigue / Form) and week summaries.
 * Nothing here is stored — every number comes from per-day loads and the planned workouts.
 *
 * Performance: `loadWindow` fetches everything a calendar/week view needs in ONE D1 round trip
 * (see `batchedEnv`: concurrent repository calls are coalesced into a single `db.batch`).
 */
import type {
  Activity,
  DayMarker,
  DayNote,
  Event,
  FitnessDay,
  LocalDate,
  Phase,
  PlannedWorkout,
  Sport,
  WeekNote,
  WeekSummary,
  WellnessDay,
} from '@cadence/core/domain';
import { buildFitnessSeries, buildWeekSummaries } from '@cadence/core/metrics';
import { weeklyCompliance } from '@cadence/core/workout';
import { addDays, isoWeekOf, weekEnd, weekStart } from '@cadence/core/time';
import { dailyLoads, listActivities } from '../db/activities';
import { listDayNotes, listEvents, listMarkers, listPhases, listWeekNotes, listWellness } from '../db/furniture';
import { listWorkouts } from '../db/workouts';
import { getToday } from './context';
import { decorateActivities, decorateWorkouts } from './compliance';

// ───────────────────────────── D1 round-trip coalescing ─────────────────────────────

type Mode = 'all' | 'first' | 'run';
interface Pending {
  stmt: D1PreparedStatement;
  mode: Mode;
  col?: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/**
 * A D1Database stand-in that queues `.all()/.first()/.run()` calls made in the same tick and
 * sends them as ONE `db.batch` (one round trip). Lets us call other modules' repository functions
 * concurrently without paying one round trip each. `roundTrips` counts real D1 calls.
 */
export class BatchingD1 {
  roundTrips = 0;
  private queue: Pending[] = [];
  private scheduled = false;
  constructor(readonly db: D1Database) {}

  prepare(sql: string): D1PreparedStatement {
    return this.wrap(this.db.prepare(sql));
  }
  private wrap(stmt: D1PreparedStatement): D1PreparedStatement {
    const owner = this;
    const proxy = {
      __inner: stmt,
      bind: (...values: unknown[]) => owner.wrap(stmt.bind(...values)),
      all: () => owner.enqueue(stmt, 'all'),
      first: (col?: string) => owner.enqueue(stmt, 'first', col),
      run: () => owner.enqueue(stmt, 'run'),
      raw: (opts?: { columnNames?: boolean }) => {
        owner.roundTrips++;
        return stmt.raw(opts as never);
      },
    };
    return proxy as unknown as D1PreparedStatement;
  }
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    this.roundTrips++;
    return this.db.batch(stmts.map((s) => (s as unknown as { __inner?: D1PreparedStatement }).__inner ?? s));
  }
  exec(sql: string): Promise<D1ExecResult> {
    this.roundTrips++;
    return this.db.exec(sql);
  }
  withSession(): D1DatabaseSession {
    return this.db.withSession();
  }
  dump(): Promise<ArrayBuffer> {
    return (this.db as unknown as { dump(): Promise<ArrayBuffer> }).dump();
  }
  private enqueue(stmt: D1PreparedStatement, mode: Mode, col?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ stmt, mode, col, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => void this.flush(), 0);
      }
    });
  }
  private settle(p: Pending, res: D1Result): void {
    if (p.mode === 'first') {
      const row = (res.results?.[0] ?? null) as Record<string, unknown> | null;
      p.resolve(p.col ? (row?.[p.col] ?? null) : row);
    } else p.resolve(res);
  }
  private async flush(): Promise<void> {
    const q = this.queue;
    this.queue = [];
    this.scheduled = false;
    if (!q.length) return;
    this.roundTrips++;
    try {
      const results = q.length === 1 && q[0].mode !== 'run' ? [await q[0].stmt.all()] : await this.db.batch(q.map((p) => p.stmt));
      q.forEach((p, i) => this.settle(p, results[i]));
    } catch {
      // Isolate the failing statement: run each on its own.
      for (const p of q) {
        try {
          this.roundTrips++;
          this.settle(p, await p.stmt.all());
        } catch (e) {
          p.reject(e);
        }
      }
    }
  }
}

/** A copy of env whose DB coalesces concurrent queries. */
export function batchedEnv(env: Env): { env: Env; db: BatchingD1 } {
  const db = new BatchingD1(env.DB);
  return { env: { ...env, DB: db as unknown as D1Database }, db };
}

// ───────────────────────────── fitness ─────────────────────────────

/** Planned load per date of still-open workouts (unpaired, not skipped) on/after today. */
export function plannedRemainingDaily(workouts: readonly PlannedWorkout[], today: LocalDate, sport?: Sport): Map<LocalDate, number> {
  const m = new Map<LocalDate, number>();
  for (const w of workouts) {
    if (w.date < today || w.status !== 'planned' || w.pairedActivityId || !(w.plannedLoad! > 0)) continue;
    if (sport && w.sport !== sport) continue;
    m.set(w.date, (m.get(w.date) ?? 0) + w.plannedLoad!);
  }
  return m;
}

/**
 * Fitness series over [from, to]. The EWMA starts at the first activity ever (daily loads cover
 * the whole history), so values do not depend on `from`.
 */
export function fitnessFrom(
  daily: Map<LocalDate, number>,
  planned: Map<LocalDate, number>,
  from: LocalDate,
  to: LocalDate,
  today: LocalDate,
): FitnessDay[] {
  return buildFitnessSeries({ dailyLoad: daily, plannedLoad: planned, from, to, today }).map(roundFitness);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
function roundFitness(d: FitnessDay): FitnessDay {
  return {
    ...d,
    load: r1(d.load),
    plannedLoad: r1(d.plannedLoad),
    fitness: r1(d.fitness),
    fatigue: r1(d.fatigue),
    form: r1(d.form),
    formPct: d.formPct === null ? null : r1(d.formPct),
    ramp: d.ramp === null ? null : r1(d.ramp),
  };
}

/** Open planned workouts (for the projection) between two dates, as a light SQL query. */
async function plannedDailySql(db: D1Database, from: LocalDate, to: LocalDate, sport?: Sport): Promise<Map<LocalDate, number>> {
  const { results } = await db
    .prepare(
      `SELECT date, SUM(planned_load) AS load FROM workouts
       WHERE date >= ? AND date <= ? AND status = 'planned' AND paired_activity_id IS NULL AND planned_load > 0${sport ? ' AND sport = ?' : ''}
       GROUP BY date`,
    )
    .bind(...(sport ? [from, to, sport] : [from, to]))
    .all<{ date: string; load: number }>();
  return new Map(results.map((r) => [r.date, r.load ?? 0]));
}

export async function fitnessSeries(env: Env, q: { from: LocalDate; to: LocalDate; sport?: Sport }): Promise<FitnessDay[]> {
  const { env: benv } = batchedEnv(env);
  const today = await getToday(benv);
  const [daily, planned] = await Promise.all([
    dailyLoads(benv.DB, { sport: q.sport }),
    q.to >= today ? plannedDailySql(benv.DB, today, q.to, q.sport) : Promise.resolve(new Map<LocalDate, number>()),
  ]);
  return fitnessFrom(daily, planned, q.from, q.to, today);
}

// ───────────────────────────── window loading ─────────────────────────────

export interface WindowData {
  today: LocalDate;
  /** Whole ISO weeks [start, end] + one prior week (`prior` = start − 7) for WoW. */
  start: LocalDate;
  end: LocalDate;
  prior: LocalDate;
  workouts: PlannedWorkout[]; // decorated, prior..end
  activities: Activity[]; // decorated, prior..end
  events: Event[];
  phases: Phase[];
  markers: DayMarker[];
  dayNotes: DayNote[];
  wellness: WellnessDay[];
  weekNotes: WeekNote[];
  daily: Map<LocalDate, number>;
}

const none = <T>(): Promise<T[]> => Promise.resolve([]);

/**
 * Everything a calendar / week view needs for [from, to] (expanded to whole ISO weeks) in one
 * round trip (two when a paired item lies outside the window).
 */
export async function loadWindow(env: Env, from: LocalDate, to: LocalDate, opts: { wellnessFrom?: LocalDate; eventsTo?: LocalDate; /** Skip events, day notes and wellness. */ lite?: boolean } = {}): Promise<WindowData & { roundTrips: number }> {
  const { env: benv, db } = batchedEnv(env);
  const start = weekStart(from);
  const end = weekEnd(to);
  const prior = addDays(start, -7);
  const [today, workouts, activities, events, phases, markers, dayNotes, wellness, weekNotes, daily] = await Promise.all([
    getToday(benv),
    listWorkouts(benv.DB, { from: prior, to: end }),
    listActivities(benv.DB, { from: prior, to: end }),
    opts.lite ? none<Event>() : listEvents(benv.DB, { from: start, to: opts.eventsTo && opts.eventsTo > end ? opts.eventsTo : end }),
    listPhases(benv.DB, { from: start, to: end }),
    listMarkers(benv.DB, { from: prior, to: end }),
    opts.lite ? none<DayNote>() : listDayNotes(benv.DB, { from: start, to: end }),
    opts.lite ? none<WellnessDay>() : listWellness(benv.DB, { from: opts.wellnessFrom ?? start, to: end }),
    listWeekNotes(benv.DB, { from: isoWeekOf(prior), to: isoWeekOf(end) }),
    dailyLoads(benv.DB),
  ]);
  // Pairs that cross the window edge (manual pairs can span dates).
  const actIds = new Set(activities.map((a) => a.id));
  const wIds = new Set(workouts.map((w) => w.id));
  const missingActs = workouts.map((w) => w.pairedActivityId).filter((id): id is string => !!id && !actIds.has(id));
  const missingWs = activities.map((a) => a.pairedWorkoutId).filter((id): id is string => !!id && !wIds.has(id));
  const [extraActs, extraWs] = await Promise.all([
    missingActs.length ? listActivities(benv.DB, { ids: missingActs }) : Promise.resolve([] as Activity[]),
    missingWs.length ? listWorkouts(benv.DB, { ids: missingWs }) : Promise.resolve([] as PlannedWorkout[]),
  ]);
  const dw = decorateWorkouts([...workouts, ...extraWs], [...activities, ...extraActs], markers, today);
  const da = decorateActivities(activities, dw, markers, today);
  return {
    today,
    start,
    end,
    prior,
    workouts: dw.filter((w) => w.date >= prior && w.date <= end),
    activities: da,
    events,
    phases,
    markers,
    dayNotes,
    wellness,
    weekNotes,
    daily,
    roundTrips: db.roundTrips,
  };
}

/** Week summaries for every ISO week in [start, end] of a loaded window. */
export function computeWeeks(data: WindowData): { weeks: WeekSummary[]; fitness: FitnessDay[] } {
  const { today, start, end, prior } = data;
  const fitness = fitnessFrom(data.daily, plannedRemainingDaily(data.workouts, today), prior, end, today);
  const weeks = buildWeekSummaries({
    workouts: data.workouts,
    activities: data.activities,
    fitness,
    weekNotes: data.weekNotes,
    phases: data.phases,
    from: start,
    to: end,
    today,
  }).map((w) => {
    // Week compliance excludes excused workouts (sick/injured/travel markers, skips) — §3.6.3.
    const items = data.workouts.filter((x) => x.date >= w.startDate && x.date <= w.endDate);
    const c = weeklyCompliance(items, today);
    return roundWeek({ ...w, compliancePct: c === null ? null : c * 100 });
  });
  return { weeks, fitness };
}

function roundWeek(w: WeekSummary): WeekSummary {
  const round = (v: number) => Math.round(v * 10) / 10;
  const frac = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
  return {
    ...w,
    plannedLoad: round(w.plannedLoad),
    doneLoad: round(w.doneLoad),
    projectedLoad: round(w.projectedLoad),
    doneDistanceM: round(w.doneDistanceM),
    elevationGainM: round(w.elevationGainM),
    compliancePct: w.compliancePct === null ? null : round(w.compliancePct),
    fitness: round(w.fitness),
    fatigue: round(w.fatigue),
    form: round(w.form),
    formPct: w.formPct === null ? null : round(w.formPct),
    fitnessDelta: round(w.fitnessDelta),
    wowSec: frac(w.wowSec),
    wowLoad: frac(w.wowLoad),
    wowDistanceM: frac(w.wowDistanceM),
    dailyLoad: w.dailyLoad.map(round),
    bySport: w.bySport.map((s) => ({ ...s, plannedLoad: round(s.plannedLoad), doneLoad: round(s.doneLoad), doneDistanceM: round(s.doneDistanceM), elevationGainM: round(s.elevationGainM) })),
  };
}

export async function weekSummaries(env: Env, q: { from: LocalDate; to: LocalDate }): Promise<WeekSummary[]> {
  const data = await loadWindow(env, q.from, q.to, { lite: true });
  return computeWeeks(data).weeks;
}
