import { Hono } from 'hono';
import type { AppEnv } from '../env';

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const demoRoutes = new Hono<AppEnv>();
