import type { Coordinates, LocatedBy } from '@timon/domain';

/** How precise a match is: the house number, only the street, or only the city. */
export type GeocodePrecision = 'address' | 'street' | 'city';

export type GeocodeCandidate = {
  readonly label: string;
  /** The street line, with the number when there is one. */
  readonly street: string;
  readonly postcode: string;
  readonly city: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly precision: GeocodePrecision;
  /** Between 0 and 1, as the service gives it. */
  readonly score: number;
};

export type GeocodeOptions = {
  readonly country: string;
  readonly limit: number;
  readonly autocomplete: boolean;
};

/** The service could not be reached or did not answer in time. Never an error for a user. */
export class GeocoderUnavailableError extends Error {
  override readonly name = 'GeocoderUnavailableError';
}

/** Turns an address into candidate locations. The national address base covers France only. */
export interface Geocoder {
  /** @throws GeocoderUnavailableError */
  search(query: string, options: GeocodeOptions): Promise<GeocodeCandidate[]>;
}

/** Countries the geocoder can locate; elsewhere the pin is placed by hand. */
export const geocodedCountries = ['FR'] as const;

/** Bounds of a suggestion request, so that the API is not an open proxy to the service. */
export const suggestionLimits = { minLength: 3, maxLength: 200, maxResults: 5 } as const;

/** Suggestions for an address being typed. An unreachable service gives no suggestion. */
export async function suggestAddresses(
  geocoder: Geocoder,
  query: string,
  options: { country: string; limit: number },
): Promise<{ available: boolean; candidates: GeocodeCandidate[] }> {
  const q = query.trim();
  if (
    q.length < suggestionLimits.minLength ||
    !(geocodedCountries as readonly string[]).includes(options.country)
  ) {
    return { available: true, candidates: [] };
  }
  try {
    const candidates = await geocoder.search(q.slice(0, suggestionLimits.maxLength), {
      country: options.country,
      limit: Math.min(Math.max(1, options.limit), suggestionLimits.maxResults),
      autocomplete: true,
    });
    return { available: true, candidates };
  } catch (error) {
    if (error instanceof GeocoderUnavailableError) return { available: false, candidates: [] };
    throw error;
  }
}

export type Located = { readonly location: Coordinates | null; readonly locatedBy: LocatedBy };

export const notLocated: Located = { location: null, locatedBy: 'not-located' };

/**
 * Locates a postal address, for a site saved or imported without coordinates. A failed or
 * empty lookup gives a site that is not located, never an error.
 */
export async function locateAddress(
  geocoder: Geocoder,
  address: { street1: string; postcode: string; city: string; country: string },
): Promise<Located> {
  if (!(geocodedCountries as readonly string[]).includes(address.country)) return notLocated;
  const query = [address.street1, address.postcode, address.city].filter(Boolean).join(' ');
  try {
    const [best] = await geocoder.search(query, {
      country: address.country,
      limit: 1,
      autocomplete: false,
    });
    if (!best) return notLocated;
    return {
      location: { latitude: best.latitude, longitude: best.longitude },
      locatedBy: best.precision,
    };
  } catch (error) {
    if (error instanceof GeocoderUnavailableError) return notLocated;
    throw error;
  }
}
