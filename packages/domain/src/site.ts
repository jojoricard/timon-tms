import { isCountry } from './countries.ts';
import { type Coordinates, isValidCoordinates } from './geo.ts';
import { blank, type Issue } from './issue.ts';
import { checkOpeningRanges, type OpeningRange } from './opening-hours.ts';

/**
 * How a site was located: the exact number was found, only the street or the city, the pin was
 * placed by hand, or not at all. An order will not accept a site that is not located (#8).
 */
export const locatedByValues = ['address', 'street', 'city', 'by-hand', 'not-located'] as const;
export type LocatedBy = (typeof locatedByValues)[number];

export function isLocatedBy(value: string): value is LocatedBy {
  return (locatedByValues as readonly string[]).includes(value);
}

export const bookingMethods = ['phone', 'email', 'portal'] as const;
export type BookingMethod = (typeof bookingMethods)[number];

/** A place goods are picked up or delivered; it belongs to the company, not to a customer. */
export type SiteDetails = {
  readonly name: string;
  readonly street1: string;
  readonly street2: string | null;
  readonly postcode: string;
  readonly city: string;
  readonly country: string;
  readonly location: Coordinates | null;
  readonly locatedBy: LocatedBy;
  readonly openings: readonly OpeningRange[];
  readonly bookingRequired: boolean;
  readonly bookingMethod: BookingMethod | null;
  readonly bookingDetail: string | null;
  readonly protectiveEquipmentIds: readonly string[];
  /** Maximum vehicle length, in centimetres. */
  readonly maxLengthCm: number | null;
  readonly maxWeightKg: number | null;
  readonly loadingDock: boolean;
  readonly semiTrailersAccepted: boolean;
  readonly gatePhone: string | null;
  readonly instructions: string | null;
};

const positive = (value: number | null) => value === null || (Number.isInteger(value) && value > 0);

export function checkSite(site: SiteDetails): Issue[] {
  const issues: Issue[] = [];
  if (blank(site.name)) issues.push({ field: 'name', code: 'required' });
  if (blank(site.street1)) issues.push({ field: 'street1', code: 'required' });
  if (blank(site.city)) issues.push({ field: 'city', code: 'required' });
  if (!isCountry(site.country)) issues.push({ field: 'country', code: 'country-unknown' });
  if (site.country === 'FR') {
    if (blank(site.postcode)) issues.push({ field: 'postcode', code: 'required' });
    else if (!/^\d{5}$/.test(site.postcode))
      issues.push({ field: 'postcode', code: 'postcode-invalid' });
  }

  const located = site.locatedBy !== 'not-located';
  if (
    located !== (site.location !== null) ||
    (site.location && !isValidCoordinates(site.location.latitude, site.location.longitude))
  ) {
    issues.push({ field: 'location', code: 'location-invalid' });
  }

  if (!positive(site.maxLengthCm))
    issues.push({ field: 'maxLengthCm', code: 'value-not-positive' });
  if (!positive(site.maxWeightKg))
    issues.push({ field: 'maxWeightKg', code: 'value-not-positive' });
  if (site.bookingRequired && site.bookingMethod === null) {
    issues.push({ field: 'bookingMethod', code: 'booking-method-required' });
  }
  issues.push(...checkOpeningRanges(site.openings));
  return issues;
}
