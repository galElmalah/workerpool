import { Hono } from 'hono';

export type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>().basePath('/api');

const routes = app.get('/health', (c) => c.json({ ok: true, demo: c.env.DEMO_MODE === '1' }));

export type AppType = typeof routes;

export default {
  fetch: app.fetch,
  async scheduled(_controller, _env, _ctx) {
    // Garmin sync is wired in by the sync engine.
  },
} satisfies ExportedHandler<Env>;
