import { Hono } from 'hono';
import type { AppEnv } from './env';
import { isDemo } from './env';
import { errorResponse } from './lib/http';
import { requireAuth } from './middleware/auth';
import { runScheduled } from './cron';
import { authRoutes } from './routes/auth';
import { calendarRoutes } from './routes/calendar';
import { workoutsRoutes } from './routes/workouts';
import { templatesRoutes } from './routes/templates';
import { furnitureRoutes } from './routes/furniture';
import { activitiesRoutes } from './routes/activities';
import { trendsRoutes } from './routes/trends';
import { weeksRoutes } from './routes/weeks';
import { todayRoutes } from './routes/today';
import { journalRoutes } from './routes/journal';
import { searchRoutes } from './routes/search';
import { settingsRoutes } from './routes/settings';
import { dataRoutes } from './routes/data';
import { garminRoutes } from './routes/garmin';
import { demoRoutes } from './routes/demo';

const app = new Hono<AppEnv>().basePath('/api');

app.onError((err, c) => errorResponse(c, err));
app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404));
app.use('*', requireAuth);

// Every module defines full paths (e.g. '/workouts/:id') and is mounted at the API root so the
// chained type below carries the whole surface to the SPA's typed client (hc<AppType>).
const routes = app
  .get('/health', (c) => c.json({ ok: true, demo: isDemo(c.env) }))
  .route('/', authRoutes)
  .route('/', calendarRoutes)
  .route('/', workoutsRoutes)
  .route('/', templatesRoutes)
  .route('/', furnitureRoutes)
  .route('/', activitiesRoutes)
  .route('/', trendsRoutes)
  .route('/', weeksRoutes)
  .route('/', todayRoutes)
  .route('/', journalRoutes)
  .route('/', searchRoutes)
  .route('/', settingsRoutes)
  .route('/', dataRoutes)
  .route('/', garminRoutes)
  .route('/', demoRoutes);

export type AppType = typeof routes;

export default {
  fetch: app.fetch,
  scheduled: runScheduled,
} satisfies ExportedHandler<Env>;
