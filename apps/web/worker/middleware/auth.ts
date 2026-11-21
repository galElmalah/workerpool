/**
 * Single-user session auth.
 *
 * Session = `cadence_session` cookie holding an HMAC-SHA256-signed payload `{ v, e, exp }`
 * (e = session epoch from the `auth` row, exp = unix seconds). Verification is stateless apart
 * from the epoch check, which is cached per isolate for EPOCH_TTL_MS; a token whose epoch does
 * not match the cached value forces a fresh read, so a bump is seen at once in this isolate and
 * within the TTL elsewhere.
 */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/http';
import { signToken, verifyToken } from '../lib/crypto';
import { first } from '../db/sql';

export const SESSION_COOKIE = 'cadence_session';
export const SESSION_MAX_AGE_SEC = 60 * 24 * 3600;
const EPOCH_TTL_MS = 30_000;

interface SessionPayload {
  v: 1;
  e: number;
  exp: number;
}

interface AuthState {
  configured: boolean;
  epoch: number;
}

let cached: { state: AuthState; at: number } | null = null;

export async function readAuthState(db: D1Database, fresh = false): Promise<AuthState> {
  if (!fresh && cached && Date.now() - cached.at < EPOCH_TTL_MS) return cached.state;
  const row = await first<{ session_epoch: number }>(db, 'SELECT session_epoch FROM auth WHERE id = 1');
  const state: AuthState = row ? { configured: true, epoch: row.session_epoch } : { configured: false, epoch: 0 };
  cached = { state, at: Date.now() };
  return state;
}

/** Called after setup / passphrase change so this isolate sees the new epoch immediately. */
export function rememberAuthState(state: AuthState): void {
  cached = { state, at: Date.now() };
}

function sessionSecret(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s) throw new ApiError(500, 'misconfigured', 'SESSION_SECRET is not configured');
  return s;
}

/** True when the request carries a valid, unexpired session for the current epoch. */
export async function isAuthenticated(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const p = await verifyToken<SessionPayload>(token, sessionSecret(c.env));
  if (!p || p.v !== 1 || typeof p.exp !== 'number' || p.exp <= Date.now() / 1000) return false;
  let state = await readAuthState(c.env.DB);
  if (state.configured && state.epoch === p.e) return true;
  state = await readAuthState(c.env.DB, true);
  return state.configured && state.epoch === p.e;
}

export async function issueSession(c: Context<AppEnv>, epoch: number): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const token = await signToken({ v: 1, e: epoch, exp } satisfies SessionPayload, sessionSecret(c.env));
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: new URL(c.req.url).protocol === 'https:' });
}

const OPEN = /^\/api\/(health\/?$|auth(\/|$))/;

/** Guards every /api route except /api/health and /api/auth/*. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (OPEN.test(c.req.path)) {
    c.set('authenticated', false);
    return next();
  }
  if (!(await isAuthenticated(c))) {
    return c.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401);
  }
  c.set('authenticated', true);
  return next();
});
