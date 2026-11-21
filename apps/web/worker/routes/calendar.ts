import { Hono } from 'hono';
import { z } from 'zod';
import { LocalDate, type CalendarResponse } from '@cadence/core/domain';
import { diffDays } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { badRequest } from '../lib/http';
import { validate } from '../services/context';
import { computeWeeks, loadWindow } from '../services/analytics';

const RangeQuery = z.object({ from: LocalDate, to: LocalDate });

/** Max span of one calendar request (days). */
const MAX_SPAN_DAYS = 400;

/**
 * Calendar payload for [from, to] expanded to whole ISO weeks. One D1 round trip for
 * everything (two when a manual pair crosses the window edge); week summaries, fitness and
 * compliance are computed in memory.
 */
export async function buildCalendar(env: Env, from: LocalDate, to: LocalDate): Promise<CalendarResponse & { roundTrips: number }> {
  if (to < from) throw badRequest('`to` must not be before `from`');
  if (diffDays(from, to) > MAX_SPAN_DAYS) throw badRequest(`Range too long (max ${MAX_SPAN_DAYS} days)`);
  const data = await loadWindow(env, from, to);
  const { weeks } = computeWeeks(data);
  const inRange = (d: LocalDate) => d >= data.start && d <= data.end;
  return {
    from: data.start,
    to: data.end,
    today: data.today,
    workouts: data.workouts.filter((w) => inRange(w.date)),
    activities: data.activities.filter((a) => inRange(a.localDate)),
    events: data.events,
    phases: data.phases,
    markers: data.markers.filter((m) => (m.endDate ?? m.date) >= data.start),
    dayNotes: data.dayNotes,
    wellness: data.wellness,
    weeks,
    roundTrips: data.roundTrips,
  };
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const calendarRoutes = new Hono<AppEnv>().get('/calendar', validate('query', RangeQuery), async (c) => {
  const { from, to } = c.req.valid('query');
  const { roundTrips: _rt, ...body } = await buildCalendar(c.env, from, to);
  return c.json(body satisfies CalendarResponse);
});
