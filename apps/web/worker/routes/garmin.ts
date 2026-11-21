import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SyncLogEntry } from '@cadence/core/domain';
import type { AppEnv } from '../env';
import { listSyncLog } from '../db/sync';
import { badRequest } from '../lib/http';
import { ConnectInput, connectGarmin, disconnectGarmin } from '../services/garmin';
import { pushUpcoming, pushWorkout, unpushWorkout } from '../services/push';
import {
  backfillProgress,
  cancelBackfill,
  createBackfill,
  garminStatus,
  getBackfill,
  runBackfillStepNow,
  runSync,
  type SyncReport,
} from '../services/sync';
import { ApiError } from '../lib/http';

const validationHook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    const issues = (result.error as { issues?: { path: PropertyKey[]; message: string }[] })?.issues ?? [];
    throw badRequest(issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') || 'Invalid request');
  }
};

const BackfillInput = z.object({ months: z.number().min(0.25).max(120).default(12), wellness: z.boolean().optional() });
const LogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  kind: SyncLogEntry.shape.kind.optional(),
});

function reportOrThrow(r: SyncReport): SyncReport {
  if (r.status === 'error' && r.error) {
    const status = r.error.code === 'garmin_rate_limited' ? 429 : r.error.code === 'garmin_blocked' ? 503 : r.error.code === 'garmin_auth_failed' ? 400 : 502;
    throw new ApiError(status, r.error.code, r.error.message);
  }
  if (r.status === 'skipped' && r.skippedBecause === 'locked') throw new ApiError(409, 'sync_in_progress', 'A Garmin sync is already running; try again in a moment.');
  if (r.status === 'skipped' && r.skippedBecause === 'not_connected') throw new ApiError(409, 'garmin_not_connected', 'Connect Garmin first (Settings → Garmin).');
  if (r.status === 'skipped' && r.skippedBecause === 'backoff') throw new ApiError(429, 'garmin_rate_limited', r.summary);
  return r;
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const garminRoutes = new Hono<AppEnv>()
  .get('/garmin/status', async (c) => c.json(await garminStatus(c.env)))
  .post('/garmin/connect', zValidator('json', ConnectInput, validationHook), async (c) => {
    const input = c.req.valid('json');
    const res = await connectGarmin(c.env, input);
    if (res.state === 'connected' && input.initialSync !== false) {
      c.executionCtx.waitUntil(runSync(c.env, { reason: 'connect', wellnessDays: 14 }).catch((e) => console.error('initial sync failed', e)));
    }
    return c.json({ ...(await garminStatus(c.env)), result: res.state });
  })
  .delete('/garmin/connect', async (c) => {
    await disconnectGarmin(c.env);
    return c.json(await garminStatus(c.env));
  })
  .post('/garmin/sync', async (c) => c.json(reportOrThrow(await runSync(c.env, { reason: 'manual' }))))
  .post('/garmin/backfill', zValidator('json', BackfillInput, validationHook), async (c) => {
    const { months, wellness } = c.req.valid('json');
    await createBackfill(c.env, { months, ...(wellness !== undefined ? { wellness } : {}) });
    // A light first step (list + a few activities) so the UI shows progress right away.
    const p = await runBackfillStepNow(c.env, { maxActivities: 5 });
    return c.json(p ?? backfillProgress((await getBackfill(c.env))!));
  })
  .post('/garmin/backfill/step', async (c) => {
    const p = await runBackfillStepNow(c.env);
    if (!p) throw new ApiError(404, 'not_found', 'No backfill has been started');
    return c.json(p);
  })
  .get('/garmin/backfill', async (c) => {
    const s = await getBackfill(c.env);
    if (!s) throw new ApiError(404, 'not_found', 'No backfill has been started');
    return c.json(backfillProgress(s));
  })
  .delete('/garmin/backfill', async (c) => {
    const s = await cancelBackfill(c.env);
    return c.json(s ? backfillProgress(s) : { running: false });
  })
  .post('/garmin/push-upcoming', async (c) => c.json(await pushUpcoming(c.env)))
  .post('/garmin/push/:workoutId', async (c) => c.json(await pushWorkout(c.env, c.req.param('workoutId'))))
  .delete('/garmin/push/:workoutId', async (c) => {
    await unpushWorkout(c.env, c.req.param('workoutId'));
    return c.json({ ok: true as const });
  })
  .get('/sync/log', zValidator('query', LogQuery, validationHook), async (c) => {
    const q = c.req.valid('query');
    return c.json(await listSyncLog(c.env.DB, q));
  });
