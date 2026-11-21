import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { LocalDate } from '@cadence/core/domain';
import type { AppEnv } from '../env';
import { isDemo } from '../env';
import { ApiError, badRequest } from '../lib/http';
import { advanceDemo, demoSeedStep, demoStatus, resetDemoData, startDemoSeed } from '../services/demo';

const validationHook = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    const issues = (result.error as { issues?: { path: PropertyKey[]; message: string }[] })?.issues ?? [];
    throw badRequest(issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') || 'Invalid request');
  }
};

/** Every /demo route 404s unless DEMO_MODE=1. */
const demoOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (!isDemo(c.env)) throw new ApiError(404, 'not_found', 'No such endpoint');
  await next();
});

const SeedInput = z.object({
  months: z.number().min(0.5).max(24).optional(),
  today: LocalDate.optional(),
  seed: z.number().int().min(0).max(1_000_000).optional(),
  fast: z.boolean().optional(),
  now: z.string().optional(),
});
const StepInput = z.object({ maxActivities: z.number().int().min(1).max(100).optional() });
const AdvanceInput = z
  .object({ days: z.number().min(0).max(60).optional(), to: z.string().optional() })
  .refine((v) => v.days !== undefined || v.to !== undefined, 'days or to is required');

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const demoRoutes = new Hono<AppEnv>()
  .use('/demo/*', demoOnly)
  .post('/demo/seed', async (c) => {
    const parsed = SeedInput.safeParse((await c.req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) validationHook(parsed);
    return c.json(await startDemoSeed(c.env, parsed.data ?? {}));
  })
  .post('/demo/seed/step', async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = StepInput.safeParse(raw ?? {});
    if (!parsed.success) throw badRequest('maxActivities must be an integer 1–100');
    return c.json(await demoSeedStep(c.env, parsed.data));
  })
  .get('/demo/status', async (c) => c.json(await demoStatus(c.env)))
  .post('/demo/reset', async (c) => {
    const tables = await resetDemoData(c.env);
    return c.json({ ok: true as const, tables });
  })
  .post('/demo/advance', zValidator('json', AdvanceInput, validationHook), async (c) => c.json(await advanceDemo(c.env, c.req.valid('json'))));
