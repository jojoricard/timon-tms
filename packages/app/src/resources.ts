import {
  checkResource,
  defaultDisplayName,
  type Issue,
  plateKey,
  type ResourceDetails,
  type ResourceKind,
  resourceKinds,
  resourceName,
  type Temporal,
  type VehicleKind,
} from '@timon/domain';
import { PlateTakenError, type Ports, type ReferenceLists, type StoredResource } from './ports.ts';
import { type ResourceView, resourceView, statusDay } from './views.ts';

/** An issue with one input: the rules of the domain, plus what only the application knows. */
export type FieldIssue =
  | Issue
  | {
      readonly field: string;
      readonly code: 'unknown-value' | 'invalid-date' | 'invalid-number' | 'issued-after-expiry';
      readonly params?: Readonly<Record<string, string | number>>;
    };

/** The active resource that already uses a plate (rule 1). */
export type PlateOwner = {
  readonly id: string;
  readonly name: string;
  readonly kind: ResourceKind;
  readonly vehicleKind: VehicleKind | null;
};

export type ResourceResult =
  | { readonly ok: true; readonly resource: ResourceView }
  | { readonly ok: false; readonly reason: 'not-found' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] }
  | { readonly ok: false; readonly reason: 'plate-taken'; readonly owner: PlateOwner };

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

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** Trims text and fills the display name of a driver when left empty. */
export function normalise(details: ResourceDetails): ResourceDetails {
  if (details.kind === 'driver') {
    const lastName = details.lastName.trim();
    const firstName = details.firstName.trim();
    return {
      ...details,
      lastName,
      firstName,
      displayName: clean(details.displayName) ?? defaultDisplayName(firstName, lastName),
      employeeNumber: clean(details.employeeNumber),
      phone: clean(details.phone),
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
  if (details.kind === 'driver') return issues;
  const known = (items: ReferenceLists['bodyTypes'], id: string) => items.some((i) => i.id === id);
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
): Promise<ResourceResult> {
  const details = normalise(input);
  const issues = checkDetails(details, await ports.referenceLists.get());
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };

  const taken = async () =>
    details.kind === 'driver'
      ? undefined
      : ports.resources.findActiveByPlate(plateKey(details.plate), exceptId);
  const owner = await taken();
  if (owner) return { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };

  try {
    const saved = await write(details);
    return saved
      ? { ok: true, resource: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    // Another resource took the plate between the check and the write: the database refused it.
    const latest = error instanceof PlateTakenError ? await taken() : undefined;
    if (latest) return { ok: false, reason: 'plate-taken', owner: plateOwner(latest) };
    throw error;
  }
}

export function createResource(ports: Ports, details: ResourceDetails) {
  return save(ports, details, (d) => ports.resources.create({ details: d, documents: [] }));
}

export async function updateResource(
  ports: Ports,
  id: string,
  details: ResourceDetails,
): Promise<ResourceResult> {
  const existing = await ports.resources.get(id);
  if (!existing || existing.kind !== details.kind) return { ok: false, reason: 'not-found' };
  return save(ports, details, (d) => ports.resources.update(id, d), id);
}

export async function getResource(ports: Ports, id: string): Promise<ResourceView | undefined> {
  const resource = await ports.resources.get(id);
  return resource ? view(ports, resource) : undefined;
}

/** Rule 5: a resource is never deleted, only archived, and can be restored. */
export async function setArchived(
  ports: Ports,
  id: string,
  archived: boolean,
): Promise<ResourceResult> {
  const existing = await ports.resources.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (!archived && existing.kind !== 'driver') {
    const owner = await ports.resources.findActiveByPlate(plateKey(existing.plate), id);
    if (owner) return { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };
  }
  try {
    const saved = await ports.resources.setArchived(id, archived);
    return saved
      ? { ok: true, resource: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    if (!(error instanceof PlateTakenError) || existing.kind === 'driver') throw error;
    const owner = await ports.resources.findActiveByPlate(plateKey(existing.plate), id);
    if (owner) return { ok: false, reason: 'plate-taken', owner: plateOwner(owner) };
    throw error;
  }
}

const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function matches(resource: StoredResource, query: string): boolean {
  const words =
    resource.kind === 'driver'
      ? [resource.lastName, resource.firstName, resource.displayName, resource.employeeNumber ?? '']
      : [resource.plate, plateKey(resource.plate), resource.makeModel ?? ''];
  const haystack = searchable(words.join(' '));
  return searchable(query)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** Drivers by last name, vehicles by plate. */
const sortKey = (r: StoredResource | ResourceView) =>
  r.kind === 'driver' ? `${r.lastName} ${r.firstName}` : plateKey(r.plate);

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
    .sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b), 'fr', { sensitivity: 'base', numeric: true }),
    );
  return { day, counts, resources };
}

/** Active resources per kind and documents needing attention, for the tabs. */
export async function resourceSummary(ports: Ports) {
  const day = statusDay(ports.clock.now());
  const [stored, lists] = await Promise.all([
    ports.resources.list({ includeArchived: false }),
    ports.referenceLists.get(),
  ]);
  const active = Object.fromEntries(
    resourceKinds.map((kind) => [kind, stored.filter((r) => r.kind === kind).length]),
  ) as Record<ResourceKind, number>;
  const expiries = stored
    .flatMap((r) => resourceView(r, lists.documentTypes, day).documents)
    .filter((d) => d.status !== 'valid').length;
  return { day, active, expiries };
}

export function getReferenceLists(ports: Ports) {
  return ports.referenceLists.get();
}
