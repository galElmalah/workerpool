import { Hono } from 'hono';
import { z } from 'zod';
import { DayMarker, Event, IsoWeek, LocalDate, Phase, WellnessDay } from '@cadence/core/domain';
import { isoWeekday } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { badRequest, notFound } from '../lib/http';
import { newId } from '../lib/ids';
import {
  deleteById,
  deleteDayNote,
  getDayNote,
  getEvent,
  getMarker,
  getPhase,
  getWeekNote,
  getWellness,
  insertEvents,
  insertMarkers,
  insertPhases,
  listAllEvents,
  listDayNotes,
  listEvents,
  listMarkers,
  listPhases,
  putDayNote,
  putWeekNote,
  putWellnessManual,
} from '../db/furniture';
import { validate } from '../services/context';

const OptRange = z.object({ from: LocalDate.optional(), to: LocalDate.optional() });
const FAR_PAST = '0000-01-01';
const FAR_FUTURE = '9999-12-31';

/** Turn a PATCH body (null = clear) into the next object. */
function merge<T extends object>(cur: T, patch: Record<string, unknown>): T {
  const next = { ...cur } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === 'id') continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as T;
}

function checkPhase(p: Pick<Phase, 'startDate' | 'endDate'>): void {
  if (isoWeekday(p.startDate) !== 1) throw badRequest('A phase starts on a Monday', 'validation');
  if (isoWeekday(p.endDate) !== 7) throw badRequest('A phase ends on a Sunday', 'validation');
  if (p.endDate < p.startDate) throw badRequest('Phase end is before its start', 'validation');
}

function checkMarker(m: Pick<DayMarker, 'date' | 'endDate'>): void {
  if (m.endDate && m.endDate < m.date) throw badRequest('Marker end is before its start', 'validation');
}

const EventInput = Event.omit({ id: true }).extend({ priority: Event.shape.priority.default('B') });
const EventPatch = Event.omit({ id: true })
  .partial()
  .extend({
    sport: Event.shape.sport.unwrap().nullable().optional(),
    distanceM: z.number().nullable().optional(),
    goal: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    resultActivityId: z.string().nullable().optional(),
  });
const PhaseInput = Phase.omit({ id: true });
const PhasePatch = PhaseInput.partial().extend({ weeklyLoadTarget: z.number().nullable().optional() });
const MarkerInput = DayMarker.omit({ id: true });
const MarkerPatch = MarkerInput.partial().extend({ endDate: LocalDate.nullable().optional(), label: z.string().nullable().optional() });

const WellnessInput = z.object({
  feel: WellnessDay.shape.feel.unwrap().nullable().optional(),
  soreness: WellnessDay.shape.soreness.unwrap().nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  weightKg: z.number().positive().max(400).nullable().optional(),
});

const WeekNoteInput = z.object({
  body: z.string().max(50_000).default(''),
  targetHours: z.number().nonnegative().nullable().optional(),
  targetLoad: z.number().nonnegative().nullable().optional(),
});

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const furnitureRoutes = new Hono<AppEnv>()
  // ───────────── events ─────────────
  .get('/events', validate('query', OptRange), async (c) => {
    const q = c.req.valid('query');
    const list = q.from || q.to ? await listEvents(c.env.DB, { from: q.from ?? FAR_PAST, to: q.to ?? FAR_FUTURE }) : await listAllEvents(c.env.DB);
    return c.json(list);
  })
  .post('/events', validate('json', EventInput), async (c) => {
    const e: Event = { ...c.req.valid('json'), id: newId('evt') };
    await insertEvents(c.env.DB, [e]);
    return c.json(e, 201);
  })
  .get('/events/:id', async (c) => {
    const e = await getEvent(c.env.DB, c.req.param('id'));
    if (!e) throw notFound('Event');
    return c.json(e);
  })
  .patch('/events/:id', validate('json', EventPatch), async (c) => {
    const cur = await getEvent(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Event');
    const next = merge(cur, c.req.valid('json'));
    await insertEvents(c.env.DB, [next]);
    return c.json(next);
  })
  .delete('/events/:id', async (c) => {
    const cur = await getEvent(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Event');
    await deleteById(c.env.DB, 'events', cur.id);
    await c.env.DB.prepare('UPDATE workouts SET event_id = NULL WHERE event_id = ?').bind(cur.id).run();
    return c.json(cur);
  })
  // ───────────── phases ─────────────
  .get('/phases', validate('query', OptRange), async (c) => {
    const q = c.req.valid('query');
    return c.json(await listPhases(c.env.DB, { from: q.from ?? FAR_PAST, to: q.to ?? FAR_FUTURE }));
  })
  .post('/phases', validate('json', PhaseInput), async (c) => {
    const p: Phase = { ...c.req.valid('json'), id: newId('ph') };
    checkPhase(p);
    await insertPhases(c.env.DB, [p]);
    return c.json(p, 201);
  })
  .get('/phases/:id', async (c) => {
    const p = await getPhase(c.env.DB, c.req.param('id'));
    if (!p) throw notFound('Phase');
    return c.json(p);
  })
  .patch('/phases/:id', validate('json', PhasePatch), async (c) => {
    const cur = await getPhase(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Phase');
    const next = merge(cur, c.req.valid('json'));
    checkPhase(next);
    await insertPhases(c.env.DB, [next]);
    return c.json(next);
  })
  .delete('/phases/:id', async (c) => {
    const cur = await getPhase(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Phase');
    await deleteById(c.env.DB, 'phases', cur.id);
    return c.json(cur);
  })
  // ───────────── day markers ─────────────
  .get('/markers', validate('query', OptRange), async (c) => {
    const q = c.req.valid('query');
    return c.json(await listMarkers(c.env.DB, { from: q.from ?? FAR_PAST, to: q.to ?? FAR_FUTURE }));
  })
  .post('/markers', validate('json', MarkerInput), async (c) => {
    const m: DayMarker = { ...c.req.valid('json'), id: newId('mk') };
    if (m.endDate === m.date) delete m.endDate;
    checkMarker(m);
    await insertMarkers(c.env.DB, [m]);
    return c.json(m, 201);
  })
  .get('/markers/:id', async (c) => {
    const m = await getMarker(c.env.DB, c.req.param('id'));
    if (!m) throw notFound('Marker');
    return c.json(m);
  })
  .patch('/markers/:id', validate('json', MarkerPatch), async (c) => {
    const cur = await getMarker(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Marker');
    const next = merge(cur, c.req.valid('json'));
    if (next.endDate === next.date) delete next.endDate;
    checkMarker(next);
    await insertMarkers(c.env.DB, [next]);
    return c.json(next);
  })
  .delete('/markers/:id', async (c) => {
    const cur = await getMarker(c.env.DB, c.req.param('id'));
    if (!cur) throw notFound('Marker');
    await deleteById(c.env.DB, 'day_markers', cur.id);
    return c.json(cur);
  })
  // ───────────── notes ─────────────
  .get('/day-notes', validate('query', OptRange), async (c) => {
    const q = c.req.valid('query');
    return c.json(await listDayNotes(c.env.DB, { from: q.from ?? FAR_PAST, to: q.to ?? FAR_FUTURE }));
  })
  .get('/day-notes/:date', validate('param', z.object({ date: LocalDate })), async (c) => {
    return c.json(await getDayNote(c.env.DB, c.req.valid('param').date));
  })
  .put('/day-notes/:date', validate('param', z.object({ date: LocalDate })), validate('json', z.object({ body: z.string().max(50_000) })), async (c) => {
    const { date } = c.req.valid('param');
    const { body } = c.req.valid('json');
    // an empty body removes the note (response: null)
    if (!body.trim()) await deleteDayNote(c.env.DB, date);
    else await putDayNote(c.env.DB, date, body);
    return c.json(await getDayNote(c.env.DB, date));
  })
  .delete('/day-notes/:date', validate('param', z.object({ date: LocalDate })), async (c) => {
    const { date } = c.req.valid('param');
    const prev = await getDayNote(c.env.DB, date);
    await deleteDayNote(c.env.DB, date);
    return c.json({ deleted: prev });
  })
  .get('/week-notes/:isoWeek', validate('param', z.object({ isoWeek: IsoWeek })), async (c) => {
    return c.json(await getWeekNote(c.env.DB, c.req.valid('param').isoWeek));
  })
  .put('/week-notes/:isoWeek', validate('param', z.object({ isoWeek: IsoWeek })), validate('json', WeekNoteInput), async (c) => {
    const { isoWeek } = c.req.valid('param');
    const body = c.req.valid('json');
    const cur = await getWeekNote(c.env.DB, isoWeek);
    const pick = (v: number | null | undefined, prev: number | undefined) => (v === null ? undefined : (v ?? prev));
    await putWeekNote(c.env.DB, {
      isoWeek,
      body: body.body,
      targetHours: pick(body.targetHours, cur?.targetHours),
      targetLoad: pick(body.targetLoad, cur?.targetLoad),
    });
    return c.json((await getWeekNote(c.env.DB, isoWeek))!);
  })
  // ───────────── wellness (manual check-in) ─────────────
  .get('/wellness/:date', validate('param', z.object({ date: LocalDate })), async (c) => {
    const { date } = c.req.valid('param');
    return c.json((await getWellness(c.env.DB, date)) ?? ({ date } as WellnessDay));
  })
  .put('/wellness/:date', validate('param', z.object({ date: LocalDate })), validate('json', WellnessInput), async (c) => {
    const { date } = c.req.valid('param');
    await putWellnessManual(c.env.DB, date, c.req.valid('json'));
    return c.json((await getWellness(c.env.DB, date)) ?? ({ date } as WellnessDay));
  });
