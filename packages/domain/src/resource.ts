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
  /**
   * As typed by the dispatcher, e.g. "Kader"; null when left empty, the name being built from
   * the names when read (rule 8). See `driverName`.
   */
  readonly displayName: string | null;
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
  return resource.kind === 'driver' ? driverName(resource) : resource.plate;
}

/**
 * "Karim", "Benali" → "K. Benali". Migration 0014 builds the same name in SQL
 * (`driver_display_name`); a test compares the two.
 */
export function defaultDisplayName(firstName: string, lastName: string): string {
  const [first = ''] = firstName.trim();
  const initial = first.toLocaleUpperCase('fr-FR');
  return initial ? `${initial}. ${lastName.trim()}` : lastName.trim();
}

/** Rule 8: the display name typed, or else the one built from the names as they are now. */
export function driverName(driver: Pick<Driver, 'firstName' | 'lastName' | 'displayName'>): string {
  return driver.displayName ?? defaultDisplayName(driver.firstName, driver.lastName);
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Rule 8: drivers by last name, then first name, without case or accents. */
export function compareDrivers(
  a: Pick<Driver, 'firstName' | 'lastName'>,
  b: Pick<Driver, 'firstName' | 'lastName'>,
): number {
  return collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);
}
