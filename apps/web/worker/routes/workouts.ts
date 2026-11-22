import { Hono } from 'hono';
import { z } from 'zod';
import { IsoWeek, LocalDate, PlannedWorkout, PlannedWorkoutInput, SKIP_REASONS, Sport, WorkoutStructure } from '@cadence/core/domain';
import { addDays, isoWeekStart, weekStart } from '@cadence/core/time';
import { formatWorkoutText, parseQuickAdd, parseWorkoutText } from '@cadence/core/workout';
import type { AppEnv } from '../env';
import { badRequest, notFound } from '../lib/http';
import { nowIso } from '../lib/ids';
import { first } from '../db/sql';
import { thresholdsOn } from '../db/thresholds';
import { getWorkout, listWorkouts, updateWorkouts } from '../db/workouts';
import { getToday, validate } from '../services/context';
import {
  EstimateInput,
  PlannedWorkoutPatch,
  copyWeekPlan,
  createWorkout,
  deleteWorkoutsById,
  duplicateWorkout,
  estimatePlanned,
  patchWorkout,
  repeatWorkout,
  restoreWorkouts,
  shiftPlan,
} from '../services/planning';
import { withCompliance } from '../services/compliance';
import { pairManually, rePairDates, unpair } from '../services/pairing';
import { markWorkoutDirty } from '../services/push';

const Range = z.object({ from: LocalDate.optional(), to: LocalDate.optional() });
const Scope = z.object({ scope: z.enum(['this', 'following']).optional() });
const CreateInput = PlannedWorkoutInput.extend({ title: z.string().optional() });
/** A week given as 'YYYY-Www' or any date inside it → that week's Monday. */
const WeekRef = z.union([IsoWeek, LocalDate]).transform((v) => (v.includes('W') ? isoWeekStart(v) : weekStart(v)));

async function decorate(env: Env, workouts: PlannedWorkout[]): Promise<PlannedWorkout[]> {
  return workouts.length ? withCompliance(env, workouts) : workouts;
}

async function decorateOne(env: Env, w: PlannedWorkout): Promise<PlannedWorkout> {
  return (await decorate(env, [w]))[0] ?? w;
}

async function mustGet(env: Env, id: string): Promise<PlannedWorkout> {
  const w = await getWorkout(env.DB, id);
  if (!w) throw notFound('Workout');
  return w;
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const workoutsRoutes = new Hono<AppEnv>()
  .get('/workouts', validate('query', Range), async (c) => {
    const q = c.req.valid('query');
    const today = await getToday(c.env);
    const from = q.from ?? addDays(today, -42);
    const to = q.to ?? addDays(today, 84);
    if (from > to) throw badRequest('from must be ≤ to', 'validation');
    return c.json(await decorate(c.env, await listWorkouts(c.env.DB, { from, to })));
  })
  .post('/workouts', validate('json', CreateInput), async (c) => {
    const input = c.req.valid('json');
    const w = await createWorkout(c.env, { ...input, title: input.title ?? '' });
    await rePairDates(c.env, [w.date]);
    return c.json(await decorateOne(c.env, (await getWorkout(c.env.DB, w.id)) ?? w), 201);
  })
  .post('/workouts/quick', validate('json', z.object({ date: LocalDate, text: z.string().trim().min(1).max(500), startTime: z.string().regex(/^\d{2}:\d{2}$/).optional() })), async (c) => {
    const { date, text, startTime } = c.req.valid('json');
    const firstWord = text.split(/\s+/)[0]?.toLowerCase() ?? '';
    const guess = Sport.safeParse(firstWord);
    const th = await thresholdsOn(c.env.DB, date, guess.success ? guess.data : 'bike');
    const q = parseQuickAdd(text, { thresholds: th });
    const w = await createWorkout(c.env, {
      date,
      ...(startTime ? { startTime } : {}),
      sport: q.sport,
      ...(q.subSport ? { subSport: q.subSport } : {}),
      title: q.title,
      ...(q.structure ? { structure: q.structure } : {}),
      ...(q.durationSec !== undefined && !q.structure ? { plannedDurationSec: q.durationSec } : {}),
      ...(q.distanceM !== undefined && !q.structure ? { plannedDistanceM: q.distanceM } : {}),
      intensity: q.intensity,
      isKey: q.isKey,
      tags: q.tags,
    });
    await rePairDates(c.env, [w.date]);
    return c.json({ workout: await decorateOne(c.env, (await getWorkout(c.env.DB, w.id)) ?? w), issues: q.issues }, 201);
  })
  .post('/workouts/estimate', validate('json', EstimateInput), async (c) => {
    return c.json(await estimatePlanned(c.env, c.req.valid('json'), await getToday(c.env)));
  })
  .post('/workouts/parse', validate('json', z.object({ sport: Sport, text: z.string().max(20_000), date: LocalDate.optional() })), async (c) => {
    const { sport, text, date } = c.req.valid('json');
    const th = await thresholdsOn(c.env.DB, date ?? (await getToday(c.env)), sport);
    const r = parseWorkoutText(text, sport, { thresholds: th });
    return c.json({ structure: r.structure, ...(r.title ? { title: r.title } : {}), issues: r.issues, meta: r.meta });
  })
  .post('/workouts/format', validate('json', z.object({ sport: Sport, structure: WorkoutStructure })), async (c) => {
    const { sport, structure } = c.req.valid('json');
    return c.json({ text: formatWorkoutText(structure, sport) });
  })
  .get('/workouts/:id', async (c) => c.json(await decorateOne(c.env, await mustGet(c.env, c.req.param('id')))))
  .patch('/workouts/:id', validate('query', Scope), validate('json', PlannedWorkoutPatch), async (c) => {
    const { workout } = await patchWorkout(c.env, c.req.param('id'), c.req.valid('json'), c.req.valid('query').scope ?? 'this');
    return c.json(await decorateOne(c.env, workout));
  })
  .delete('/workouts/:id', validate('query', Scope), async (c) => {
    const w = await mustGet(c.env, c.req.param('id'));
    const scope = c.req.valid('query').scope ?? 'this';
    let ids = [w.id];
    if (scope === 'following' && w.seriesId) {
      const series = await listWorkouts(c.env.DB, { from: w.date });
      ids = series.filter((s) => s.seriesId === w.seriesId).map((s) => s.id);
    }
    const deleted = await deleteWorkoutsById(c.env, ids);
    return c.json({ deleted });
  })
  .post('/workouts/:id/duplicate', validate('json', z.object({ date: LocalDate })), async (c) => {
    const copy = await duplicateWorkout(c.env, c.req.param('id'), c.req.valid('json').date);
    return c.json(await decorateOne(c.env, copy), 201);
  })
  .post(
    '/workouts/:id/repeat',
    validate(
      'json',
      z.object({
        weeks: z.number().int().min(2).max(52),
        weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
        progressionPct: z.number().min(-40).max(20).optional(),
      }),
    ),
    async (c) => {
      const series = await repeatWorkout(c.env, c.req.param('id'), c.req.valid('json'));
      return c.json({ seriesId: series[0].seriesId!, workouts: await decorate(c.env, series) }, 201);
    },
  )
  .post('/workouts/:id/skip', validate('json', z.object({ reason: z.enum(SKIP_REASONS).default('other') })), async (c) => {
    const w = await mustGet(c.env, c.req.param('id'));
    const next: PlannedWorkout = { ...w, status: 'skipped', skipReason: c.req.valid('json').reason, updatedAt: nowIso() };
    await updateWorkouts(c.env.DB, [next]);
    if (w.garmin.workoutId || w.garmin.scheduleId) await markWorkoutDirty(c.env, w.id);
    if (w.status !== 'skipped') await rePairDates(c.env, [w.date]);
    return c.json(await decorateOne(c.env, (await getWorkout(c.env.DB, w.id))!));
  })
  .delete('/workouts/:id/skip', async (c) => {
    const w = await mustGet(c.env, c.req.param('id'));
    const next: PlannedWorkout = { ...w, status: 'planned', updatedAt: nowIso() };
    delete next.skipReason;
    await updateWorkouts(c.env.DB, [next]);
    if (w.garmin.workoutId || w.garmin.scheduleId) await markWorkoutDirty(c.env, w.id);
    if (w.status !== 'planned') await rePairDates(c.env, [w.date]);
    return c.json(await decorateOne(c.env, (await getWorkout(c.env.DB, w.id))!));
  })
  .post('/workouts/:id/pair', validate('json', z.object({ activityId: z.string().min(1) })), async (c) => {
    const w = await mustGet(c.env, c.req.param('id'));
    const { activityId } = c.req.valid('json');
    const act = await first(c.env.DB, 'SELECT id FROM activities WHERE id = ? AND deleted_at IS NULL', activityId);
    if (!act) throw notFound('Activity');
    await pairManually(c.env, w.id, activityId);
    return c.json(await decorateOne(c.env, await mustGet(c.env, w.id)));
  })
  .delete('/workouts/:id/pair', async (c) => {
    const w = await mustGet(c.env, c.req.param('id'));
    await unpair(c.env, w.id);
    return c.json(await decorateOne(c.env, await mustGet(c.env, w.id)));
  })
  // ───────────── bulk ─────────────
  .post(
    '/calendar/copy-week',
    validate(
      'json',
      z.object({
        fromWeek: WeekRef,
        toWeek: WeekRef,
        progressionPct: z.number().min(-40).max(20).default(0),
        includeNotes: z.boolean().optional(),
        includeKey: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const b = c.req.valid('json');
      if (b.fromWeek === b.toWeek) throw badRequest('Choose a different target week', 'validation');
      const created = await copyWeekPlan(c.env, b.fromWeek, b.toWeek, b);
      return c.json({ created: await decorate(c.env, created) }, 201);
    },
  )
  .post(
    '/calendar/shift',
    validate('json', z.object({ fromDate: LocalDate, days: z.number().int().min(-366).max(366), includeEvents: z.boolean().optional() })),
    async (c) => {
      const b = c.req.valid('json');
      const r = await shiftPlan(c.env, b.fromDate, b.days, { includeEvents: b.includeEvents });
      return c.json({ moved: await decorate(c.env, r.moved), previous: r.previous, eventsMoved: r.eventsMoved });
    },
  )
  .post('/calendar/restore', validate('json', z.object({ workouts: z.array(PlannedWorkout).max(1000) })), async (c) => {
    const restored = await restoreWorkouts(c.env, c.req.valid('json').workouts);
    return c.json({ restored: await decorate(c.env, restored) });
  })
  .post('/calendar/delete', validate('json', z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) })), async (c) => {
    const deleted = await deleteWorkoutsById(c.env, c.req.valid('json').ids);
    return c.json({ deleted });
  });
