import type { ValidationTargets } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import type { LocalDate } from '@cadence/core/domain';
import { todayIn } from '@cadence/core/time';
import { getSettings } from '../db/settings';
import { DEMO_NOW_KEY, getState } from '../db/sync';
import { isDemo } from '../env';
import { ApiError } from '../lib/http';

/**
 * "Today" in the athlete's timezone (settings.timezone). In demo mode the pinned demo clock
 * (`sync_state['demo:now']`, epoch ms — set by `POST /demo/seed`, moved by `POST /demo/advance`)
 * replaces real time, so a seeded demo keeps its "today" and agrees with the sync engine.
 */
export async function getToday(env: Env): Promise<LocalDate> {
  const [settings, demoMs] = await Promise.all([getSettings(env.DB), isDemo(env) ? getState<number>(env.DB, DEMO_NOW_KEY) : undefined]);
  const now = typeof demoMs === 'number' && Number.isFinite(demoMs) ? new Date(demoMs) : undefined;
  return now ? todayIn(settings.timezone, now) : todayIn(settings.timezone);
}

/** Human-readable summary of zod issues: "date: YYYY-MM-DD; title: Required". */
export function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/**
 * zod validator middleware that fails with the API error shape
 * `400 { error: { code: 'validation', message } }` instead of the raw zod result.
 */
export const validate = <T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new ApiError(400, 'validation', describeIssues(result.error.issues));
  });
