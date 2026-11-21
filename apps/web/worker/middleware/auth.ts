import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

/**
 * Guards every /api route except /api/health and /api/auth/*.
 * Placeholder: lets everything through until the auth module lands.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('authenticated', true);
  await next();
});
