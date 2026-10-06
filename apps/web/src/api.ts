import type { AppType } from '@timon/http';
import { hc } from 'hono/client';

// Typed from the API's own route definitions; same origin on the server and in the demo.
export const api = hc<AppType>(globalThis.location?.origin ?? 'http://localhost').api;
