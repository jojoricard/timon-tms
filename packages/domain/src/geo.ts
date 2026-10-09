// Distances on the sphere, without PostGIS: they must run on PGlite and in the browser.

export type Coordinates = { readonly latitude: number; readonly longitude: number };

const earthRadiusMetres = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres; under a metre of error at the scale of a site. */
export function haversineMetres(a: Coordinates, b: Coordinates): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** "14, Rue des Frères-Lumière" and "14 rue des freres lumiere" give the same key. */
export function streetKey(street: string): string {
  return street
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type SiteForDuplicates = {
  readonly id: string;
  readonly archived: boolean;
  readonly street1: string;
  readonly postcode: string;
  readonly country: string;
  readonly location: Coordinates | null;
};

export type DuplicateSite<T> = {
  readonly site: T;
  /** Rounded to the metre; null when one of the two sites is not located. */
  readonly distanceMetres: number | null;
  readonly sameStreet: boolean;
};

/** Rule 5: under 50 metres, or the same street line, postcode and country. */
export const duplicateDistanceMetres = 50;

/**
 * The active sites that look like `candidate`, nearest first. The site being edited is left
 * out: it is not a duplicate of itself.
 */
export function findDuplicateSites<T extends SiteForDuplicates>(
  candidate: Omit<SiteForDuplicates, 'id' | 'archived'>,
  sites: readonly T[],
  options: { exceptId?: string | undefined } = {},
): DuplicateSite<T>[] {
  const key = streetKey(candidate.street1);
  return sites
    .filter((site) => !site.archived && site.id !== options.exceptId)
    .map((site) => {
      const distance =
        candidate.location && site.location
          ? haversineMetres(candidate.location, site.location)
          : null;
      const sameStreet =
        key !== '' &&
        streetKey(site.street1) === key &&
        site.postcode.replace(/\s/g, '') === candidate.postcode.replace(/\s/g, '') &&
        site.country === candidate.country;
      return { site, distanceMetres: distance === null ? null : Math.round(distance), sameStreet };
    })
    .filter(
      (d) =>
        d.sameStreet || (d.distanceMetres !== null && d.distanceMetres < duplicateDistanceMetres),
    )
    .sort((a, b) => (a.distanceMetres ?? Infinity) - (b.distanceMetres ?? Infinity));
}
