import type { Issue } from './issue.ts';
import {
  type Driver,
  powerUnitKinds,
  type ResourceDetails,
  trailerKinds,
  type Vehicle,
  type VehicleCategory,
  type VehicleKind,
} from './resource.ts';

export type { Issue };

/** Rule 2: the categories each kind of vehicle may have. */
export const allowedCategories: Record<VehicleKind, readonly VehicleCategory[]> = {
  'light-van': ['N1'],
  'rigid-truck': ['N2', 'N3'],
  tractor: ['N2', 'N3'],
  'semi-trailer': ['O3', 'O4'],
  'drawbar-trailer': ['O1', 'O2', 'O3', 'O4'],
};

/** A tractor carries nothing without a semi-trailer: the body type is the semi-trailer's. */
export function canHaveBodyType(kind: VehicleKind): boolean {
  return kind !== 'tractor';
}

/** Only power units pull, so only they have a gross combination weight. */
export function canPull(kind: VehicleKind): boolean {
  return (powerUnitKinds as readonly VehicleKind[]).includes(kind);
}

export function vehicleKindsOf(kind: Vehicle['kind']): readonly VehicleKind[] {
  return kind === 'power-unit' ? powerUnitKinds : trailerKinds;
}

const blank = (value: string | null | undefined) => !value || value.trim() === '';

export function checkDriver(driver: Driver): Issue[] {
  const issues: Issue[] = [];
  if (blank(driver.lastName)) issues.push({ field: 'lastName', code: 'required' });
  if (blank(driver.firstName)) issues.push({ field: 'firstName', code: 'required' });
  if (blank(driver.displayName)) issues.push({ field: 'displayName', code: 'required' });
  return issues;
}

export function checkVehicle(vehicle: Vehicle): Issue[] {
  const issues: Issue[] = [];
  if (blank(vehicle.plate)) issues.push({ field: 'plate', code: 'required' });

  if (!vehicleKindsOf(vehicle.kind).includes(vehicle.vehicleKind)) {
    issues.push({ field: 'vehicleKind', code: 'kind-not-allowed' });
    return issues;
  }

  const allowed = allowedCategories[vehicle.vehicleKind];
  if (!allowed.includes(vehicle.category)) {
    issues.push({
      field: 'category',
      code: 'category-not-allowed',
      params: {
        kind: vehicle.vehicleKind,
        category: vehicle.category,
        allowed: allowed.join(', '),
      },
    });
  }

  if (!Number.isInteger(vehicle.gvwKg) || vehicle.gvwKg <= 0) {
    issues.push({ field: 'gvwKg', code: 'weight-not-positive' });
  }
  if (vehicle.gcwKg !== null) {
    if (!canPull(vehicle.vehicleKind)) {
      issues.push({ field: 'gcwKg', code: 'combination-not-allowed' });
    } else if (!Number.isInteger(vehicle.gcwKg) || vehicle.gcwKg <= 0) {
      issues.push({ field: 'gcwKg', code: 'weight-not-positive' });
    } else if (vehicle.gcwKg <= vehicle.gvwKg) {
      issues.push({ field: 'gcwKg', code: 'combination-not-above-vehicle' });
    }
  }

  if (vehicle.bodyTypeId !== null && !canHaveBodyType(vehicle.vehicleKind)) {
    issues.push({ field: 'bodyTypeId', code: 'body-type-not-allowed' });
  }
  return issues;
}

export function checkResource(resource: ResourceDetails): Issue[] {
  return resource.kind === 'driver' ? checkDriver(resource) : checkVehicle(resource);
}
