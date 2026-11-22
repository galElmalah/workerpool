import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { isDemo } from '../env';
import { ApiError, badRequest, conflict } from '../lib/http';
import { nowIso } from '../lib/ids';
import { hashPassphrase, verifyPassphrase } from '../lib/crypto';
import { first, parseJson, run } from '../db/sql';
import { validate } from '../services/context';
import { clearSession, isAuthenticated, issueSession, readAuthState, rememberAuthState } from '../middleware/auth';

const Passphrase = z.string().min(8, 'Use at least 8 characters').max(1024);

/** Login throttling: after FREE_ATTEMPTS consecutive failures, lock out with exponential backoff. */
const FREE_ATTEMPTS = 5;
const BASE_LOCK_SEC = 30;
const MAX_LOCK_SEC = 15 * 60;
const THROTTLE_KEY = 'auth.throttle';

interface Throttle {
  fails: number;
  lockedUntil: number; // epoch ms
}

async function readThrottle(db: D1Database): Promise<Throttle> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM sync_state WHERE key = ?', THROTTLE_KEY);
  return parseJson<Throttle>(row?.value, { fails: 0, lockedUntil: 0 });
}

async function writeThrottle(db: D1Database, t: Throttle): Promise<void> {
  await run(
    db,
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    THROTTLE_KEY,
    JSON.stringify(t),
    nowIso(),
  );
}

async function assertNotLocked(db: D1Database): Promise<Throttle> {
  const t = await readThrottle(db);
  const wait = Math.ceil((t.lockedUntil - Date.now()) / 1000);
  if (wait > 0) throw new ApiError(429, 'too_many_attempts', `Too many attempts. Try again in ${wait} s.`, wait);
  return t;
}

async function recordFailure(db: D1Database, t: Throttle): Promise<void> {
  const fails = t.fails + 1;
  const lockSec = fails >= FREE_ATTEMPTS ? Math.min(MAX_LOCK_SEC, BASE_LOCK_SEC * 2 ** (fails - FREE_ATTEMPTS)) : 0;
  await writeThrottle(db, { fails, lockedUntil: lockSec ? Date.now() + lockSec * 1000 : 0 });
}

async function checkPassphrase(db: D1Database, passphrase: string): Promise<{ ok: boolean; epoch: number }> {
  const row = await first<{ password_hash: string; salt: string; iterations: number; session_epoch: number }>(
    db,
    'SELECT password_hash, salt, iterations, session_epoch FROM auth WHERE id = 1',
  );
  if (!row) throw badRequest('No passphrase has been set yet', 'not_configured');
  const ok = await verifyPassphrase(passphrase, { hash: row.password_hash, salt: row.salt, iterations: row.iterations });
  return { ok, epoch: row.session_epoch };
}

/** Throttled passphrase check: throws 429 while locked, 401 on a wrong passphrase. */
async function authenticate(db: D1Database, passphrase: string): Promise<number> {
  const t = await assertNotLocked(db);
  const { ok, epoch } = await checkPassphrase(db, passphrase);
  if (!ok) {
    await recordFailure(db, t);
    throw new ApiError(401, 'invalid_passphrase', 'Wrong passphrase');
  }
  if (t.fails) await writeThrottle(db, { fails: 0, lockedUntil: 0 });
  return epoch;
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const authRoutes = new Hono<AppEnv>()
  .get('/auth/status', async (c) => {
    const state = await readAuthState(c.env.DB, true);
    const authenticated = state.configured && (await isAuthenticated(c));
    return c.json({ configured: state.configured, authenticated, demo: isDemo(c.env) });
  })
  .post('/auth/setup', validate('json', z.object({ passphrase: Passphrase })), async (c) => {
    const { passphrase } = c.req.valid('json');
    const existing = await first(c.env.DB, 'SELECT id FROM auth WHERE id = 1');
    if (existing) throw conflict('A passphrase is already set', 'already_configured');
    const h = await hashPassphrase(passphrase);
    const res = await run(
      c.env.DB,
      `INSERT INTO auth (id, password_hash, salt, iterations, session_epoch, created_at) VALUES (1, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO NOTHING`,
      h.hash,
      h.salt,
      h.iterations,
      nowIso(),
    );
    if (!res.meta.changes) throw conflict('A passphrase is already set', 'already_configured');
    rememberAuthState({ configured: true, epoch: 1 });
    await issueSession(c, 1);
    return c.json({ configured: true, authenticated: true }, 201);
  })
  .post('/auth/login', validate('json', z.object({ passphrase: z.string().min(1).max(1024) })), async (c) => {
    const epoch = await authenticate(c.env.DB, c.req.valid('json').passphrase);
    rememberAuthState({ configured: true, epoch });
    await issueSession(c, epoch);
    return c.json({ configured: true, authenticated: true });
  })
  .post('/auth/logout', (c) => {
    clearSession(c);
    return c.json({ authenticated: false });
  })
  .post('/auth/change', validate('json', z.object({ current: z.string().min(1).max(1024), next: Passphrase })), async (c) => {
    const { current, next } = c.req.valid('json');
    const epoch = await authenticate(c.env.DB, current);
    const h = await hashPassphrase(next);
    const nextEpoch = epoch + 1;
    await run(
      c.env.DB,
      'UPDATE auth SET password_hash = ?, salt = ?, iterations = ?, session_epoch = ? WHERE id = 1',
      h.hash,
      h.salt,
      h.iterations,
      nextEpoch,
    );
    rememberAuthState({ configured: true, epoch: nextEpoch });
    await issueSession(c, nextEpoch);
    return c.json({ configured: true, authenticated: true });
  });
