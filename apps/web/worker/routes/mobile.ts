import { Hono } from 'hono';
import type { MobileSnapshot } from '@cadence/core/domain';
import type { AppEnv } from '../env';
import { buildMobileSnapshot } from '../services/mobile';

/** Native clients (docs/MOBILE_API.md). Mounted at /api; protected (cookie or device token). */
export const mobileRoutes = new Hono<AppEnv>().get('/mobile/snapshot', async (c) => {
  const snapshot: MobileSnapshot = await buildMobileSnapshot(c.env);
  c.header('Cache-Control', 'private, no-store');
  return c.json(snapshot);
});
