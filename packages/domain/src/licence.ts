import type { Vehicle } from './resource.ts';

/** The driving licence categories of SPEC-001, lowest first. */
export const licenceCategories = ['B', 'C1', 'C', 'C1E', 'CE'] as const;
export type LicenceCategory = (typeof licenceCategories)[number];

/** Weights of SPEC-003, kg. */
export const lightVehicleMaxKg = 3_500;
export const mediumVehicleMaxKg = 7_500;
export const lightTrailerMaxKg = 750;
export const c1eCombinationMaxKg = 12_000;

/**
 * What each category also allows. A higher category covers the lower ones (SPEC-003), and every
 * heavy category covers B, which it requires to be obtained.
 */
const covered: Record<LicenceCategory, readonly LicenceCategory[]> = {
  B: ['B'],
  C1: ['C1', 'B'],
  C: ['C', 'C1', 'B'],
  C1E: ['C1E', 'C1', 'B'],
  CE: ['CE', 'C1E', 'C', 'C1', 'B'],
};

export type LicenceVehicle = Pick<Vehicle, 'vehicleKind' | 'gvwKg'>;

/**
 * The category a unit needs, from the gross vehicle weights. `unsupported` is a light power unit
 * with a trailer over 750 kg: it needs BE, which is not among the categories Timon records.
 */
export function requiredLicence(
  powerUnit: LicenceVehicle,
  trailer: LicenceVehicle | null,
): LicenceCategory | 'unsupported' {
  if (powerUnit.vehicleKind === 'tractor' && trailer?.vehicleKind === 'semi-trailer') return 'CE';
  const alone: LicenceCategory =
    powerUnit.gvwKg <= lightVehicleMaxKg ? 'B' : powerUnit.gvwKg <= mediumVehicleMaxKg ? 'C1' : 'C';
  if (!trailer || trailer.gvwKg <= lightTrailerMaxKg) return alone;
  if (alone === 'B') return 'unsupported';
  if (alone === 'C1' && powerUnit.gvwKg + trailer.gvwKg <= c1eCombinationMaxKg) return 'C1E';
  return 'CE';
}

/** Whether a driver holding `held` may drive what needs `needed`. */
export function holdsCategory(held: readonly LicenceCategory[], needed: LicenceCategory): boolean {
  return held.some((category) => covered[category].includes(needed));
}

/** The categories recorded for a driver, lowest first, without duplicates. */
export function sortCategories(held: Iterable<LicenceCategory>): LicenceCategory[] {
  const set = new Set(held);
  return licenceCategories.filter((category) => set.has(category));
}

/** The licence a driver shows for `needed`: that category, or the lowest held one covering it. */
export function licenceShown(
  held: readonly LicenceCategory[],
  needed: LicenceCategory,
): LicenceCategory | null {
  return sortCategories(held).find((category) => covered[category].includes(needed)) ?? null;
}

/** "licence-ce" → "CE": the document types of SPEC-001 that are driving licences. */
export function licenceOfDocument(code: string | null): LicenceCategory | null {
  if (!code?.startsWith('licence-')) return null;
  const category = code.slice('licence-'.length).toUpperCase();
  return (licenceCategories as readonly string[]).includes(category)
    ? (category as LicenceCategory)
    : null;
}

export function licenceDocument(category: LicenceCategory): string {
  return `licence-${category.toLowerCase()}`;
}
