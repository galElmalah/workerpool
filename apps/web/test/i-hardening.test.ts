/** Integration hardening: auth on every route, demo gating, error shape, body limits, cron safety. */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import worker from '../worker/index';
import { errorResponse } from '../worker/lib/http';
import { runCron } from '../worker/cron';
import { api, anon, BASE, json } from './helpers';

/** Representative routes of every module (ids need not exist: auth runs first). */
const ROUTES: [string, string][] = [
  ['GET', '/calendar?from=2026-11-16&to=2026-11-22'],
  ['GET', '/workouts'],
  ['POST', '/workouts'],
  ['PATCH', '/workouts/wk_x'],
  ['DELETE', '/workouts/wk_x'],
  ['POST', '/workouts/quick'],
  ['POST', '/workouts/wk_x/pair'],
  ['POST', '/calendar/shift'],
  ['POST', '/calendar/restore'],
  ['GET', '/activities'],
  ['GET', '/activities/act_x'],
  ['GET', '/activities/act_x/streams'],
  ['PATCH', '/activities/act_x'],
  ['DELETE', '/activities/act_x'],
  ['POST', '/activities/upload'],
  ['POST', '/activities/manual'],
  ['GET', '/templates'],
  ['POST', '/templates/tpl_x/schedule'],
  ['GET', '/events'],
  ['PUT', '/day-notes/2026-11-20'],
  ['GET', '/trends/fitness'],
  ['GET', '/trends/weekly'],
  ['GET', '/weeks/2026-W47'],
  ['GET', '/today'],
  ['GET', '/journal'],
  ['GET', '/search?q=run'],
  ['GET', '/settings'],
  ['PATCH', '/settings'],
  ['GET', '/thresholds'],
  ['GET', '/zones'],
  ['GET', '/export/json'],
  ['POST', '/import/json'],
  ['GET', '/garmin/status'],
  ['POST', '/garmin/connect'],
  ['POST', '/garmin/sync'],
  ['GET', '/sync/log'],
  ['POST', '/demo/seed'],
  ['POST', '/demo/advance'],
  ['GET', '/demo/status'],
  ['GET', '/no-such-route'],
  ['GET', '/authx'],
];

async function sessionCookie(): Promise<string> {
  await json('/settings'); // ensures the passphrase is set up (helpers sign in)
  const res = await anon('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: 'correct horse battery staple' }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie') ?? '';
}

describe('hardening', () => {
  it('every /api route except health and auth/* requires a session', async () => {
    for (const [method, path] of ROUTES) {
      const res = await anon(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
    expect((await anon('/health')).status).toBe(200);
    expect((await anon('/auth/status')).status).toBe(200);
  });

  it('the session cookie is HttpOnly, SameSite=Lax, Secure on https, path /', async () => {
    const raw = await sessionCookie();
    expect(raw).toMatch(/^cadence_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/Path=\//i);
    expect(raw).toMatch(/Max-Age=\d+/i);
  });

  it('demo routes 404 unless DEMO_MODE=1 (even when signed in)', async () => {
    const cookie = (await sessionCookie()).split(';')[0];
    const prodEnv = { ...env, DEMO_MODE: '0' };
    for (const [method, path] of [['POST', '/demo/seed'], ['POST', '/demo/reset'], ['POST', '/demo/advance'], ['GET', '/demo/status'], ['POST', '/demo/seed/step']]) {
      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request(`${BASE}/api${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{"days":1}' }),
        prodEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // The demo Garmin account cannot be connected in production either.
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${BASE}/api/garmin/connect`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"demo":true}' }),
      prodEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it('malformed JSON is a 400 with the API error shape, not a 500', async () => {
    const res = await api('/workouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"date":' as unknown as object });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBeTruthy();
  });

  it('unexpected errors return a generic 500 without internals', async () => {
    const app = new Hono().get('/boom', () => {
      throw new Error('D1_ERROR: no such column: secret_col at SELECT * FROM auth');
    });
    app.onError((err, c) => errorResponse(c, err));
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/secret_col|SELECT|at /);
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Unexpected server error' } });
  });

  it('upload and import bodies are size-limited (413)', async () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    const up = await api('/activities/upload', { method: 'POST', body: big });
    expect(up.status).toBe(413);
    expect(await up.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    const imp = await api('/import/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"pad":"${'x'.repeat(33 * 1024 * 1024)}"}` as unknown as object });
    expect(imp.status).toBe(413);
    // Normal-size bodies still pass the limiter (and fail validation as usual).
    const small = await api('/activities/upload', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(small.status).toBe(400);
  });

  it('the cron handler never throws, even when D1 is unusable', async () => {
    const broken = {
      ...env,
      DB: {
        prepare() {
          throw new Error('D1 down');
        },
        batch() {
          return Promise.reject(new Error('D1 down'));
        },
      } as unknown as D1Database,
    };
    await expect(runCron(broken)).resolves.toBeUndefined();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(), cron: '*/30 * * * *' }), broken, ctx);
    await waitOnExecutionContext(ctx);
  });
});
