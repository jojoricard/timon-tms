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
