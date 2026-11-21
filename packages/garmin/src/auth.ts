/**
 * Garmin authentication primitives (garmin.md §2).
 *
 *  - Personal API: API key → 24 h bearer JWT (VERIFIED code; official client).
 *  - Unofficial Connect API: DI OAuth2 token set (from python-garminconnect's
 *    garmin_tokens.json), refreshed at diauth.garmin.com (VERIFIED code).
 *  - Optional, experimental: in-Worker SSO "mobile" login (+MFA) → service
 *    ticket → DI token. Single attempt, no retries: expected to be blocked by
 *    Cloudflare bot management when run from Workers (garmin.md §2.4).
 *
 * Everything takes an injected `fetch`; only Web APIs are used.
 */
import { z } from 'zod';
import { GarminAuthError, GarminBlockedError, GarminHttpError, GarminRateLimitError } from './errors';
import { base64UrlDecodeToString, isObject } from './util';

// ───────────────────────────── credential model ─────────────────────────────

export interface PersonalApiCredentials {
  apiKey: string;
  /** Expiry the user chose when creating the key (30/90/180/365 d), for warnings. */
  keyExpiresOn?: string;
  /** Cached bearer JWT and its `exp` (epoch seconds). */
  bearer?: string;
  bearerExp?: number;
}

/** Identical to python-garminconnect's garmin_tokens.json (+ cached identity). */
export interface DiCredentials {
  di_token: string;
  di_refresh_token: string;
  di_client_id: string;
  displayName?: string;
  profileId?: number;
}

export interface GarminCredentials {
  personal?: PersonalApiCredentials;
  di?: DiCredentials;
}

/**
 * Persistence hook. The Worker implements it over D1 (encrypted, with a
 * version/CAS column so concurrent isolates do not clobber a rotated refresh
 * token — garmin.md §2.5); tests use an in-memory object.
 */
export interface TokenStore {
  load(): Promise<GarminCredentials | null>;
  save(credentials: GarminCredentials): Promise<void>;
}

export function memoryTokenStore(initial: GarminCredentials | null = null): TokenStore & { current: GarminCredentials | null; saves: number } {
  const store = {
    current: initial ? structuredClone(initial) : null,
    saves: 0,
    async load() {
      return store.current ? structuredClone(store.current) : null;
    },
    async save(c: GarminCredentials) {
      store.saves++;
      store.current = structuredClone(c);
    },
  };
  return store;
}

const GarminTokensJson = z.object({
  di_token: z.string().min(10),
  di_refresh_token: z.string().min(4),
  di_client_id: z.string().min(3).optional(),
});

/**
 * Validate the pasted contents of `garmin_tokens.json`. Accepts the JSON text or
 * a parsed object. `di_client_id` falls back to the JWT `client_id` claim.
 * Throws a GarminAuthError('needs_reauth') with a user-presentable message.
 */
export function parseGarminTokensJson(input: string | unknown): DiCredentials {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new GarminAuthError('garmin_tokens.json is not valid JSON', 'di', 'needs_reauth');
    }
  }
  const parsed = GarminTokensJson.safeParse(raw);
  if (!parsed.success) {
    throw new GarminAuthError(
      'garmin_tokens.json must contain di_token, di_refresh_token and di_client_id (python-garminconnect ≥ 0.3.0 format)',
      'di',
      'needs_reauth',
    );
  }
  const clientId = parsed.data.di_client_id ?? jwtClaim(parsed.data.di_token, 'client_id');
  if (typeof clientId !== 'string' || !clientId) {
    throw new GarminAuthError('garmin_tokens.json has no di_client_id', 'di', 'needs_reauth');
  }
  return { di_token: parsed.data.di_token, di_refresh_token: parsed.data.di_refresh_token, di_client_id: clientId };
}

// ───────────────────────────── JWT helpers ─────────────────────────────

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = JSON.parse(base64UrlDecodeToString(parts[1]));
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function jwtClaim(token: string, claim: string): unknown {
  return decodeJwtPayload(token)?.[claim];
}

/** `exp` claim in epoch seconds, or undefined when the token is opaque. */
export function jwtExpiry(token: string): number | undefined {
  const exp = jwtClaim(token, 'exp');
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
}

export function basicClientAuth(clientId: string): string {
  return `Basic ${btoa(`${clientId}:`)}`;
}

// ───────────────────────────── constants ─────────────────────────────

export const DEFAULT_BASE_URLS = {
  personal: 'https://personal.connectapi.garmin.com',
  connect: 'https://connectapi.garmin.com',
  diauth: 'https://diauth.garmin.com',
  sso: 'https://sso.garmin.com',
} as const;
export type GarminBaseUrls = { personal: string; connect: string; diauth: string; sso: string };

export const PERSONAL_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
export const DI_TOKEN_PATH = '/di-oauth2-service/oauth/token';

/** Native Android app headers sent to connectapi and diauth (python-garminconnect 0.3.20). */
export const NATIVE_HEADERS: Record<string, string> = {
  'User-Agent': 'GCM-Android-5.23',
  'X-Garmin-User-Agent':
    'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',
  'X-Garmin-Paired-App-Version': '10861',
  'X-Garmin-Client-Platform': 'Android',
  'X-App-Ver': '10861',
  'X-Lang': 'en',
  'X-GCExperience': 'GC5',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Client ids tried in order for the service-ticket exchange (first 2xx wins). */
export const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
] as const;

/** Re-exchange the Personal API bearer when less than this remains (official client: 1 h). */
export const PERSONAL_REFRESH_MARGIN_SEC = 3600;
/** Refresh the DI token when less than this remains (python-garminconnect: 900 s). */
export const DI_REFRESH_MARGIN_SEC = 900;

type FetchFn = (request: Request) => Promise<Response>;

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}

// ───────────────────────────── Personal API ─────────────────────────────

/**
 * POST …/personal-api-key/token with `Authorization: ApiKey <key>` → raw JWT text.
 * 401/403 → GarminAuthError('personal_key_invalid').
 */
export async function exchangePersonalApiKey(
  fetchFn: FetchFn,
  baseUrl: string,
  apiKey: string,
  nowSec: number,
): Promise<{ bearer: string; bearerExp: number }> {
  const res = await fetchFn(
    new Request(baseUrl + PERSONAL_TOKEN_PATH, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${apiKey}`, Accept: '*/*' },
    }),
  );
  if (res.status === 401 || res.status === 403) {
    throw new GarminAuthError('Garmin Personal API key was rejected (expired or revoked)', 'personal', 'personal_key_invalid');
  }
  if (res.status === 429) throw new GarminRateLimitError('Personal API token exchange rate limited', 'personal', 429, retryAfterMs(res));
  if (!res.ok) throw new GarminHttpError('personal', 'POST', PERSONAL_TOKEN_PATH, res.status);
  let bearer = (await res.text()).trim();
  // Defensive: tolerate a JSON-quoted string or {"access_token": …} (UNVERIFIED variants).
  if (bearer.startsWith('"')) {
    try {
      bearer = JSON.parse(bearer);
    } catch {
      /* keep raw */
    }
  } else if (bearer.startsWith('{')) {
    try {
      const o = JSON.parse(bearer);
      bearer = o.access_token ?? o.token ?? bearer;
    } catch {
      /* keep raw */
    }
  }
  if (!bearer) throw new GarminHttpError('personal', 'POST', PERSONAL_TOKEN_PATH, res.status, 'empty token body');
  // Their client reads exp from the JWT; fall back to the documented 24 h lifetime.
  return { bearer, bearerExp: jwtExpiry(bearer) ?? nowSec + 86_400 };
}

// ───────────────────────────── DI token ─────────────────────────────

function parseDiTokenResponse(body: unknown, previous?: DiCredentials, fallbackClientId?: string): DiCredentials {
  if (!isObject(body) || typeof body.access_token !== 'string' || !body.access_token) {
    throw new GarminAuthError('diauth returned no access_token', 'di', 'needs_reauth');
  }
  const access = body.access_token;
  const refresh = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : previous?.di_refresh_token;
  if (!refresh) throw new GarminAuthError('diauth returned no refresh_token', 'di', 'needs_reauth');
  const claimClient = jwtClaim(access, 'client_id');
  const clientId =
    (typeof claimClient === 'string' && claimClient) || previous?.di_client_id || fallbackClientId || DI_CLIENT_IDS[0];
  const out: DiCredentials = { di_token: access, di_refresh_token: refresh, di_client_id: clientId };
  if (previous?.displayName) out.displayName = previous.displayName;
  if (previous?.profileId !== undefined) out.profileId = previous.profileId;
  return out;
}

async function postDiToken(fetchFn: FetchFn, baseUrl: string, clientId: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(
    new Request(baseUrl + DI_TOKEN_PATH, {
      method: 'POST',
      headers: {
        ...NATIVE_HEADERS,
        Authorization: basicClientAuth(clientId),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

/**
 * grant_type=refresh_token. A missing refresh_token in the response keeps the
 * old one; a present one replaces it (rotation) — the caller MUST persist the
 * result before using it.
 * 400/401 → GarminAuthError('needs_reauth'); 429 → GarminRateLimitError;
 * 403/HTML → GarminBlockedError.
 */
export async function refreshDiToken(fetchFn: FetchFn, baseUrl: string, di: DiCredentials): Promise<DiCredentials> {
  const res = await postDiToken(fetchFn, baseUrl, di.di_client_id, {
    grant_type: 'refresh_token',
    client_id: di.di_client_id,
    refresh_token: di.di_refresh_token,
  });
  if (res.status === 400 || res.status === 401) {
    throw new GarminAuthError('Garmin DI refresh token rejected; paste a new garmin_tokens.json', 'di', 'needs_reauth');
  }
  if (res.status === 429) throw new GarminRateLimitError('diauth refresh rate limited', 'diauth', 429, retryAfterMs(res));
  if (res.status === 403 || res.status === 427) throw new GarminBlockedError('diauth refused the refresh (blocked?)', 'diauth', res.status);
  if (!res.ok) throw new GarminHttpError('diauth', 'POST', DI_TOKEN_PATH, res.status);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new GarminBlockedError('diauth returned a non-JSON body (challenge page?)', 'diauth', res.status);
  }
  return parseDiTokenResponse(body, di);
}

/** Exchange a CAS service ticket for a DI token, trying the known client ids in order. */
export async function exchangeServiceTicket(
  fetchFn: FetchFn,
  baseUrl: string,
  ticket: string,
  serviceUrl: string,
  clientIds: readonly string[] = DI_CLIENT_IDS,
): Promise<DiCredentials> {
  let lastStatus = 0;
  for (const clientId of clientIds) {
    const res = await postDiToken(fetchFn, baseUrl, clientId, {
      client_id: clientId,
      service_ticket: ticket,
      grant_type: 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket',
      service_url: serviceUrl,
    });
    lastStatus = res.status;
    if (res.status === 429) throw new GarminRateLimitError('diauth ticket exchange rate limited', 'diauth', 429, retryAfterMs(res));
    if (res.ok) {
      const body: unknown = await res.json().catch(() => null);
      return parseDiTokenResponse(body, undefined, clientId);
    }
  }
  throw new GarminAuthError(`Service ticket exchange failed (last HTTP ${lastStatus})`, 'sso', 'login_failed');
}

// ───────────────────────────── experimental SSO login ─────────────────────────────

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
export const MOBILE_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/ios';
const MOBILE_QS = `clientId=GCM_IOS_DARK&service=${encodeURIComponent(MOBILE_SERVICE_URL)}`;
const MOBILE_API_QS = `clientId=GCM_IOS_DARK&locale=en-US&service=${encodeURIComponent(MOBILE_SERVICE_URL)}`;

/** Serializable state persisted (encrypted, ≤10 min) between login and MFA code entry. */
export interface PendingMfaLogin {
  cookies: Record<string, string>;
  mfaMethod: string;
  createdAt: number;
}

export type PasswordLoginResult =
  | { status: 'ok'; di: DiCredentials }
  | { status: 'mfa_required'; pending: PendingMfaLogin };

export interface PasswordLoginOptions {
  fetch: FetchFn;
  baseUrls?: Partial<GarminBaseUrls>;
  username: string;
  password: string;
  /** Wait between the GET and the POST; the library uses a random 2–5 s. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

function collectCookies(res: Response, jar: Record<string, string>): void {
  const list =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  for (const c of list) {
    const first = c.split(';')[0]?.trim();
    if (!first) continue;
    const eq = first.indexOf('=');
    if (eq > 0) jar[first.slice(0, eq)] = first.slice(eq + 1);
  }
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function ssoJson(res: Response): Promise<Record<string, unknown>> {
  if (res.status === 429 || res.status === 427) throw new GarminBlockedError(`SSO refused the login (HTTP ${res.status})`, 'sso', res.status);
  if (res.status === 403) throw new GarminBlockedError('SSO bot challenge (HTTP 403)', 'sso', 403);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new GarminBlockedError(`SSO returned a non-JSON page (HTTP ${res.status})`, 'sso', res.status);
  }
  if (!isObject(body)) throw new GarminAuthError('Unexpected SSO response', 'sso', 'login_failed');
  const err = body.error;
  if (isObject(err) && String(err['status-code']) === '429') throw new GarminBlockedError('SSO rate limited', 'sso', 429);
  return body;
}

function ssoHeaders(jar: Record<string, string>, ssoBase: string): Record<string, string> {
  return {
    'User-Agent': IOS_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    Origin: ssoBase,
    Referer: `${ssoBase}/mobile/sso/en_US/sign-in?${MOBILE_QS}`,
    Cookie: cookieHeader(jar),
  };
}

/**
 * EXPERIMENTAL — feature-flag it in the app. Performs exactly ONE attempt of the
 * "mobile" SSO flow (garmin.md §2.2 steps 1, 2). Never loops or retries: every
 * failed attempt risks account throttling. Expect GarminBlockedError from Workers.
 */
export async function experimentalPasswordLogin(opts: PasswordLoginOptions): Promise<PasswordLoginResult> {
  const base = { ...DEFAULT_BASE_URLS, ...opts.baseUrls };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const jar: Record<string, string> = {};
  const page = await opts.fetch(
    new Request(`${base.sso}/mobile/sso/en_US/sign-in?${MOBILE_QS}`, {
      headers: {
        'User-Agent': IOS_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
    }),
  );
  if (page.status === 429 || page.status === 427 || page.status === 403) {
    throw new GarminBlockedError(`SSO sign-in page refused (HTTP ${page.status})`, 'sso', page.status);
  }
  collectCookies(page, jar);
  await sleep(opts.delayMs ?? 2000 + Math.floor(Math.random() * 3000));
  const res = await opts.fetch(
    new Request(`${base.sso}/mobile/api/login?${MOBILE_API_QS}`, {
      method: 'POST',
      headers: ssoHeaders(jar, base.sso),
      body: JSON.stringify({ username: opts.username, password: opts.password, rememberMe: true, captchaToken: '' }),
    }),
  );
  collectCookies(res, jar);
  const body = await ssoJson(res);
  const type = isObject(body.responseStatus) ? String(body.responseStatus.type) : '';
  if (type === 'SUCCESSFUL' && typeof body.serviceTicketId === 'string') {
    return { status: 'ok', di: await exchangeServiceTicket(opts.fetch, base.diauth, body.serviceTicketId, MOBILE_SERVICE_URL) };
  }
  if (type === 'MFA_REQUIRED') {
    const info = isObject(body.customerMfaInfo) ? body.customerMfaInfo : {};
    return {
      status: 'mfa_required',
      pending: {
        cookies: jar,
        mfaMethod: typeof info.mfaLastMethodUsed === 'string' ? info.mfaLastMethodUsed : 'email',
        createdAt: (opts.now?.() ?? new Date()).getTime(),
      },
    };
  }
  if (type === 'INVALID_USERNAME_PASSWORD') throw new GarminAuthError('Garmin rejected the username/password', 'sso', 'invalid_credentials');
  if (type === 'CAPTCHA_REQUIRED') throw new GarminBlockedError('Garmin requires a CAPTCHA (bot challenge)', 'sso', res.status);
  throw new GarminAuthError(`Unexpected SSO login status ${type || res.status}`, 'sso', 'login_failed');
}

/** EXPERIMENTAL — second half of the mobile flow: verify the MFA code, exchange the ticket. */
export async function experimentalCompleteMfa(opts: {
  fetch: FetchFn;
  baseUrls?: Partial<GarminBaseUrls>;
  pending: PendingMfaLogin;
  code: string;
}): Promise<{ status: 'ok'; di: DiCredentials }> {
  const base = { ...DEFAULT_BASE_URLS, ...opts.baseUrls };
  const jar = { ...opts.pending.cookies };
  const res = await opts.fetch(
    new Request(`${base.sso}/mobile/api/mfa/verifyCode?${MOBILE_API_QS}`, {
      method: 'POST',
      headers: ssoHeaders(jar, base.sso),
      body: JSON.stringify({
        mfaMethod: opts.pending.mfaMethod,
        mfaVerificationCode: opts.code,
        rememberMyBrowser: true,
        reconsentList: [],
        mfaSetup: false,
      }),
    }),
  );
  const body = await ssoJson(res);
  const type = isObject(body.responseStatus) ? String(body.responseStatus.type) : '';
  if (type === 'SUCCESSFUL' && typeof body.serviceTicketId === 'string') {
    return { status: 'ok', di: await exchangeServiceTicket(opts.fetch, base.diauth, body.serviceTicketId, MOBILE_SERVICE_URL) };
  }
  throw new GarminAuthError('MFA code rejected', 'sso', 'invalid_mfa_code');
}
