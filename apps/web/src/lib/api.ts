/**
 * Typed API client. `api` mirrors the Worker's routes (Hono RPC), e.g.
 *
 *   const cal = await call(api.calendar.$get({ query: { from, to } }));
 *   const w   = await call(api.workouts[':id'].$patch({ param: { id }, json: patch }));
 *
 * `call` unwraps the JSON body, throws `ApiError` on non-2xx and sends the user to /login on 401.
 */
import { hc, type ClientResponse } from 'hono/client';
import type { AppType } from '../../worker/index';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | undefined;
/** The shell registers a handler that routes to /login (kept out of this module to avoid a cycle). */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export const api = hc<AppType>('/', {
  init: { credentials: 'same-origin' },
}).api;

type JsonOf<R> = R extends ClientResponse<infer T, infer S, 'json'> ? (S extends 200 | 201 ? T : never) : never;

async function toError(res: Response): Promise<ApiError> {
  let code = 'http_error';
  let message = res.statusText || `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message);
}

/** Await a client call and return its typed JSON body. */
export async function call<R extends ClientResponse<any, any, any>>(req: Promise<R>): Promise<JsonOf<R>> {
  let res: R;
  try {
    res = await req;
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline');
  }
  if (!res.ok) {
    const err = await toError(res as unknown as Response);
    if (err.status === 401) onUnauthorized?.();
    throw err;
  }
  return (await res.json()) as JsonOf<R>;
}

/** For endpoints that return non-JSON bodies (CSV, FIT) or need raw access. */
export async function raw(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const err = await toError(res);
    if (err.status === 401) onUnauthorized?.();
    throw err;
  }
  return res;
}
