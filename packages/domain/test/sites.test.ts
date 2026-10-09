import { describe, expect, it } from 'vitest';
import {
  checkSite,
  findDuplicateSites,
  haversineMetres,
  type SiteDetails,
  type SiteForDuplicates,
  streetKey,
  timeZoneOf,
} from '../src/index.ts';

const dockB = { latitude: 45.7124, longitude: 4.95815 };
/** `metres` north of a point: a degree of latitude is about 111.2 km. */
const north = (from: typeof dockB, metres: number) => ({
  latitude: from.latitude + metres / 111_195,
  longitude: from.longitude,
});

const existing: SiteForDuplicates = {
  id: 'dock-b',
  archived: false,
  street1: '14 rue des Frères Lumière',
  postcode: '69800',
  country: 'FR',
  location: dockB,
};

describe('haversineMetres', () => {
  it('measures short distances to the metre', () => {
    expect(Math.round(haversineMetres(dockB, north(dockB, 30)))).toBe(30);
    // Lyon Part-Dieu to Saint-Priest, about 9 km.
    const partDieu = { latitude: 45.7606, longitude: 4.8592 };
    expect(haversineMetres(partDieu, dockB) / 1000).toBeCloseTo(9.37, 1);
  });
});

describe('findDuplicateSites', () => {
  const candidate = (location: typeof dockB | null, street1 = '3 allée du Dock') => ({
    street1,
    postcode: '69800',
    country: 'FR',
    location,
  });

  it('criterion 8: a site 30 metres away is named, with the distance', () => {
    expect(findDuplicateSites(candidate(north(dockB, 30)), [existing])).toEqual([
      { site: existing, distanceMetres: 30, sameStreet: false },
    ]);
  });

  it('stops at 50 metres', () => {
    expect(findDuplicateSites(candidate(north(dockB, 49)), [existing])).toHaveLength(1);
    expect(findDuplicateSites(candidate(north(dockB, 51)), [existing])).toHaveLength(0);
  });

  it('finds the same street line written differently, even without a location', () => {
    const [found] = findDuplicateSites(candidate(null, '14, Rue des Freres-Lumiere'), [existing]);
    expect(found).toEqual({ site: existing, distanceMetres: null, sameStreet: true });
  });

  it('leaves out the site being edited and archived sites', () => {
    const near = candidate(north(dockB, 10));
    expect(findDuplicateSites(near, [existing], { exceptId: 'dock-b' })).toEqual([]);
    expect(findDuplicateSites(near, [{ ...existing, archived: true }])).toEqual([]);
  });

  it('normalises a street line', () => {
    expect(streetKey("1 Avenue de l'Europe")).toBe('1 avenue de l europe');
  });
});

describe('timeZoneOf', () => {
  it('criterion 6: a site in Germany is in Europe/Berlin; Europe/Paris otherwise', () => {
    expect(timeZoneOf('DE')).toBe('Europe/Berlin');
    expect(timeZoneOf('FR')).toBe('Europe/Paris');
    expect(timeZoneOf('ZZ')).toBe('Europe/Paris');
  });
});

describe('checkSite', () => {
  const site: SiteDetails = {
    name: 'Givors materials yard',
    street1: '3 route de Mornant',
    street2: null,
    postcode: '69700',
    city: 'Givors',
    country: 'FR',
    location: null,
    locatedBy: 'not-located',
    openings: [],
    bookingRequired: false,
    bookingMethod: null,
    bookingDetail: null,
    protectiveEquipmentIds: [],
    maxLengthCm: null,
    maxWeightKg: null,
    loadingDock: true,
    semiTrailersAccepted: true,
    gatePhone: null,
    instructions: null,
  };
  const codes = (s: SiteDetails) => checkSite(s).map((i) => `${i.field}:${i.code}`);

  it('accepts a site that is not located', () => {
    expect(checkSite(site)).toEqual([]);
  });

  it('criterion 12: a French postcode has five digits; abroad it is free', () => {
    expect(codes({ ...site, postcode: '7814' })).toEqual(['postcode:postcode-invalid']);
    expect(codes({ ...site, country: 'DE', postcode: '7814' })).toEqual([]);
  });

  it('keeps location and how it was located consistent', () => {
    expect(codes({ ...site, locatedBy: 'address' })).toEqual(['location:location-invalid']);
    expect(
      codes({ ...site, location: { latitude: 95, longitude: 4 }, locatedBy: 'by-hand' }),
    ).toEqual(['location:location-invalid']);
  });

  it('asks how to book when booking is required, and positive limits', () => {
    expect(codes({ ...site, bookingRequired: true, maxLengthCm: 0 })).toEqual([
      'maxLengthCm:value-not-positive',
      'bookingMethod:booking-method-required',
    ]);
  });
});
