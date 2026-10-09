import {
  type GeocodeCandidate,
  type GeocodePrecision,
  type Geocoder,
  GeocoderUnavailableError,
} from '@timon/app';
import { createRateLimiter, type RateLimiter } from './rate-limiter.ts';

/**
 * The national address base, served by the IGN Géoplateforme. No key; open to any origin;
 * 50 requests per second per IP address. https://data.geopf.fr/geocodage/openapi
 */
export const ignSearchUrl = 'https://data.geopf.fr/geocodage/search';

/** Under the service's 50 per second, so that other users of the same address keep some room. */
export const ignRequestsPerSecond = 40;

// One limiter per process: every geocoder created here shares it.
const sharedLimiter = createRateLimiter(ignRequestsPerSecond);

type Feature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    name?: string;
    type?: string;
    score?: number;
    postcode?: string;
    city?: string;
  };
};

const precisions: Record<string, GeocodePrecision> = {
  housenumber: 'address',
  street: 'street',
  locality: 'city',
  municipality: 'city',
};

function toCandidate(feature: Feature): GeocodeCandidate | undefined {
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  const p = feature.properties ?? {};
  const precision = precisions[p.type ?? ''];
  if (latitude === undefined || longitude === undefined || !precision) return undefined;
  return {
    label: p.label ?? '',
    // For a city alone there is no street line to fill.
    street: p.type === 'municipality' ? '' : (p.name ?? ''),
    postcode: p.postcode ?? '',
    city: p.city ?? '',
    country: 'FR',
    latitude,
    longitude,
    precision,
    score: p.score ?? 0,
  };
}

export type IgnGeocoderOptions = {
  readonly fetch?: typeof fetch;
  readonly limiter?: RateLimiter;
  readonly timeoutMs?: number;
  readonly url?: string;
};

/**
 * A geocoder on the IGN service. A slow, failed or refused request raises
 * GeocoderUnavailableError: the caller then saves the site as not located.
 */
export function createIgnGeocoder(options: IgnGeocoderOptions = {}): Geocoder {
  const request = options.fetch ?? ((input, init) => fetch(input, init));
  const limiter = options.limiter ?? sharedLimiter;
  const timeoutMs = options.timeoutMs ?? 3000;
  const url = options.url ?? ignSearchUrl;

  return {
    search: async (query, { limit, autocomplete }) => {
      const params = new URLSearchParams({
        q: query,
        index: 'address',
        limit: String(limit),
        autocomplete: autocomplete ? '1' : '0',
      });
      await limiter.acquire();
      let body: { features?: Feature[] };
      try {
        const response = await request(`${url}?${params}`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`IGN answered ${response.status}`);
        body = (await response.json()) as { features?: Feature[] };
      } catch (error) {
        throw new GeocoderUnavailableError('The geocoding service cannot be reached', {
          cause: error,
        });
      }
      return (body.features ?? []).flatMap((f) => toCandidate(f) ?? []);
    },
  };
}
