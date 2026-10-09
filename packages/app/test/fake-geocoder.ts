import { type GeocodeCandidate, type Geocoder, GeocoderUnavailableError } from '../src/index.ts';

/**
 * A geocoder without network: `answer` gives the candidates of a query, `unavailable` stands
 * for a service that cannot be reached. Every query is kept, to count calls.
 */
export function createFakeGeocoder(
  answer: (query: string) => GeocodeCandidate[],
  options: { unavailable?: boolean } = {},
): Geocoder & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    search: async (query) => {
      queries.push(query);
      if (options.unavailable) throw new GeocoderUnavailableError('Service unreachable');
      return answer(query);
    },
  };
}

/** Criterion 5 of SPEC-002: the address the IGN returns as a house number. */
export const velizy: GeocodeCandidate = {
  label: "2 Avenue de l'Europe 78140 Vélizy-Villacoublay",
  street: "2 Avenue de l'Europe",
  postcode: '78140',
  city: 'Vélizy-Villacoublay',
  country: 'FR',
  latitude: 48.784357,
  longitude: 2.218975,
  precision: 'address',
  score: 0.97,
};
