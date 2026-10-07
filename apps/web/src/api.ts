import type { AppType } from '@timon/http';
import { hc } from 'hono/client';

// Typed from the API's own route definitions; same origin on the server and in the demo.
export const api = hc<AppType>(globalThis.location?.origin ?? 'http://localhost').api;

/**
 * A non-2xx answer. `code` is the `error` field of the body, when the API sent one; `body`
 * keeps the rest (issues, the resource holding a plate) for the message.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const code =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : undefined;
    super(`The API answered ${status}${code ? ` (${code})` : ''}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type SuccessBody<R extends JsonResponse> = Awaited<ReturnType<Extract<R, { ok: true }>['json']>>;

/** The body of a 2xx response; throws an ApiError for anything else. */
export async function ok<R extends JsonResponse>(response: R): Promise<SuccessBody<R>> {
  if (!response.ok) {
    throw new ApiError(response.status, await response.json().catch(() => undefined));
  }
  return (await response.json()) as SuccessBody<R>;
}
