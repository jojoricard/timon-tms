import {
  checkComposition,
  checkUnitPeriod,
  companyDay,
  compareDrivers,
  compareMemberStatus,
  contains,
  documentStatus,
  driverName,
  fullName,
  type Issue,
  type LicenceCategory,
  licenceOfDocument,
  type MemberDocumentStatus,
  type OpenPeriod,
  powerUnitKinds,
  requiredDocuments,
  requiredLicence,
  resourceName,
  sortCategories,
  Temporal,
  type UnitComposition,
  type UnitResource,
  type UnitRole,
  unitFields,
  unitName,
  unitRoles,
  type VehicleKind,
} from '@timon/domain';
import {
  type NewUnit,
  type Ports,
  type ReferenceLists,
  type StoredResource,
  type StoredUnit,
  UnitOverlapError,
} from './ports.ts';
import type { FieldIssue } from './resources.ts';

/** What a dispatcher enters: the members, the period, a name if wanted. */
export type UnitInput = {
  readonly name: string | null;
  readonly powerUnitId: string | null;
  readonly trailerId: string | null;
  readonly driverId: string | null;
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant | null;
};

/** A resource as a unit shows it. */
export type MemberView = {
  readonly id: string;
  readonly kind: UnitRole;
  /** Display name of a driver, plate of a vehicle. */
  readonly name: string;
  /** First and last name of a driver, plate of a vehicle: for sentences. */
  readonly fullName: string;
  readonly archived: boolean;
  readonly vehicleKind: VehicleKind | null;
  readonly makeModel: string | null;
  readonly category: string | null;
  readonly gvwKg: number | null;
  readonly gcwKg: number | null;
  readonly bodyTypeId: string | null;
  /** The categories a driver has a licence document for, lowest first. */
  readonly licences: readonly LicenceCategory[];
};

/** A unit named in a message: which one, over which period. */
export type UnitRef = {
  readonly id: string;
  readonly name: string;
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant | null;
};

/** A unit a new one would overlap, and the resource they would share (rule 4). */
export type UnitConflict = {
  readonly unit: UnitRef;
  readonly resource: Pick<MemberView, 'id' | 'kind' | 'name'>;
};

export type UnitDocument = {
  readonly resourceId: string;
  readonly member: string;
  /** Code of the document type, e.g. `cpc`. */
  readonly code: string;
  readonly documentTypeId: string | null;
  readonly expiresOn: Temporal.PlainDate | null;
  readonly status: MemberDocumentStatus;
};

/** The documents the members need, on the start date or today for a running unit. */
export type UnitDocuments = {
  readonly day: Temporal.PlainDate;
  /** The worst of them; never blocking. */
  readonly status: MemberDocumentStatus;
  readonly worst: UnitDocument | null;
  /** The earliest expiry from that day to the end of the unit. */
  readonly nextExpiry: UnitDocument | null;
  readonly documents: readonly UnitDocument[];
};

export const unitStates = ['future', 'running', 'ended'] as const;
export type UnitState = (typeof unitStates)[number];

export type UnitView = UnitRef & {
  readonly customName: string | null;
  readonly state: UnitState;
  readonly powerUnit: MemberView;
  readonly trailer: MemberView | null;
  readonly driver: MemberView | null;
  readonly licence: LicenceCategory | 'unsupported';
  readonly previousUnitId: string | null;
  /** What changed from the previous unit, when this one continues it. */
  readonly changed: UnitRole | null;
  readonly documents: UnitDocuments;
};

export type UnitResult =
  | { readonly ok: true; readonly unit: UnitView }
  | { readonly ok: false; readonly reason: 'not-found' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] }
  | { readonly ok: false; readonly reason: 'overlap'; readonly conflicts: readonly UnitConflict[] }
  /** Rule 6: a started unit can only be given an end. */
  | { readonly ok: false; readonly reason: 'started' }
  | { readonly ok: false; readonly reason: 'not-started' }
  | { readonly ok: false; readonly reason: 'ended' };

export type ChangeResult =
  | { readonly ok: true; readonly ended: UnitView; readonly unit: UnitView }
  | Exclude<UnitResult, { ok: true }>;

/** Everything a unit view is built from, read once per request. */
type Context = {
  readonly now: Temporal.Instant;
  readonly resources: ReadonlyMap<string, StoredResource>;
  readonly lists: ReferenceLists;
};

async function context(ports: Ports): Promise<Context> {
  const [stored, lists] = await Promise.all([
    ports.resources.list({ includeArchived: true }),
    ports.referenceLists.get(),
  ]);
  return { now: ports.clock.now(), resources: new Map(stored.map((r) => [r.id, r])), lists };
}

function licencesOf(resource: StoredResource, lists: ReferenceLists): LicenceCategory[] {
  return sortCategories(
    resource.documents.flatMap((d) => {
      const type = lists.documentTypes.find((t) => t.id === d.documentTypeId);
      const category = licenceOfDocument(type?.code ?? null);
      return category ? [category] : [];
    }),
  );
}

function memberView(resource: StoredResource, lists: ReferenceLists): MemberView {
  if (resource.kind === 'driver') {
    return {
      id: resource.id,
      kind: 'driver',
      name: driverName(resource),
      fullName: fullName(resource),
      archived: resource.archived,
      vehicleKind: null,
      makeModel: null,
      category: null,
      gvwKg: null,
      gcwKg: null,
      bodyTypeId: null,
      licences: licencesOf(resource, lists),
    };
  }
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.plate,
    fullName: resource.plate,
    archived: resource.archived,
    vehicleKind: resource.vehicleKind,
    makeModel: resource.makeModel,
    category: resource.category,
    gvwKg: resource.gvwKg,
    gcwKg: resource.gcwKg,
    bodyTypeId: resource.bodyTypeId,
    licences: [],
  };
}

function stateOf(period: OpenPeriod, now: Temporal.Instant): UnitState {
  if (Temporal.Instant.compare(now, period.start) < 0) return 'future';
  return contains(period, now) ? 'running' : 'ended';
}

const memberId = (unit: StoredUnit, role: UnitRole) =>
  role === 'power-unit' ? unit.powerUnitId : role === 'trailer' ? unit.trailerId : unit.driverId;

function find(ctx: Context, id: string | null): StoredResource | null {
  if (id === null) return null;
  const resource = ctx.resources.get(id);
  if (!resource) throw new Error(`Unit member ${id} is not a resource`);
  return resource;
}

function unitRef(ctx: Context, unit: StoredUnit): UnitRef {
  const powerUnit = find(ctx, unit.powerUnitId);
  const driver = find(ctx, unit.driverId);
  if (powerUnit?.kind !== 'power-unit') throw new Error(`Unit ${unit.id} has no power unit`);
  return {
    id: unit.id,
    name: unitName(unit.name, driver?.kind === 'driver' ? driver : null, powerUnit),
    start: unit.period.start,
    end: unit.period.end,
  };
}

/** The day documents are judged on: the start date, or today once the unit has started. */
function documentDay(period: OpenPeriod, now: Temporal.Instant): Temporal.PlainDate {
  return companyDay(Temporal.Instant.compare(period.start, now) > 0 ? period.start : now);
}

function documentsOf(
  ctx: Context,
  members: {
    powerUnit: StoredResource;
    trailer: StoredResource | null;
    driver: StoredResource | null;
  },
  period: OpenPeriod,
): UnitDocuments {
  const day = documentDay(period, ctx.now);
  const { powerUnit, trailer, driver } = members;
  if (powerUnit.kind === 'driver' || trailer?.kind === 'driver') {
    throw new Error('A vehicle was expected');
  }
  const licences = driver ? licencesOf(driver, ctx.lists) : [];
  const documents = requiredDocuments(powerUnit, trailer, driver, licences).map(
    ({ resourceId, code }): UnitDocument => {
      const resource = find(ctx, resourceId);
      const type = ctx.lists.documentTypes.find((t) => t.code === code);
      const recorded = resource?.documents.find((d) => d.documentTypeId === type?.id);
      return {
        resourceId,
        member: resource ? resourceName(resource) : resourceId,
        code,
        documentTypeId: type?.id ?? null,
        expiresOn: recorded?.expiresOn ?? null,
        status:
          recorded && type ? documentStatus(recorded.expiresOn, type.warnDays, day) : 'missing',
      };
    },
  );
  const byDate = (a: UnitDocument, b: UnitDocument) =>
    a.expiresOn && b.expiresOn ? Temporal.PlainDate.compare(a.expiresOn, b.expiresOn) : 0;
  const [worst] = documents
    .filter((d) => d.status !== 'valid')
    .sort((a, b) => compareMemberStatus(a.status, b.status) || byDate(a, b));
  const lastDay = period.end ? companyDay(period.end) : null;
  const [nextExpiry] = documents
    .filter(
      (d) =>
        d.expiresOn &&
        Temporal.PlainDate.compare(d.expiresOn, day) >= 0 &&
        (!lastDay || Temporal.PlainDate.compare(d.expiresOn, lastDay) <= 0),
    )
    .sort(byDate);
  return {
    day,
    status: worst?.status ?? 'valid',
    worst: worst ?? null,
    nextExpiry: nextExpiry ?? null,
    documents,
  };
}

function unitView(ctx: Context, unit: StoredUnit, previous?: StoredUnit): UnitView {
  const powerUnit = find(ctx, unit.powerUnitId);
  if (powerUnit?.kind !== 'power-unit') throw new Error(`Unit ${unit.id} is broken`);
  const trailer = find(ctx, unit.trailerId);
  const driver = find(ctx, unit.driverId);
  const asVehicle = (r: StoredResource | null) => (r && r.kind !== 'driver' ? r : null);
  return {
    ...unitRef(ctx, unit),
    customName: unit.name,
    state: stateOf(unit.period, ctx.now),
    powerUnit: memberView(powerUnit, ctx.lists),
    trailer: trailer ? memberView(trailer, ctx.lists) : null,
    driver: driver ? memberView(driver, ctx.lists) : null,
    licence: requiredLicence(powerUnit, asVehicle(trailer)),
    previousUnitId: unit.previousUnitId,
    changed: previous
      ? (unitRoles.find((role) => memberId(unit, role) !== memberId(previous, role)) ?? null)
      : null,
    documents: documentsOf(ctx, { powerUnit, trailer, driver }, unit.period),
  };
}

async function viewOf(ports: Ports, ctx: Context, unit: StoredUnit): Promise<UnitView> {
  const previous = unit.previousUnitId ? await ports.units.get(unit.previousUnitId) : undefined;
  return unitView(ctx, unit, previous);
}

const kindOrder = (unit: UnitView) =>
  powerUnitKinds.indexOf(unit.powerUnit.vehicleKind as (typeof powerUnitKinds)[number]);
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });

/** Free resources and candidates: drivers by last then first name (SPEC-001 rule 8). */
function byMember(ctx: Context) {
  return (a: MemberView, b: MemberView): number => {
    const one = ctx.resources.get(a.id);
    const other = ctx.resources.get(b.id);
    return one?.kind === 'driver' && other?.kind === 'driver'
      ? compareDrivers(one, other)
      : byName(a, b);
  };
}

export type UnitsAt = {
  readonly at: Temporal.Instant;
  /** By kind of power unit (tractors, rigid trucks, light vans), then by name. */
  readonly units: readonly UnitView[];
  /** Active resources in no unit at that instant. */
  readonly free: Readonly<Record<UnitRole, readonly MemberView[]>>;
};

/** The units valid at an instant, now by default, and what is left free. */
export async function unitsAt(ports: Ports, at?: Temporal.Instant): Promise<UnitsAt> {
  const ctx = await context(ports);
  const instant = at ?? ctx.now;
  const stored = await ports.units.listAt(instant);
  const units = await Promise.all(stored.map((u) => viewOf(ports, ctx, u)));
  const busy = new Set(stored.flatMap((u) => unitRoles.map((role) => memberId(u, role))));
  const free = Object.fromEntries(
    unitRoles.map((role) => [
      role,
      [...ctx.resources.values()]
        .filter((r) => r.kind === role && !r.archived && !busy.has(r.id))
        .map((r) => memberView(r, ctx.lists))
        .sort(byMember(ctx)),
    ]),
  ) as Record<UnitRole, MemberView[]>;
  return {
    at: instant,
    units: units.sort((a, b) => kindOrder(a) - kindOrder(b) || byName(a, b)),
    free,
  };
}

export async function getUnit(ports: Ports, id: string): Promise<UnitView | undefined> {
  const unit = await ports.units.get(id);
  return unit ? viewOf(ports, await context(ports), unit) : undefined;
}

/** The units of a resource, past, running and future, latest first. */
export async function unitsOfResource(ports: Ports, resourceId: string): Promise<UnitView[]> {
  const ctx = await context(ports);
  const stored = await ports.units.listByResource(resourceId);
  return Promise.all(stored.map((u) => viewOf(ports, ctx, u)));
}

/** The running or future unit of a resource, if any: it cannot be archived (rule 7). */
export async function currentUnitOf(ports: Ports, resourceId: string): Promise<UnitRef | null> {
  const now = ports.clock.now();
  const stored = await ports.units.listByResource(resourceId);
  const current = stored
    .filter((u) => u.period.end === null || Temporal.Instant.compare(u.period.end, now) > 0)
    .sort((a, b) => Temporal.Instant.compare(a.period.start, b.period.start))[0];
  return current ? unitRef(await context(ports), current) : null;
}

/** Why a resource cannot be chosen: in another unit, or a rule of the domain. */
export type CandidateReason =
  | Issue
  | {
      readonly field: string;
      readonly code: 'busy';
      readonly params: { readonly unit: string; readonly start: string; readonly end: string };
    };

export type Candidate = { readonly resource: MemberView; readonly reason: CandidateReason | null };

export type UnitOptions = {
  readonly candidates: Readonly<Record<UnitRole, readonly Candidate[]>>;
  /** The category the chosen power unit and trailer need. */
  readonly licence: LicenceCategory | 'unsupported' | null;
  /** The documents of the chosen members, once a power unit is chosen. */
  readonly documents: UnitDocuments | null;
};

export type OptionsInput = Omit<UnitInput, 'name'> & { readonly exceptUnitId?: string };

const fitCodes = new Set<Issue['code']>([
  'light-van-no-trailer',
  'semi-trailer-needs-tractor',
  'drawbar-trailer-needs-rigid-truck',
]);
const issueKey = (issue: Issue) => `${issue.field}:${issue.code}`;

/**
 * For the unit form: every active resource with the reason it cannot be chosen over the period,
 * given the members already chosen.
 */
export async function unitOptions(ports: Ports, input: OptionsInput): Promise<UnitOptions> {
  const ctx = await context(ports);
  const period: OpenPeriod =
    input.end && Temporal.Instant.compare(input.start, input.end) >= 0
      ? { start: input.start, end: null }
      : { start: input.start, end: input.end };
  const overlapping = await ports.units.listOverlapping(period, input.exceptUnitId);
  const busyIn = (resourceId: string) =>
    overlapping.find((u) => unitRoles.some((role) => memberId(u, role) === resourceId));

  const chosen = (id: string | null) => {
    const resource = id ? ctx.resources.get(id) : undefined;
    return resource && !resource.archived ? resource : null;
  };
  const members: Record<UnitRole, StoredResource | null> = {
    'power-unit': chosen(input.powerUnitId),
    trailer: chosen(input.trailerId),
    driver: chosen(input.driverId),
  };
  const composition = (m: Record<UnitRole, StoredResource | null>): UnitComposition => ({
    powerUnit: m['power-unit'],
    trailer: m.trailer,
    driver: m.driver,
    driverLicences: m.driver ? licencesOf(m.driver, ctx.lists) : [],
  });

  const candidates = Object.fromEntries(
    unitRoles.map((role) => {
      const without = { ...members, [role]: null };
      const baseline = new Set(
        checkComposition(composition(without), { partial: true }).map(issueKey),
      );
      const list = [...ctx.resources.values()]
        .filter((r) => r.kind === role && !r.archived)
        .map((resource): Candidate => {
          const view = memberView(resource, ctx.lists);
          const issues = checkComposition(composition({ ...without, [role]: resource }), {
            partial: true,
          }).filter((i) => !baseline.has(issueKey(i)));
          // A trailer that never fits the chosen power unit says so first, as on the mockup;
          // otherwise a resource taken, then the rules.
          const misfit = role === 'trailer' ? issues.find((i) => fitCodes.has(i.code)) : undefined;
          if (misfit) return { resource: view, reason: misfit };
          const busy = busyIn(resource.id);
          if (busy) {
            const ref = unitRef(ctx, busy);
            return {
              resource: view,
              reason: {
                field: unitFields[role],
                code: 'busy',
                params: {
                  unit: ref.name,
                  start: ref.start.toString(),
                  end: ref.end?.toString() ?? '',
                },
              },
            };
          }
          return { resource: view, reason: issues[0] ?? null };
        })
        .sort((a, b) => byMember(ctx)(a.resource, b.resource));
      return [role, list];
    }),
  ) as Record<UnitRole, Candidate[]>;

  const powerUnit = members['power-unit'];
  const trailer = members.trailer;
  const vehicle = (r: StoredResource | null) => (r && r.kind !== 'driver' ? r : null);
  const fits = powerUnit?.kind === 'power-unit';
  return {
    candidates,
    licence: fits ? requiredLicence(powerUnit, vehicle(trailer)) : null,
    documents: fits
      ? documentsOf(ctx, { powerUnit, trailer: vehicle(trailer), driver: members.driver }, period)
      : null,
  };
}

type Prepared =
  | { readonly ok: true; readonly unit: NewUnit }
  | Extract<UnitResult, { reason: 'invalid' | 'overlap' }>;

/** The rules of a unit, before it is written. */
async function prepare(
  ports: Ports,
  input: UnitInput,
  previousUnitId: string | null,
  exceptUnitId?: string,
): Promise<Prepared> {
  const issues: FieldIssue[] = [...checkUnitPeriod(input.start, input.end)];
  const ctx = await context(ports);
  const resolve = (role: UnitRole, id: string | null): UnitResource | null => {
    if (id === null) return null;
    const resource = ctx.resources.get(id);
    if (!resource) {
      issues.push({ field: unitFields[role], code: 'unknown-value' });
      return null;
    }
    return resource;
  };
  const powerUnit = resolve('power-unit', input.powerUnitId);
  const trailer = resolve('trailer', input.trailerId);
  const driver = resolve('driver', input.driverId);
  if (issues.some((i) => i.code === 'unknown-value'))
    return { ok: false, reason: 'invalid', issues };
  issues.push(
    ...checkComposition({
      powerUnit,
      trailer,
      driver,
      driverLicences:
        driver?.kind === 'driver' ? licencesOf(driver as StoredResource, ctx.lists) : [],
    }),
  );
  if (issues.length > 0 || !powerUnit) return { ok: false, reason: 'invalid', issues };

  const name = input.name?.trim() || null;
  const unit: NewUnit = {
    name,
    powerUnitId: powerUnit.id,
    trailerId: trailer?.id ?? null,
    driverId: driver?.id ?? null,
    period: { start: input.start, end: input.end },
    previousUnitId,
  };
  const conflicts = await conflictsOf(ports, ctx, unit, exceptUnitId);
  return conflicts.length > 0 ? { ok: false, reason: 'overlap', conflicts } : { ok: true, unit };
}

/** The units that share a resource with `unit` over part of its period (rule 4). */
async function conflictsOf(
  ports: Ports,
  ctx: Context,
  unit: NewUnit,
  exceptUnitId?: string,
): Promise<UnitConflict[]> {
  const ids = unitRoles.map((role) => memberId({ ...unit, id: '' }, role));
  const overlapping = await ports.units.listOverlapping(unit.period, exceptUnitId);
  return overlapping.flatMap((other) =>
    unitRoles.flatMap((role): UnitConflict[] => {
      const id = memberId(other, role);
      const resource = id && ids.includes(id) ? find(ctx, id) : null;
      if (!resource) return [];
      const { kind, name } = memberView(resource, ctx.lists);
      return [{ unit: unitRef(ctx, other), resource: { id: resource.id, kind, name } }];
    }),
  );
}

/** Writes, and answers with the conflicts if another unit took a resource in the meantime. */
async function write<T>(
  ports: Ports,
  unit: NewUnit,
  exceptUnitId: string | undefined,
  run: () => Promise<T>,
): Promise<T | Extract<UnitResult, { reason: 'overlap' }>> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof UnitOverlapError)) throw error;
    const conflicts = await conflictsOf(ports, await context(ports), unit, exceptUnitId);
    return { ok: false, reason: 'overlap', conflicts };
  }
}

async function answer(ports: Ports, unit: StoredUnit | undefined): Promise<UnitResult> {
  if (!unit) return { ok: false, reason: 'not-found' };
  return { ok: true, unit: await viewOf(ports, await context(ports), unit) };
}

export async function createUnit(ports: Ports, input: UnitInput): Promise<UnitResult> {
  const prepared = await prepare(ports, input, null);
  if (!prepared.ok) return prepared;
  const written = await write(ports, prepared.unit, undefined, () =>
    ports.units.create(prepared.unit),
  );
  return 'reason' in written ? written : answer(ports, written);
}

const hasStarted = (unit: StoredUnit, now: Temporal.Instant) =>
  Temporal.Instant.compare(unit.period.start, now) <= 0;
const hasEnded = (unit: StoredUnit, now: Temporal.Instant) =>
  unit.period.end !== null && Temporal.Instant.compare(unit.period.end, now) <= 0;

/** Rule 6: a unit that has not started yet can be edited. */
export async function updateUnit(ports: Ports, id: string, input: UnitInput): Promise<UnitResult> {
  const existing = await ports.units.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (hasStarted(existing, ports.clock.now())) return { ok: false, reason: 'started' };
  const prepared = await prepare(ports, input, existing.previousUnitId, id);
  if (!prepared.ok) return prepared;
  const written = await write(ports, prepared.unit, id, () =>
    ports.units.replace(id, prepared.unit),
  );
  return written && 'reason' in written ? written : answer(ports, written);
}

/** Rule 6: a unit that has not started yet can be deleted; it then no longer exists. */
export async function deleteUnit(
  ports: Ports,
  id: string,
): Promise<{ ok: true } | Extract<UnitResult, { reason: 'not-found' | 'started' }>> {
  const existing = await ports.units.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (hasStarted(existing, ports.clock.now())) return { ok: false, reason: 'started' };
  await ports.units.remove(id);
  return { ok: true };
}

/** Rule 6: any unit not yet ended can be given an end. */
export async function endUnit(
  ports: Ports,
  id: string,
  end: Temporal.Instant,
): Promise<UnitResult> {
  const existing = await ports.units.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (hasEnded(existing, ports.clock.now())) return { ok: false, reason: 'ended' };
  const issues = checkUnitPeriod(existing.period.start, end).filter((i) => i.field === 'end');
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  const unit = { ...existing, period: { start: existing.period.start, end } };
  const ctx = await context(ports);
  const conflicts = await conflictsOf(ports, ctx, unit, id);
  if (conflicts.length > 0) return { ok: false, reason: 'overlap', conflicts };
  const written = await write(ports, unit, id, () => ports.units.setEnd(id, end));
  return written && 'reason' in written ? written : answer(ports, written);
}

export type ChangeInput = {
  readonly role: 'driver' | 'trailer';
  /** The new driver or trailer; null leaves the place empty. */
  readonly resourceId: string | null;
  readonly from: Temporal.Instant;
};

/**
 * Rule 6: from a given minute, a running unit gets a new driver or trailer. The unit ends at that
 * minute and a new one starts with the same other members, in one transaction.
 */
export async function changeUnit(
  ports: Ports,
  id: string,
  change: ChangeInput,
): Promise<ChangeResult> {
  const existing = await ports.units.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  const now = ports.clock.now();
  if (!hasStarted(existing, now)) return { ok: false, reason: 'not-started' };
  if (hasEnded(existing, now)) return { ok: false, reason: 'ended' };

  const issues: FieldIssue[] = checkUnitPeriod(change.from, null).map((i) => ({
    ...i,
    field: 'from',
  }));
  if (!contains(existing.period, change.from) || change.from.equals(existing.period.start)) {
    issues.push({ field: 'from', code: 'outside-unit' });
  }
  const current = change.role === 'driver' ? existing.driverId : existing.trailerId;
  if (current === change.resourceId) {
    issues.push({ field: change.role === 'driver' ? 'driverId' : 'trailerId', code: 'unchanged' });
  }
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };

  const prepared = await prepare(
    ports,
    {
      name: existing.name,
      powerUnitId: existing.powerUnitId,
      trailerId: change.role === 'trailer' ? change.resourceId : existing.trailerId,
      driverId: change.role === 'driver' ? change.resourceId : existing.driverId,
      start: change.from,
      end: existing.period.end,
    },
    existing.id,
    existing.id,
  );
  if (!prepared.ok) return prepared;
  const written = await write(ports, prepared.unit, id, () =>
    ports.units.change(id, prepared.unit),
  );
  if ('reason' in written) return written;
  const ctx = await context(ports);
  return {
    ok: true,
    ended: await viewOf(ports, ctx, written.ended),
    unit: unitView(ctx, written.started, written.ended),
  };
}
