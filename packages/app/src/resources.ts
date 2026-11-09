import {
  checkResource,
  compareDrivers,
  type Issue,
  plateKey,
  type ResourceDetails,
  type ResourceKind,
  resourceKinds,
  resourceName,
  type Temporal,
  type VehicleKind,
} from '@timon/domain';
import {
  EmployeeNumberTakenError,
  PlateTakenError,
  type Ports,
  type ReferenceLists,
  StaleVersionError,
  type StoredResource,
} from './ports.ts';
import { searchable } from './search.ts';
import { currentUnitOf, type UnitRef } from './units.ts';
import { guarded, type Stale, stale } from './versions.ts';
import { type ResourceView, resourceView, statusDay } from './views.ts';

/** An issue with one input: the rules of the domain, plus what only the application knows. */
export type FieldIssue =
  | Issue
  | {
      readonly field: string;
      readonly code:
        | 'unknown-value'
        | 'archived'
        | 'opening-unreadable'
        | 'invalid-date'
        | 'invalid-number'
        | 'issued-after-expiry'
        | 'outside-unit'
        | 'unchanged';
      readonly params?: Readonly<Record<string, string | number>>;
    };

/** The active resource that already uses a plate (rule 1). */
export type PlateOwner = {
  readonly id: string;
  readonly name: string;
  readonly kind: ResourceKind;
  readonly vehicleKind: VehicleKind | null;
};

/** The driver, archived or not, that already has an employee number (rule 9). */
export type EmployeeNumberOwner = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
};

export type ResourceResult =
  | { readonly ok: true; readonly resource: ResourceView }
  | { readonly ok: false; readonly reason: 'not-found' }
  | Stale
  /** Rule 5: an archived resource is read only, its documents included, until restored. */
  | { readonly ok: false; readonly reason: 'archived' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] }
  | { readonly ok: false; readonly reason: 'plate-taken'; readonly owner: PlateOwner }
  | {
      readonly ok: false;
      readonly reason: 'employee-number-taken';
      readonly owner: EmployeeNumberOwner;
    }
  /** SPEC-003 rule 7: the resource belongs to a running or future unit. */
  | { readonly ok: false; readonly reason: 'in-unit'; readonly unit: UnitRef };

export const statusFilters = ['all', 'expiring', 'expired'] as const;
export type StatusFilter = (typeof statusFilters)[number];

export function plateOwner(resource: StoredResource): PlateOwner {
  return {
    id: resource.id,
    name: resourceName(resource),
    kind: resource.kind,
    vehicleKind: resource.kind === 'driver' ? null : resource.vehicleKind,
  };
}

export function employeeNumberOwner(driver: StoredResource): EmployeeNumberOwner {
  return { id: driver.id, name: resourceName(driver), archived: driver.archived };
}

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** Trims text; a display name left empty stays empty, the name being built when read. */
export function normalise(details: ResourceDetails): ResourceDetails {
  if (details.kind === 'driver') {
    const lastName = details.lastName.trim();
    const firstName = details.firstName.trim();
    return {
      ...details,
      lastName,
      firstName,
      displayName: clean(details.displayName),
      employeeNumber: clean(details.employeeNumber),
      phone: clean(details.phone),
      protectiveEquipmentIds: [...new Set(details.protectiveEquipmentIds)],
    };
  }
  return {
    ...details,
    plate: details.plate.trim(),
    makeModel: clean(details.makeModel),
    capabilityIds: [...new Set(details.capabilityIds)],
  };
}

/** The domain's rules, and that every list entry exists. */
export function checkDetails(details: ResourceDetails, lists: ReferenceLists): FieldIssue[] {
  const issues: FieldIssue[] = [...checkResource(details)];
  const known = (items: ReferenceLists['bodyTypes'], id: string) => items.some((i) => i.id === id);
  if (details.kind === 'driver') {
    if (details.protectiveEquipmentIds.some((id) => !known(lists.protectiveEquipment, id))) {
      issues.push({ field: 'protectiveEquipmentIds', code: 'unknown-value' });
    }
    return issues;
  }
  if (details.bodyTypeId && !known(lists.bodyTypes, details.bodyTypeId)) {
    issues.push({ field: 'bodyTypeId', code: 'unknown-value' });
  }
  if (details.tradeLabelId && !known(lists.tradeLabels, details.tradeLabelId)) {
    issues.push({ field: 'tradeLabelId', code: 'unknown-value' });
  }
  if (details.capabilityIds.some((id) => !known(lists.capabilities, id))) {
    issues.push({ field: 'capabilityIds', code: 'unknown-value' });
  }
  return issues;
}

async function view(ports: Ports, resource: StoredResource): Promise<ResourceView> {
  const lists = await ports.referenceLists.get();
  return resourceView(resource, lists.documentTypes, statusDay(ports.clock.now()));
}

async function save(
  ports: Ports,
  input: ResourceDetails,
  write: (details: ResourceDetails) => Promise<StoredResource | undefined>,
  exceptId?: string,
): Promise<Exclude<ResourceResult, Stale>> {
  const details = normalise(input);
  const issues = checkDetails(details, await ports.referenceLists.get());
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };

  const taken = async (): Promise<Exclude<ResourceResult, Stale> | undefined> => {
    if (details.kind !== 'driver') {
      const owner = await ports.resources.findActiveByPlate(plateKey(details.plate), exceptId);
      return owner && { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };
    }
    if (details.employeeNumber === null) return undefined;
    const owner = await ports.resources.findDriverByEmployeeNumber(
      details.employeeNumber,
      exceptId,
    );
    return (
      owner && { ok: false, reason: 'employee-number-taken', owner: employeeNumberOwner(owner) }
    );
  };
  const refused = await taken();
  if (refused) return refused;

  try {
    const saved = await write(details);
    return saved
      ? { ok: true, resource: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    // Another resource took the plate or the number between the check and the write: the
    // database refused it.
    const raced = error instanceof PlateTakenError || error instanceof EmployeeNumberTakenError;
    const latest = raced ? await taken() : undefined;
    if (latest) return latest;
    throw error;
  }
}

export function createResource(ports: Ports, details: ResourceDetails) {
  return save(ports, details, (d) => ports.resources.create({ details: d, documents: [] }));
}

/** ADR-005: a stale version is answered before any other rule. */
export async function updateResource(
  ports: Ports,
  id: string,
  version: number,
  details: ResourceDetails,
): Promise<ResourceResult> {
  const existing = await ports.resources.get(id);
  if (!existing || existing.kind !== details.kind) return { ok: false, reason: 'not-found' };
  if (existing.version !== version) return stale(existing.version);
  if (existing.archived) return { ok: false, reason: 'archived' };
  // A vehicle in a running or future unit keeps its kind: the unit was composed for it.
  if (existing.kind !== 'driver' && details.kind !== 'driver') {
    if (existing.vehicleKind !== details.vehicleKind) {
      const unit = await currentUnitOf(ports, id);
      if (unit) return { ok: false, reason: 'in-unit', unit };
    }
  }
  return guarded(() => save(ports, details, (d) => ports.resources.update(id, version, d), id));
}

export async function getResource(ports: Ports, id: string): Promise<ResourceView | undefined> {
  const resource = await ports.resources.get(id);
  return resource ? view(ports, resource) : undefined;
}

/**
 * Rule 5: a resource is never deleted, only archived, and can be restored. One that belongs to a
 * running or future unit cannot be archived (SPEC-003 rule 7).
 */
export async function setArchived(
  ports: Ports,
  id: string,
  version: number,
  archived: boolean,
): Promise<ResourceResult> {
  const existing = await ports.resources.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (existing.version !== version) return stale(existing.version);
  if (archived) {
    const unit = await currentUnitOf(ports, id);
    if (unit) return { ok: false, reason: 'in-unit', unit };
  }
  if (!archived && existing.kind !== 'driver') {
    const owner = await ports.resources.findActiveByPlate(plateKey(existing.plate), id);
    if (owner) return { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };
  }
  try {
    const saved = await ports.resources.setArchived(id, version, archived);
    return saved
      ? { ok: true, resource: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    if (error instanceof StaleVersionError) return stale(error.version);
    if (!(error instanceof PlateTakenError) || existing.kind === 'driver') throw error;
    const owner = await ports.resources.findActiveByPlate(plateKey(existing.plate), id);
    if (owner) return { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };
    throw error;
  }
}

function matches(resource: StoredResource, query: string): boolean {
  const words =
    resource.kind === 'driver'
      ? [
          resource.lastName,
          resource.firstName,
          resourceName(resource),
          resource.employeeNumber ?? '',
        ]
      : [resource.plate, plateKey(resource.plate), resource.makeModel ?? ''];
  const haystack = searchable(words.join(' '));
  return searchable(query)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** Drivers by last name then first name (rule 8), vehicles by plate. */
function compareResources(a: ResourceView, b: ResourceView): number {
  if (a.kind === 'driver' && b.kind === 'driver') return compareDrivers(a, b);
  const key = (r: ResourceView) => (r.kind === 'driver' ? r.lastName : plateKey(r.plate));
  return key(a).localeCompare(key(b), 'fr', { sensitivity: 'base', numeric: true });
}

export type ResourceList = {
  readonly day: Temporal.PlainDate;
  readonly counts: Readonly<Record<StatusFilter, number>>;
  readonly resources: readonly ResourceView[];
};

/**
 * The resources of one kind with their status on today's date. Filtering happens here: a
 * company of 10 to 100 resources fits in one read.
 */
export async function listResources(
  ports: Ports,
  options: {
    kind: ResourceKind;
    includeArchived?: boolean;
    query?: string;
    status?: StatusFilter;
  },
): Promise<ResourceList> {
  const day = statusDay(ports.clock.now());
  const [stored, lists] = await Promise.all([
    ports.resources.list({ kind: options.kind, includeArchived: options.includeArchived ?? false }),
    ports.referenceLists.get(),
  ]);
  const query = options.query?.trim() ?? '';
  const views = stored
    .filter((r) => query === '' || matches(r, query))
    .map((r) => resourceView(r, lists.documentTypes, day));

  const isExpired = (r: ResourceView) => r.severity.startsWith('expired');
  const counts = {
    all: views.length,
    expiring: views.filter((r) => r.severity === 'expiring').length,
    expired: views.filter(isExpired).length,
  };
  const status = options.status ?? 'all';
  const resources = views
    .filter(
      (r) => status === 'all' || (status === 'expired' ? isExpired(r) : r.severity === status),
    )
    .sort(compareResources);
  return { day, counts, resources };
}

/** Active resources per kind, units valid now and documents needing attention, for the tabs. */
export async function resourceSummary(ports: Ports) {
  const now = ports.clock.now();
  const day = statusDay(now);
  const [stored, lists, units] = await Promise.all([
    ports.resources.list({ includeArchived: false }),
    ports.referenceLists.get(),
    ports.units.listAt(now),
  ]);
  const active = Object.fromEntries(
    resourceKinds.map((kind) => [kind, stored.filter((r) => r.kind === kind).length]),
  ) as Record<ResourceKind, number>;
  const expiries = stored
    .flatMap((r) => resourceView(r, lists.documentTypes, day).documents)
    .filter((d) => d.status !== 'valid').length;
  return { day, active, units: units.length, expiries };
}

export function getReferenceLists(ports: Ports) {
  return ports.referenceLists.get();
}
