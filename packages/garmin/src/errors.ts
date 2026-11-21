/**
 * Typed errors raised by the Garmin client. Messages never contain tokens,
 * API keys, service tickets or cookies.
 */

export type GarminApi = 'personal' | 'connect' | 'diauth' | 'sso';

export class GarminError extends Error {
  readonly code: string;
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GarminError';
    this.code = code;
  }
}

export type GarminAuthCode =
  /** No credentials of the required kind are stored (e.g. a write without a DI token). */
  | 'no_credentials'
  /** Personal API key rejected by the token exchange (expired / revoked). */
  | 'personal_key_invalid'
  /** DI refresh token rejected (400/401 from diauth) → user must paste a new garmin_tokens.json. */
  | 'needs_reauth'
  /** A data call still returned 401 after one refresh + retry. */
  | 'unauthorized'
  /** SSO login: wrong username/password. */
  | 'invalid_credentials'
  /** SSO login: MFA code rejected. */
  | 'invalid_mfa_code'
  /** SSO login: CAPTCHA / unexpected response. */
  | 'login_failed';

export class GarminAuthError extends GarminError {
  readonly kind: 'personal' | 'di' | 'sso';
  override readonly code: GarminAuthCode;
  constructor(message: string, kind: 'personal' | 'di' | 'sso', code: GarminAuthCode, options?: { cause?: unknown }) {
    super(message, code, options);
    this.name = 'GarminAuthError';
    this.kind = kind;
    this.code = code;
  }
}

export class GarminRateLimitError extends GarminError {
  readonly status: number;
  readonly api: GarminApi;
  /** Server-suggested wait (Retry-After) or our computed backoff, in ms. */
  readonly retryAfterMs?: number;
  constructor(message: string, api: GarminApi, status: number, retryAfterMs?: number) {
    super(message, 'rate_limited');
    this.name = 'GarminRateLimitError';
    this.api = api;
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The request was refused in a way that looks like bot/network blocking rather
 * than a bad token: Cloudflare challenge HTML, 427, CAPTCHA, or a 403 on a write.
 * The caller should stop all Garmin traffic for hours (garmin.md §6.1).
 */
export class GarminBlockedError extends GarminError {
  readonly status: number;
  readonly api: GarminApi;
  constructor(message: string, api: GarminApi, status: number) {
    super(message, 'blocked');
    this.name = 'GarminBlockedError';
    this.api = api;
    this.status = status;
  }
}

export class GarminHttpError extends GarminError {
  readonly status: number;
  readonly api: GarminApi;
  readonly method: string;
  /** Path without query string (queries may carry tickets/dates; never tokens). */
  readonly path: string;
  readonly bodySnippet?: string;
  constructor(api: GarminApi, method: string, path: string, status: number, bodySnippet?: string) {
    super(`Garmin ${api} ${method} ${path} → HTTP ${status}`, status === 404 ? 'not_found' : 'http_error');
    this.name = 'GarminHttpError';
    this.api = api;
    this.method = method;
    this.path = path;
    this.status = status;
    if (bodySnippet !== undefined) this.bodySnippet = bodySnippet;
  }
}

export class GarminNotFoundError extends GarminHttpError {
  constructor(api: GarminApi, method: string, path: string, bodySnippet?: string) {
    super(api, method, path, 404, bodySnippet);
    this.name = 'GarminNotFoundError';
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof GarminHttpError && e.status === 404;
}

/** 403/404: endpoint not available for this account/API tier (Personal API coverage is partial). */
export function isUnavailable(e: unknown): boolean {
  return e instanceof GarminHttpError && (e.status === 404 || e.status === 403);
}
