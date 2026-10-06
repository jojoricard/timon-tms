import type { AppType } from '@timon/http';
import { hc } from 'hono/client';

// Typed from the API's own route definitions; same origin on the server and in the demo.
export const api = hc<AppType>(globalThis.location?.origin ?? 'http://localhost').api;

/** A non-2xx answer. `code` is the `error` field of the body, when the API sent one. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined) {
    super(`The API answered ${status}${code ? ` (${code})` : ''}`);
    this.status = status;
    this.code = code;
  }
}

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type SuccessBody<R extends JsonResponse> = Awaited<ReturnType<Extract<R, { ok: true }>['json']>>;

/** The body of a 2xx response; throws an ApiError for anything else. */
export async function ok<R extends JsonResponse>(response: R): Promise<SuccessBody<R>> {
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
    throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : undefined);
  }
  return (await response.json()) as SuccessBody<R>;
}
