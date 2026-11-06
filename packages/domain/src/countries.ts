/**
 * Countries a site or a customer may be in, with the time zone their opening hours are
 * written in. A country with several zones takes its mainland one (Portugal, Spain).
 */
export const countryTimeZones = {
  FR: 'Europe/Paris',
  AD: 'Europe/Andorra',
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',
  CH: 'Europe/Zurich',
  CY: 'Asia/Nicosia',
  CZ: 'Europe/Prague',
  DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen',
  EE: 'Europe/Tallinn',
  ES: 'Europe/Madrid',
  FI: 'Europe/Helsinki',
  GB: 'Europe/London',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  HU: 'Europe/Budapest',
  IE: 'Europe/Dublin',
  IT: 'Europe/Rome',
  LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg',
  LV: 'Europe/Riga',
  MC: 'Europe/Monaco',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo',
  PL: 'Europe/Warsaw',
  PT: 'Europe/Lisbon',
  RO: 'Europe/Bucharest',
  SE: 'Europe/Stockholm',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
} as const;

export type Country = keyof typeof countryTimeZones;
export const countries = Object.keys(countryTimeZones) as Country[];

export function isCountry(value: string): value is Country {
  return Object.hasOwn(countryTimeZones, value);
}

/** Europe/Paris by default, taken from the country otherwise. */
export function timeZoneOf(country: string): string {
  return isCountry(country) ? countryTimeZones[country] : countryTimeZones.FR;
}

/** A rectangle of latitudes and longitudes, in degrees. */
export type Bounds = {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
};

/**
 * A rough box around each country, its mainland and nearby islands, to centre the map and to
 * warn about a pin placed elsewhere (SPEC-002, *Locating a site*). Not a border: a site near
 * one may fall in the neighbour's box, which only raises a warning. Overseas departments and
 * remote islands (the Canaries, the Azores) are outside their country's box.
 */
export const countryBounds: Record<Country, Bounds> = {
  FR: { south: 41.3, west: -5.2, north: 51.1, east: 9.6 },
  AD: { south: 42.43, west: 1.41, north: 42.66, east: 1.79 },
  AT: { south: 46.37, west: 9.53, north: 49.02, east: 17.16 },
  BE: { south: 49.5, west: 2.54, north: 51.51, east: 6.41 },
  BG: { south: 41.23, west: 22.36, north: 44.22, east: 28.61 },
  CH: { south: 45.82, west: 5.96, north: 47.81, east: 10.49 },
  CY: { south: 34.56, west: 32.27, north: 35.71, east: 34.6 },
  CZ: { south: 48.55, west: 12.09, north: 51.06, east: 18.86 },
  DE: { south: 47.27, west: 5.87, north: 55.06, east: 15.04 },
  DK: { south: 54.56, west: 8.07, north: 57.75, east: 15.2 },
  EE: { south: 57.51, west: 21.76, north: 59.68, east: 28.21 },
  ES: { south: 35.95, west: -9.3, north: 43.79, east: 4.33 },
  FI: { south: 59.81, west: 20.55, north: 70.09, east: 31.59 },
  GB: { south: 49.9, west: -8.65, north: 60.86, east: 1.77 },
  GR: { south: 34.8, west: 19.37, north: 41.75, east: 29.65 },
  HR: { south: 42.39, west: 13.49, north: 46.55, east: 19.45 },
  HU: { south: 45.74, west: 16.11, north: 48.59, east: 22.9 },
  IE: { south: 51.42, west: -10.48, north: 55.39, east: -5.99 },
  IT: { south: 36.62, west: 6.63, north: 47.09, east: 18.52 },
  LT: { south: 53.9, west: 20.94, north: 56.45, east: 26.84 },
  LU: { south: 49.45, west: 5.73, north: 50.18, east: 6.53 },
  LV: { south: 55.67, west: 20.97, north: 58.09, east: 28.24 },
  MC: { south: 43.72, west: 7.41, north: 43.75, east: 7.44 },
  MT: { south: 35.78, west: 14.18, north: 36.08, east: 14.58 },
  NL: { south: 50.75, west: 3.36, north: 53.56, east: 7.23 },
  NO: { south: 57.96, west: 4.5, north: 71.19, east: 31.17 },
  PL: { south: 49, west: 14.12, north: 54.84, east: 24.15 },
  PT: { south: 36.96, west: -9.5, north: 42.15, east: -6.19 },
  RO: { south: 43.62, west: 20.26, north: 48.27, east: 29.69 },
  SE: { south: 55.34, west: 10.96, north: 69.06, east: 24.17 },
  SI: { south: 45.42, west: 13.38, north: 46.88, east: 16.6 },
  SK: { south: 47.73, west: 16.83, north: 49.61, east: 22.57 },
};

/** Whether a point lies in the box of a country; true for a country without a box. */
export function isInCountry(
  point: { readonly latitude: number; readonly longitude: number },
  country: string,
): boolean {
  if (!isCountry(country)) return true;
  const { south, west, north, east } = countryBounds[country];
  return (
    point.latitude >= south &&
    point.latitude <= north &&
    point.longitude >= west &&
    point.longitude <= east
  );
}
