/**
 * Garmin client factory + encrypted D1 credential store.
 *
 *  - `garmin_auth.credentials_enc` holds AES-GCM(`GarminCredentials` JSON) (lib/crypto.ts).
 *  - The TokenStore persists every rotation (DI refresh, Personal API bearer) with a
 *    compare-and-swap on the ciphertext; the sync lock serialises our own writers.
 *  - DEMO mode (`DEMO_MODE=1`): the client's fetch/baseUrls are an in-process fake Garmin
 *    (`@cadence/garmin/mock`) serving the deterministic synthetic athlete; its "now" is the
 *    `demo:now` instant stored in `sync_state` (moved by `POST /demo/advance`). The mock module and
 *    the synth generator are loaded with dynamic imports so they never enter production paths.
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays, todayIn } from '@cadence/core/time';
import {
  GarminAuthError,
  GarminBlockedError,
  GarminClient,
  GarminError,
  GarminHttpError,
  GarminRateLimitError,
  type FetchLike,
  type GarminCredentials,
  type TokenStore,
} from '@cadence/garmin';
import type { GarminMock } from '@cadence/garmin/mock';
import { getSettings } from '../db/settings';
import { casGarminCredentials, getGarminAuth, overwriteGarminCredentials } from '../db/garmin';
import { getState, putState } from '../db/sync';
import { isDemo } from '../env';
import { decryptJson, encryptJson } from '../lib/crypto';
import { ApiError } from '../lib/http';

// ───────────────────────────── credential store ─────────────────────────────

export async function encryptCredentials(env: Env, c: GarminCredentials): Promise<string> {
  return encryptJson(env, c);
}

export async function decryptCredentials(env: Env, payload: string): Promise<GarminCredentials> {
  return decryptJson<GarminCredentials>(env, payload);
}

export interface D1TokenStore extends TokenStore {
  /** Number of successful saves (rotations) through this store instance. */
  saves: number;
}

/** TokenStore over `garmin_auth`: load = decrypt; save = encrypt + CAS (falls back to overwrite). */
export function d1TokenStore(env: Env): D1TokenStore {
  let lastCipher: string | undefined;
  const store: D1TokenStore = {
    saves: 0,
    async load() {
      const row = await getGarminAuth(env.DB);
      if (!row) return null;
      lastCipher = row.credentialsEnc;
      return decryptCredentials(env, row.credentialsEnc);
    },
    async save(c) {
      const next = await encryptCredentials(env, c);
      if (lastCipher && (await casGarminCredentials(env.DB, lastCipher, next))) {
        lastCipher = next;
        store.saves++;
        return;
      }
      // Lost the race (or never loaded): our token came from a successful refresh/exchange, so it
      // is the newest valid one — overwrite, but never resurrect a deleted connection.
      if (await overwriteGarminCredentials(env.DB, next)) {
        lastCipher = next;
        store.saves++;
      }
    },
  };
  return store;
}

// ───────────────────────────── demo mock ─────────────────────────────

export const DEMO_API_KEY = 'cadence-demo-key';
export const DEMO_SSO = { username: 'demo@cadence.app', password: 'cadence-demo', mfaCode: '123456' };
/** Days of synthetic history generated beyond the seed's "today" so `demo/advance` reveals new activities. */
export const DEMO_LOOKAHEAD_DAYS = 14;
export const DEMO_DEFAULT_SEED = 7;

export interface DemoConfig {
  seed: number;
  /** `today` the athlete is generated for (= seed today + lookahead). */
  athleteToday: LocalDate;
  months: number;
}

const DEMO_CONFIG_KEY = 'demo:config';
const DEMO_NOW_KEY = 'demo:now';

/** Mock clock shared by the singleton mock and the demo client (refreshed from D1 on each use). */
const demoClock = { ms: undefined as number | undefined };
type SynthModule = typeof import('../../../../packages/garmin/src/synth/index');
export type DemoAthlete = ReturnType<SynthModule['generateAthlete']>;
let demoMock: { key: string; mock: GarminMock; config: DemoConfig; athlete: DemoAthlete } | undefined;

interface TestHooks {
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}
let testHooks: TestHooks = {};

/** Tests only: replace the outbound fetch / clock used by `getGarminClient`. */
export function setGarminTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

export async function getDemoConfig(env: Env): Promise<DemoConfig | undefined> {
  return getState<DemoConfig>(env.DB, DEMO_CONFIG_KEY);
}

export async function setDemoConfig(env: Env, config: DemoConfig): Promise<void> {
  await putState(env.DB, DEMO_CONFIG_KEY, config);
}

/** Stored demo "now" (epoch ms), if any. */
export async function getDemoNow(env: Env): Promise<number | undefined> {
  const v = await getState<number>(env.DB, DEMO_NOW_KEY);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function setDemoNow(env: Env, ms: number): Promise<void> {
  await putState(env.DB, DEMO_NOW_KEY, ms);
  demoClock.ms = ms;
}

/** Drop the in-memory mock (after `demo/reset`): its workouts/schedules/tokens start empty again. */
export function resetDemoMock(): void {
  demoMock = undefined;
  demoClock.ms = undefined;
}

/**
 * The isolate-wide fake Garmin for DEMO mode, keyed by (seed, athleteToday, months) so the dataset
 * is stable across requests. Mock write state (workouts, schedules, issued tokens) lives in memory
 * and resets when the isolate restarts; the client self-heals (tokens are re-issued below and a
 * push whose stored workout is gone simply creates it again).
 */
export async function getDemoMock(env: Env): Promise<{ mock: GarminMock; config: DemoConfig; athlete: DemoAthlete }> {
  if (!isDemo(env)) throw new ApiError(404, 'not_found', 'Demo mode is off');
  demoClock.ms = await getDemoNow(env);
  let config = await getDemoConfig(env);
  if (!config) {
    const settings = await getSettings(env.DB);
    config = { seed: DEMO_DEFAULT_SEED, months: 12, athleteToday: addDays(todayIn(settings.timezone), DEMO_LOOKAHEAD_DAYS) };
  }
  const key = `${config.seed}|${config.athleteToday}|${config.months}`;
  if (demoMock?.key === key) return demoMock;
  const [{ createGarminMock }, synthMod] = await Promise.all([
    import('@cadence/garmin/mock'),
    // The synth generator has no package export yet; import it from source.
    import('../../../../packages/garmin/src/synth/index'),
  ]);
  const athlete = synthMod.generateAthlete({ seed: config.seed, today: config.athleteToday, months: config.months });
  const mock = createGarminMock({
    athlete,
    synth: synthMod.synth,
    apiKey: DEMO_API_KEY,
    sso: DEMO_SSO,
    now: () => new Date(demoClock.ms ?? Date.now()),
  });
  demoMock = { key, mock, config, athlete };
  return demoMock;
}

// ───────────────────────────── clock ─────────────────────────────

/** "Now" for sync decisions: the demo clock in DEMO mode (when set), else the real clock. */
export async function syncNow(env: Env): Promise<Date> {
  if (testHooks.now) return testHooks.now();
  if (isDemo(env)) {
    const ms = await getDemoNow(env);
    if (ms !== undefined) return new Date(ms);
  }
  return new Date();
}

/** Athlete-local "today" consistent with {@link syncNow}. */
export async function syncToday(env: Env): Promise<LocalDate> {
  const [settings, now] = await Promise.all([getSettings(env.DB), syncNow(env)]);
  return todayIn(settings.timezone, now);
}

// ───────────────────────────── client factory ─────────────────────────────

export interface ClientTransport {
  fetch: FetchLike;
  baseUrls?: Partial<import('@cadence/garmin').GarminBaseUrls>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  mock?: GarminMock;
}

/** Outbound transport: test hooks → demo mock → the real Garmin hosts. */
export async function garminTransport(env: Env): Promise<ClientTransport> {
  if (testHooks.fetch) {
    const t: ClientTransport = { fetch: testHooks.fetch };
    if (testHooks.now) t.now = testHooks.now;
    if (testHooks.sleep) t.sleep = testHooks.sleep;
    return t;
  }
  if (isDemo(env)) {
    const { mock } = await getDemoMock(env);
    const { mockBaseUrls } = await import('@cadence/garmin/mock');
    return {
      fetch: mock.fetch,
      baseUrls: mockBaseUrls('https://garmin.mock'),
      now: () => new Date(demoClock.ms ?? Date.now()),
      sleep: async () => {},
      mock,
    };
  }
  return { fetch: (req) => fetch(req) };
}

export function makeClient(transport: ClientTransport, tokens: TokenStore): GarminClient {
  return new GarminClient({
    fetch: transport.fetch,
    tokens,
    ...(transport.baseUrls ? { baseUrls: transport.baseUrls } : {}),
    ...(transport.now ? { now: transport.now } : {}),
    ...(transport.sleep ? { sleep: transport.sleep } : {}),
    retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 8000 },
  });
}

/**
 * A client wired to the stored credentials, or null when Garmin is not connected.
 * In DEMO mode, credentials the in-memory mock no longer knows (isolate restart) are re-issued.
 */
export async function getGarminClient(env: Env): Promise<GarminClient | null> {
  const row = await getGarminAuth(env.DB);
  if (!row || row.state === 'needs_mfa') return null;
  const transport = await garminTransport(env);
  const store = d1TokenStore(env);
  if (transport.mock) await healDemoCredentials(env, transport.mock, store);
  return makeClient(transport, store);
}

async function healDemoCredentials(env: Env, mock: GarminMock, store: D1TokenStore): Promise<void> {
  const creds = await store.load();
  if (!creds) return;
  let changed = false;
  const next: GarminCredentials = structuredClone(creds);
  if (next.di && !mock.state.diRefreshTokens.has(next.di.di_refresh_token) && !mock.state.diAccessTokens.has(next.di.di_token)) {
    const fresh = mock.issueDiTokens();
    next.di = { ...next.di, di_token: fresh.di_token, di_refresh_token: fresh.di_refresh_token, di_client_id: fresh.di_client_id };
    changed = true;
  }
  if (next.personal?.bearer && !mock.state.personalTokens.has(next.personal.bearer)) {
    delete next.personal.bearer;
    delete next.personal.bearerExp;
    changed = true;
  }
  if (changed) await store.save(next);
}

// ───────────────────────────── errors ─────────────────────────────

/** Garmin errors → API errors with stable codes the UI can explain. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof GarminAuthError) {
    if (e.code === 'no_credentials' && e.kind === 'di') {
      return new ApiError(409, 'garmin_write_unavailable', 'Pushing workouts needs a Garmin Connect token (garmin_tokens.json).');
    }
    const hint: Record<string, string> = {
      personal_key_invalid: 'Garmin rejected the Personal API key (expired or revoked). Create a new key in Garmin Connect.',
      needs_reauth: 'Garmin rejected the Connect token. Sign in again on your computer and paste a fresh garmin_tokens.json.',
      invalid_credentials: 'Garmin rejected the email or password.',
      invalid_mfa_code: 'Garmin rejected the verification code.',
    };
    return new ApiError(400, 'garmin_auth_failed', hint[e.code] ?? e.message);
  }
  if (e instanceof GarminBlockedError) {
    return new ApiError(503, 'garmin_blocked', 'Garmin refused the request from this server (bot protection). Try again later or use the token paste flow.');
  }
  if (e instanceof GarminRateLimitError) {
    const mins = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 60_000) : undefined;
    return new ApiError(429, 'garmin_rate_limited', `Garmin is rate limiting requests${mins ? `; retry in about ${mins} min` : ''}.`);
  }
  if (e instanceof GarminHttpError) return new ApiError(502, 'garmin_error', e.message);
  if (e instanceof GarminError) return new ApiError(502, 'garmin_error', e.message);
  return new ApiError(500, 'internal', e instanceof Error ? e.message : String(e));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
