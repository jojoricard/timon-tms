/** Driver, power unit (tractor, rigid truck, light van) or trailer. */
export const resourceKinds = ['driver', 'power-unit', 'trailer'] as const;
export type ResourceKind = (typeof resourceKinds)[number];

export const powerUnitKinds = ['tractor', 'rigid-truck', 'light-van'] as const;
export const trailerKinds = ['semi-trailer', 'drawbar-trailer'] as const;
export const vehicleKinds = [...powerUnitKinds, ...trailerKinds] as const;
export type VehicleKind = (typeof vehicleKinds)[number];

/** Regulatory categories, French Highway Code art. R311-1. */
export const vehicleCategories = ['N1', 'N2', 'N3', 'O1', 'O2', 'O3', 'O4'] as const;
export type VehicleCategory = (typeof vehicleCategories)[number];

export type Driver = {
  readonly kind: 'driver';
  readonly lastName: string;
  readonly firstName: string;
  /** As shown on the planning, e.g. "K. Benali". */
  readonly displayName: string;
  readonly employeeNumber: string | null;
  readonly phone: string | null;
  /** Held or not, no dates; compared with what a site requires when a trip is planned (#9). */
  readonly protectiveEquipmentIds: readonly string[];
};

export type Vehicle = {
  readonly kind: 'power-unit' | 'trailer';
  readonly plate: string;
  readonly vehicleKind: VehicleKind;
  readonly category: VehicleCategory;
  /** Gross vehicle weight, kg. */
  readonly gvwKg: number;
  /** Gross combination weight, kg; power units only, since only they pull. */
  readonly gcwKg: number | null;
  readonly makeModel: string | null;
  readonly bodyTypeId: string | null;
  readonly tradeLabelId: string | null;
  readonly capabilityIds: readonly string[];
};

export type ResourceDetails = Driver | Vehicle;

export type Resource = ResourceDetails & {
  readonly id: string;
  readonly archived: boolean;
};

/** The name a resource goes by: display name for a driver, plate for a vehicle. */
export function resourceName(resource: ResourceDetails): string {
  return resource.kind === 'driver' ? resource.displayName : resource.plate;
}

/** "Karim", "Benali" → "K. Benali". */
export function defaultDisplayName(firstName: string, lastName: string): string {
  const initial = firstName.trim().charAt(0).toLocaleUpperCase('fr-FR');
  return initial ? `${initial}. ${lastName.trim()}` : lastName.trim();
}
