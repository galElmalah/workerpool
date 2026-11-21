/**
 * Shared helpers for Worker tests (run in workerd via @cloudflare/vitest-plugin).
 * Storage is isolated per test FILE: rows persist across `it()`s in a file.
 */
import { exports } from 'cloudflare:workers';

export const BASE = 'https://cadence.test';
export const TEST_PASSPHRASE = 'correct horse battery staple';

let cookie: string | undefined;

async function signIn(): Promise<string> {
  const init = (): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: TEST_PASSPHRASE }),
  });
  let res = await exports.default.fetch(`${BASE}/api/auth/setup`, init());
  if (!res.ok) res = await exports.default.fetch(`${BASE}/api/auth/login`, init());
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** Authenticated request against the Worker. `body` objects are JSON-encoded. */
export async function api(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<Response> {
  cookie ??= await signIn();
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  let body = init.body as BodyInit | undefined;
  if (body !== undefined && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
    body = JSON.stringify(body);
    headers.set('content-type', 'application/json');
  }
  return exports.default.fetch(`${BASE}/api${path}`, { ...init, headers, body });
}

export async function json<T = any>(path: string, init?: Parameters<typeof api>[1]): Promise<T> {
  const res = await api(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Unauthenticated request (for auth tests). */
export const anon = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(`${BASE}/api${path}`, init);

export function resetAuthCache(): void {
  cookie = undefined;
}
