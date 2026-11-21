import type { Context } from 'hono';
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

export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof ApiError) {
    return c.json<ApiErrorBody>({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error(err);
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return c.json<ApiErrorBody>({ error: { code: 'internal', message } }, 500);
}
