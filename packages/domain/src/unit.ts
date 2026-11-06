import type { DocumentStatus } from './document-status.ts';
import type { Issue } from './issue.ts';
import {
  holdsCategory,
  type LicenceCategory,
  licenceDocument,
  licenceShown,
  lightVehicleMaxKg,
  requiredLicence,
  sortCategories,
} from './licence.ts';
import {
  type Driver,
  driverName,
  type Resource,
  type ResourceKind,
  type Vehicle,
} from './resource.ts';
import { Temporal } from './temporal.ts';

/** The place a resource takes in a unit: one of each at most. */
export const unitRoles = ['power-unit', 'trailer', 'driver'] as const satisfies ResourceKind[];
export type UnitRole = (typeof unitRoles)[number];

/** A resource as a unit sees it: with its subsidiary (rule 2). */
export type UnitResource = Resource & { readonly subsidiaryId: string };

export type UnitComposition = {
  readonly powerUnit: UnitResource | null;
  readonly trailer: UnitResource | null;
  readonly driver: UnitResource | null;
  /** The categories the driver has a licence document for, whatever its expiry. */
  readonly driverLicences: readonly LicenceCategory[];
};

export const unitFields: Record<UnitRole, string> = {
  'power-unit': 'powerUnitId',
  trailer: 'trailerId',
  driver: 'driverId',
};

/** "Élodie Marchand": how a driver is named in a sentence. */
export function fullName(driver: Pick<Driver, 'firstName' | 'lastName'>): string {
  return `${driver.firstName} ${driver.lastName}`.trim();
}

/** Rule 1: which trailer goes behind which power unit. */
export function trailerIssue(
  powerUnit: Pick<Vehicle, 'vehicleKind'>,
  trailer: Pick<Vehicle, 'vehicleKind'>,
): Issue | null {
  if (powerUnit.vehicleKind === 'light-van') {
    return { field: 'trailerId', code: 'light-van-no-trailer' };
  }
  if (trailer.vehicleKind === 'semi-trailer' && powerUnit.vehicleKind !== 'tractor') {
    return { field: 'trailerId', code: 'semi-trailer-needs-tractor' };
  }
  if (trailer.vehicleKind === 'drawbar-trailer' && powerUnit.vehicleKind !== 'rigid-truck') {
    return { field: 'trailerId', code: 'drawbar-trailer-needs-rigid-truck' };
  }
  return null;
}

/** Rule 5: the category the unit needs, against what the driver holds. */
export function licenceIssue(
  powerUnit: Vehicle,
  trailer: Vehicle | null,
  driver: Driver,
  held: readonly LicenceCategory[],
): Issue | null {
  const needs = requiredLicence(powerUnit, trailer);
  if (needs === 'unsupported') {
    return { field: 'trailerId', code: 'licence-not-supported', params: { needs: 'BE' } };
  }
  if (holdsCategory(held, needs)) return null;
  return {
    field: 'driverId',
    code: 'licence-missing',
    params: { needs, holds: sortCategories(held).join(', '), driver: fullName(driver) },
  };
}

const asVehicle = (r: UnitResource | null): Vehicle | null => (r && r.kind !== 'driver' ? r : null);

/**
 * Rules 1, 2 and 5. With `partial`, a unit still being composed: a missing member is not
 * reported, so that the form can explain why one candidate cannot be chosen.
 */
export function checkComposition(
  unit: UnitComposition,
  options: { partial?: boolean } = {},
): Issue[] {
  const members: [UnitRole, UnitResource | null][] = [
    ['power-unit', unit.powerUnit],
    ['trailer', unit.trailer],
    ['driver', unit.driver],
  ];
  const wrongKind = members.flatMap(([role, member]): Issue[] =>
    member && member.kind !== role ? [{ field: unitFields[role], code: 'kind-not-allowed' }] : [],
  );
  if (wrongKind.length > 0) return wrongKind;

  const issues: Issue[] = [];
  if (!options.partial) {
    if (!unit.powerUnit) issues.push({ field: 'powerUnitId', code: 'required' });
    if (!unit.trailer && !unit.driver) {
      issues.push({ field: 'members', code: 'driver-or-trailer-required' });
    }
  }
  for (const [role, member] of members) {
    if (member?.archived) issues.push({ field: unitFields[role], code: 'resource-archived' });
  }
  const [first, ...others] = members.flatMap(([, m]) => (m ? [m] : []));
  if (first && others.some((m) => m.subsidiaryId !== first.subsidiaryId)) {
    issues.push({ field: 'members', code: 'subsidiary-mismatch' });
  }

  const powerUnit = asVehicle(unit.powerUnit);
  const trailer = asVehicle(unit.trailer);
  if (!powerUnit) return issues;
  const fits = trailer ? trailerIssue(powerUnit, trailer) : null;
  if (fits) {
    issues.push(fits);
    return issues;
  }
  if (unit.driver?.kind === 'driver') {
    const licence = licenceIssue(powerUnit, trailer, unit.driver, unit.driverLicences);
    if (licence) issues.push(licence);
  } else if (trailer && requiredLicence(powerUnit, trailer) === 'unsupported') {
    issues.push({ field: 'trailerId', code: 'licence-not-supported', params: { needs: 'BE' } });
  }
  return issues;
}

const minuteNs = 60_000_000_000n;

/** Rule 3, and times to the minute. */
export function checkUnitPeriod(start: Temporal.Instant, end: Temporal.Instant | null): Issue[] {
  const issues: Issue[] = [];
  if (start.epochNanoseconds % minuteNs !== 0n) {
    issues.push({ field: 'start', code: 'not-to-the-minute' });
  }
  if (end && end.epochNanoseconds % minuteNs !== 0n) {
    issues.push({ field: 'end', code: 'not-to-the-minute' });
  }
  if (end && Temporal.Instant.compare(start, end) >= 0) {
    issues.push({ field: 'end', code: 'end-not-after-start' });
  }
  return issues;
}

/** A unit's name: the one given, else its driver's, else its power unit's plate. */
export function unitName(
  name: string | null,
  driver: Pick<Driver, 'firstName' | 'lastName' | 'displayName'> | null,
  powerUnit: Pick<Vehicle, 'plate'>,
): string {
  return name ?? (driver ? driverName(driver) : powerUnit.plate);
}

/** A document a member of the unit must have, by the code of its type (SPEC-001). */
export type RequiredDocument = { readonly resourceId: string; readonly code: string };

/**
 * The documents a unit's members need: the licence; the CPC and the driver card for a vehicle
 * over 3,500 kg; the roadworthiness test of the power unit, and of a trailer over 3,500 kg; the
 * tachograph inspection of a power unit over 3,500 kg.
 */
export function requiredDocuments(
  powerUnit: Vehicle & { readonly id: string },
  trailer: (Vehicle & { readonly id: string }) | null,
  driver: { readonly id: string } | null,
  driverLicences: readonly LicenceCategory[],
): RequiredDocument[] {
  const heavy = powerUnit.gvwKg > lightVehicleMaxKg;
  const documents: RequiredDocument[] = [];
  if (driver) {
    const needs = requiredLicence(powerUnit, trailer);
    if (needs !== 'unsupported') {
      const shown = licenceShown(driverLicences, needs) ?? needs;
      documents.push({ resourceId: driver.id, code: licenceDocument(shown) });
    }
    if (heavy) {
      documents.push({ resourceId: driver.id, code: 'cpc' });
      documents.push({ resourceId: driver.id, code: 'driver-card' });
    }
  }
  documents.push({ resourceId: powerUnit.id, code: 'roadworthiness' });
  if (heavy) documents.push({ resourceId: powerUnit.id, code: 'tachograph' });
  if (trailer && trailer.gvwKg > lightVehicleMaxKg) {
    documents.push({ resourceId: trailer.id, code: 'roadworthiness' });
  }
  return documents;
}

/** The status of a member's document in a unit: a required one never recorded is missing. */
export const memberDocumentStatuses = ['missing', 'expired', 'expiring', 'valid'] as const;
export type MemberDocumentStatus = DocumentStatus | 'missing';

/** Sorts worst first. */
export function compareMemberStatus(a: MemberDocumentStatus, b: MemberDocumentStatus): number {
  return memberDocumentStatuses.indexOf(a) - memberDocumentStatuses.indexOf(b);
}
