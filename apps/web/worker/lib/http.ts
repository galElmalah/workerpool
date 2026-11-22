import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Thrown anywhere in a handler/service; converted to `{ error: { code, message } }` by onError. */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, code = 'bad_request') => new ApiError(400, code, message);
export const conflict = (message: string, code = 'conflict') => new ApiError(409, code, message);

const HTTP_CODES: Partial<Record<number, string>> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 413: 'payload_too_large', 415: 'unsupported_media_type' };

/**
 * Error → `{ error: { code, message } }`. ApiErrors carry their own status/code/message; Hono's
 * HTTPExceptions (e.g. malformed JSON from the validator) keep their 4xx status; anything else is
 * a 500 with a generic message — internals (SQL, stack traces) are logged, never returned.
 */
export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof ApiError) {
    return c.json<ApiErrorBody>({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof HTTPException && err.status < 500) {
    return c.json<ApiErrorBody>({ error: { code: HTTP_CODES[err.status] ?? 'bad_request', message: err.message || 'Bad request' } }, err.status);
  }
  console.error(err);
  return c.json<ApiErrorBody>({ error: { code: 'internal', message: 'Unexpected server error' } }, 500);
}
