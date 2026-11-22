/**
 * Single-user auth: browser sessions (cookie) and native-client device tokens (bearer).
 *
 * Session = `cadence_session` cookie holding an HMAC-SHA256-signed payload `{ v, e, exp }`
 * (e = session epoch from the `auth` row, exp = unix seconds). Verification is stateless apart
 * from the epoch check, which is cached per isolate for EPOCH_TTL_MS; a token whose epoch does
 * not match the cached value forces a fresh read, so a bump is seen at once in this isolate and
 * within the TTL elsewhere.
 *
 * Device token = `Authorization: Bearer cad_<43 base64url chars>` (docs/MOBILE_API.md). Only the
 * SHA-256 hash is stored; lookup is by hash (an index probe on a value the caller cannot steer),
 * followed by a constant-time comparison. Valid hashes are cached per isolate for DEVICE_TTL_MS
 * (same approach as the epoch cache): a revocation in this isolate drops the entry at once, other
 * isolates see it within the TTL. `last_used_at` is written at most once per hour per device.
 *
 * CSRF: cookies are `SameSite=Lax` and there is no CORS, so a cross-site page can neither send a
 * cookie-authenticated mutation nor set an `Authorization` header (that needs a preflight we never
 * answer). Bearer auth needs no CSRF defence (the browser never attaches it), and a request that
 * carries a Bearer header is judged on that token alone — never on a cookie it may also carry.
 */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Principal } from '../env';
import { ApiError } from '../lib/http';
import { b64uDecode, b64uEncode, signToken, timingSafeEqual, verifyToken } from '../lib/crypto';
import { first } from '../db/sql';
import { findDeviceByHash, touchDevice } from '../db/devices';

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

/** True when the request carries a valid, unexpired session cookie for the current epoch. */
async function hasValidSession(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const p = await verifyToken<SessionPayload>(token, sessionSecret(c.env));
  if (!p || p.v !== 1 || typeof p.exp !== 'number' || p.exp <= Date.now() / 1000) return false;
  let state = await readAuthState(c.env.DB);
  if (state.configured && state.epoch === p.e) return true;
  state = await readAuthState(c.env.DB, true);
  return state.configured && state.epoch === p.e;
}

// ───────────────────────────── device tokens ─────────────────────────────

export const DEVICE_TOKEN_PREFIX = 'cad_';
const DEVICE_TOKEN_RE = /^cad_[A-Za-z0-9_-]{43}$/;
const DEVICE_TTL_MS = 30_000;
const DEVICE_CACHE_MAX = 256;
/** `last_used_at` is refreshed when older than this. */
const TOUCH_EVERY_MS = 3600_000;

interface CachedDevice {
  id: string;
  lastUsedAt: string | null;
  at: number;
}
const deviceCache = new Map<string, CachedDevice>();

/** A fresh token: `cad_` + base64url(32 random bytes) — 43 characters after the prefix. */
export function newDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + b64uEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** base64url SHA-256 of the token string (what the `devices` table stores). */
export async function hashDeviceToken(token: string): Promise<string> {
  return b64uEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

/** Drop one device (revoked in this isolate) from the cache. */
export function forgetDevice(id: string): void {
  for (const [h, d] of deviceCache) if (d.id === id) deviceCache.delete(h);
}

/** Drop every cached device (passphrase change). */
export function forgetAllDevices(): void {
  deviceCache.clear();
}

/** The device a bearer token belongs to, or null when malformed / unknown / revoked. */
async function verifyDeviceToken(db: D1Database, token: string): Promise<{ id: string; tokenHash: string } | null> {
  if (!DEVICE_TOKEN_RE.test(token)) return null;
  const hash = await hashDeviceToken(token);
  const now = Date.now();
  let d = deviceCache.get(hash);
  if (!d || now - d.at >= DEVICE_TTL_MS) {
    deviceCache.delete(hash);
    const row = await findDeviceByHash(db, hash);
    if (!row || !timingSafeEqual(b64uDecode(row.tokenHash), b64uDecode(hash))) return null;
    if (deviceCache.size >= DEVICE_CACHE_MAX) deviceCache.clear();
    d = { id: row.id, lastUsedAt: row.lastUsedAt, at: now };
    deviceCache.set(hash, d);
  }
  const last = d.lastUsedAt ? Date.parse(d.lastUsedAt) : NaN;
  if (!(now - last < TOUCH_EVERY_MS)) {
    const nowIso = new Date(now).toISOString();
    d.lastUsedAt = nowIso;
    await touchDevice(db, d.id, nowIso, new Date(now - TOUCH_EVERY_MS).toISOString());
  }
  return { id: d.id, tokenHash: hash };
}

/** `Authorization: Bearer <token>` → token; undefined when the header is absent or another scheme. */
function bearerOf(c: Context<AppEnv>): string | undefined {
  const h = c.req.header('authorization');
  if (!h) return undefined;
  const m = /^Bearer(?:[ \t]+(.*))?$/i.exec(h.trim());
  return m ? (m[1] ?? '').trim() : undefined;
}

/**
 * Who is calling: a cookie session, a device token, or nobody. A request with a Bearer header is
 * judged on the token only (an invalid token is a 401 even next to a valid cookie).
 */
export async function resolvePrincipal(c: Context<AppEnv>): Promise<Principal | null> {
  const bearer = bearerOf(c);
  if (bearer !== undefined) {
    const d = await verifyDeviceToken(c.env.DB, bearer);
    return d ? { kind: 'device', deviceId: d.id } : null;
  }
  return (await hasValidSession(c)) ? { kind: 'session' } : null;
}

/** True when the request carries a valid session cookie or device token. */
export async function isAuthenticated(c: Context<AppEnv>): Promise<boolean> {
  return (await resolvePrincipal(c)) !== null;
}

// ───────────────────────────── cookies ─────────────────────────────

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

// ───────────────────────────── middleware ─────────────────────────────

const OPEN = /^\/api\/(health\/?$|auth(\/|$))/;
/** Device management lives under /auth but only `POST /auth/devices` (create, passphrase) is open. */
const DEVICES = /^\/api\/auth\/devices(\/|$)/;

function isOpen(c: Context<AppEnv>): boolean {
  const path = c.req.path;
  if (!OPEN.test(path)) return false;
  if (DEVICES.test(path)) return c.req.method === 'POST' && path === '/api/auth/devices';
  return true;
}

/** Guards every /api route except /api/health, /api/auth/* and `POST /api/auth/devices`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (isOpen(c)) {
    c.set('authenticated', false);
    c.set('principal', null);
    return next();
  }
  const principal = await resolvePrincipal(c);
  if (!principal) {
    return c.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401);
  }
  c.set('authenticated', true);
  c.set('principal', principal);
  return next();
});
