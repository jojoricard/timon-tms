// What an adapter raises when the service cannot be reached; re-exported for entry points.
export { GeocoderUnavailableError } from '@timon/app';
export {
  createIgnGeocoder,
  type IgnGeocoderOptions,
  ignRequestsPerSecond,
  ignSearchUrl,
} from './ign.ts';
export { createRateLimiter, type RateLimiter } from './rate-limiter.ts';
