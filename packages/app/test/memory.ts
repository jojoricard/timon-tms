import { overlapsOpen, plateKey, type ResourceBooking, Temporal } from '@timon/domain';
import {
  ArchivedReferenceError,
  CustomerCodeTakenError,
  type CustomerInput,
  DocumentTypeTakenError,
  type Geocoder,
  InUseError,
  type NewResource,
  type OrderEvent,
  PlateTakenError,
  type Ports,
  type ReferenceLists,
  SiretTakenError,
  type SiteRecord,
  StaleVersionError,
  type StoredCustomer,
  type StoredDocument,
  type StoredOrder,
  type StoredResource,
  type StoredSite,
  type StoredUnit,
  UnitOverlapError,
} from '../src/index.ts';
import { createFakeGeocoder } from './fake-geocoder.ts';

const type = (
  code: string,
  appliesTo: ('driver' | 'power-unit' | 'trailer')[],
  blocking: boolean,
  warnDays: number,
) => ({
  id: `type-${code}`,
  code,
  name: null,
  appliesTo,
  blocking,
  warnDays,
});

/** The lists of migration 0004, with readable ids. */
export const lists: ReferenceLists = {
  documentTypes: [
    type('licence-c1', ['driver'], true, 60),
    type('licence-c', ['driver'], true, 60),
    type('licence-ce', ['driver'], true, 60),
    type('cpc', ['driver'], true, 90),
    type('driver-card', ['driver'], true, 30),
    type('health-check', ['driver'], false, 30),
    type('roadworthiness', ['power-unit', 'trailer'], true, 30),
    type('tachograph', ['power-unit'], true, 30),
    type('atp', ['power-unit', 'trailer'], true, 60),
  ],
  bodyTypes: ['curtainsider', 'box', 'refrigerated'].map((code) => ({
    id: `body-${code}`,
    code,
    name: null,
  })),
  tradeLabels: [{ id: 'label-pl', code: null, name: 'PL' }],
  capabilities: ['tail-lift', 'crane'].map((code) => ({
    id: `capability-${code}`,
    code,
    name: null,
  })),
  protectiveEquipment: [
    'safety-shoes',
    'high-visibility-vest',
    'hard-hat',
    'safety-glasses',
    'gloves',
  ].map((code) => ({ id: `pe-${code}`, code, name: null })),
};

/**
 * Ports kept in memory, with the database's guarantees: one active resource per plate, one
 * document per type. `now` fixes the clock.
 */
export function memoryPorts(
  now = '2026-10-06T10:00:00Z',
  geocoder: Geocoder = createFakeGeocoder(() => []),
) {
  const resources: StoredResource[] = [];
  const customers: StoredCustomer[] = [];
  const sites: StoredSite[] = [];
  const bookings: ResourceBooking[] = [];
  const units: StoredUnit[] = [];
  const orders: StoredOrder[] = [];
  const events: (OrderEvent & { orderId: string })[] = [];
  const counters = new Map<number, number>();
  let next = 0;
  const id = (prefix: string) => `${prefix}-${++next}`;
  const at = Temporal.Instant.from(now);

  /** ADR-005: a write names the version it read; the database refuses any other. */
  const current = <T extends { version: number }>(record: T | undefined, version: number) => {
    if (record && record.version !== version) throw new StaleVersionError(record.version);
    return record;
  };

  const plateTaken = (candidate: StoredResource) =>
    candidate.kind !== 'driver' &&
    !candidate.archived &&
    resources.some(
      (r) =>
        r.id !== candidate.id &&
        r.kind !== 'driver' &&
        !r.archived &&
        plateKey(r.plate) === plateKey(candidate.plate),
    );

  const build = ({ details, documents }: NewResource): StoredResource => {
    const resourceId = id('resource');
    return {
      ...details,
      id: resourceId,
      subsidiaryId: 'south',
      archived: false,
      version: 1,
      createdAt: at,
      updatedAt: at,
      documents: documents.map((d) => ({ ...d, id: id('document'), resourceId, version: 1 })),
    };
  };
  const replace = (resource: StoredResource) => {
    const index = resources.findIndex((r) => r.id === resource.id);
    resources[index] = resource;
    return resource;
  };
  const allDocuments = () => resources.flatMap((r) => r.documents);
  const withDocuments = (
    resourceId: string,
    change: (docs: StoredDocument[]) => StoredDocument[],
  ) => {
    const resource = resources.find((r) => r.id === resourceId);
    if (resource) replace({ ...resource, documents: change([...resource.documents]) });
  };

  // Customers: a code is never reused, a SIRET is unique among active customers.
  const customerConflict = (candidate: StoredCustomer) => {
    const others = customers.filter((c) => c.id !== candidate.id);
    if (others.some((c) => c.code === candidate.code)) return new CustomerCodeTakenError();
    if (
      candidate.siret &&
      !candidate.archived &&
      others.some((c) => !c.archived && c.siret === candidate.siret)
    ) {
      return new SiretTakenError();
    }
    return undefined;
  };
  const buildCustomer = (input: CustomerInput, existing?: StoredCustomer): StoredCustomer => ({
    ...input,
    id: existing?.id ?? id('customer'),
    archived: existing?.archived ?? false,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    contacts: input.contacts.map((c) => ({ ...c, id: c.id ?? id('contact') })),
  });
  const withCustomerIds = (site: StoredSite): StoredSite => ({
    ...site,
    customerIds: customers.filter((c) => c.siteIds.includes(site.id)).map((c) => c.id),
  });
  const buildSite = (record: SiteRecord, existing?: StoredSite): StoredSite => ({
    ...record,
    id: existing?.id ?? id('site'),
    archived: existing?.archived ?? false,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    customerIds: [],
  });

  // Units: a resource in one unit at a time, as the exclusion constraint of the database.
  const membersOf = (u: StoredUnit) =>
    [u.powerUnitId, u.trailerId, u.driverId].filter((m): m is string => m !== null);
  const assertFree = (unit: StoredUnit, others: StoredUnit[]) => {
    const shared = others.some(
      (o) =>
        o.id !== unit.id &&
        overlapsOpen(o.period, unit.period) &&
        membersOf(o).some((m) => membersOf(unit).includes(m)),
    );
    if (shared) throw new UnitOverlapError();
  };
  const unitIndex = (unitId: string) => units.findIndex((u) => u.id === unitId);

  // Orders: rule 8 of SPEC-004, as the locks of the database.
  const activeUsing = (match: (o: StoredOrder) => boolean) =>
    orders
      .filter((o) => o.status !== 'cancelled' && match(o))
      .map((o) => ({ id: o.id, number: o.number }));
  const assertActive = (order: { customerId: string; stops: readonly { siteId: string }[] }) => {
    if (customers.find((c) => c.id === order.customerId)?.archived) {
      throw new ArchivedReferenceError();
    }
    if (order.stops.some((stop) => sites.find((s) => s.id === stop.siteId)?.archived)) {
      throw new ArchivedReferenceError();
    }
  };
  const record = (orderId: string, list: readonly Omit<OrderEvent, 'id' | 'authorId'>[]) => {
    for (const event of list) {
      events.push({ ...event, id: id('event'), authorId: null, orderId } as OrderEvent & {
        orderId: string;
      });
    }
  };
  const withHistory = (order: StoredOrder): StoredOrder => ({
    ...order,
    historyCount: events.filter((e) => e.orderId === order.id).length,
  });
  const orderIndex = (orderId: string) => orders.findIndex((o) => o.id === orderId);

  const ports: Ports = {
    clock: { now: () => at },
    units: {
      get: async (unitId) => units.find((u) => u.id === unitId),
      listAt: async (instant) =>
        units.filter(
          (u) =>
            Temporal.Instant.compare(u.period.start, instant) <= 0 &&
            (u.period.end === null || Temporal.Instant.compare(instant, u.period.end) < 0),
        ),
      listOverlapping: async (period, exceptId) =>
        units.filter((u) => u.id !== exceptId && overlapsOpen(u.period, period)),
      listByResource: async (resourceId) =>
        units
          .filter((u) => membersOf(u).includes(resourceId))
          .sort((a, b) => Temporal.Instant.compare(b.period.start, a.period.start)),
      create: async (unit) => {
        const created = { ...unit, id: id('unit'), version: 1 };
        assertFree(created, units);
        units.push(created);
        return created;
      },
      replace: async (unitId, version, unit) => {
        const index = unitIndex(unitId);
        if (!current(units[index], version)) return undefined;
        const replaced = { ...unit, id: unitId, version: version + 1 };
        assertFree(replaced, units);
        units[index] = replaced;
        return replaced;
      },
      remove: async (unitId, version) => {
        const index = unitIndex(unitId);
        current(units[index], version);
        if (index >= 0) units.splice(index, 1);
        return index >= 0;
      },
      setEnd: async (unitId, version, end) => {
        const index = unitIndex(unitId);
        const existing = current(units[index], version);
        if (!existing) return undefined;
        const ended = {
          ...existing,
          period: { start: existing.period.start, end },
          version: version + 1,
        };
        assertFree(ended, units);
        units[index] = ended;
        return ended;
      },
      change: async (unitId, version, next) => {
        const index = unitIndex(unitId);
        const existing = current(units[index], version);
        if (!existing) throw new Error(`No unit ${unitId}`);
        const ended = {
          ...existing,
          period: { start: existing.period.start, end: next.period.start },
          version: version + 1,
        };
        const started = { ...next, id: id('unit'), version: 1 };
        const after = units.map((u) => (u.id === unitId ? ended : u));
        assertFree(started, after);
        units[index] = ended;
        units.push(started);
        return { ended, started };
      },
    },
    geocoder,
    orders: {
      list: async ({ statuses, customerId }) =>
        orders
          .filter(
            (o) => statuses.includes(o.status) && (!customerId || o.customerId === customerId),
          )
          .map(withHistory),
      get: async (orderId) => {
        const order = orders.find((o) => o.id === orderId);
        return order ? withHistory(order) : undefined;
      },
      findByReference: async (customerId, reference, exceptId) =>
        activeUsing(
          (o) =>
            o.customerId === customerId && o.customerReference === reference && o.id !== exceptId,
        ),
      create: async (order, year, event) => {
        assertActive(order);
        const sequence = (counters.get(year) ?? 0) + 1;
        counters.set(year, sequence);
        const created: StoredOrder = {
          ...order,
          id: id('order'),
          number: `CMD-${year}-${String(sequence).padStart(6, '0')}`,
          cancelReason: null,
          version: 1,
          createdAt: at,
          updatedAt: at,
          historyCount: 0,
        };
        orders.push(created);
        record(created.id, [event]);
        return withHistory(created);
      },
      createMany: async (list, year) => {
        for (const { order, event } of list) await ports.orders.create(order, year, event);
        return list.length;
      },
      update: async (orderId, version, order, list) => {
        const index = orderIndex(orderId);
        const existing = current(orders[index], version);
        if (!existing) return undefined;
        assertActive(order);
        orders[index] = { ...existing, ...order, version: version + 1, updatedAt: at };
        record(orderId, list);
        return withHistory(orders[index]);
      },
      cancel: async (orderId, version, reason, event) => {
        const index = orderIndex(orderId);
        const existing = current(orders[index], version);
        if (!existing) return undefined;
        orders[index] = {
          ...existing,
          status: 'cancelled',
          cancelReason: reason,
          version: version + 1,
          updatedAt: at,
        };
        record(orderId, [event]);
        return withHistory(orders[index]);
      },
      history: async (orderId) =>
        events
          .filter((e) => e.orderId === orderId)
          .reverse()
          .map(({ orderId: _, ...event }) => event),
    },
    customers: {
      list: async ({ includeArchived }) => customers.filter((c) => includeArchived || !c.archived),
      get: async (customerId) => customers.find((c) => c.id === customerId),
      findByCode: async (code, exceptId) =>
        customers.find((c) => c.code === code && c.id !== exceptId),
      findActiveBySiret: async (siret, exceptId) =>
        customers.find((c) => !c.archived && c.siret === siret && c.id !== exceptId),
      create: async (input) => {
        const created = buildCustomer(input);
        const conflict = customerConflict(created);
        if (conflict) throw conflict;
        customers.push(created);
        return created;
      },
      createMany: async (inputs) => {
        const before = customers.length;
        for (const input of inputs) {
          const created = buildCustomer(input);
          const conflict = customerConflict(created);
          if (conflict) {
            customers.length = before;
            throw conflict;
          }
          customers.push(created);
        }
        return inputs.length;
      },
      update: async (customerId, version, input) => {
        const index = customers.findIndex((c) => c.id === customerId);
        const existing = current(customers[index], version);
        if (!existing) return undefined;
        const updated = buildCustomer(input, existing);
        const conflict = customerConflict(updated);
        if (conflict) throw conflict;
        customers[index] = updated;
        return updated;
      },
      setArchived: async (customerId, version, archived) => {
        const index = customers.findIndex((c) => c.id === customerId);
        const existing = current(customers[index], version);
        if (!existing) return undefined;
        const using = activeUsing((o) => o.customerId === customerId);
        if (archived && using.length > 0) throw new InUseError(using);
        const updated = { ...existing, archived, version: version + 1 };
        const conflict = customerConflict(updated);
        if (conflict) throw conflict;
        customers[index] = updated;
        return updated;
      },
    },
    sites: {
      list: async ({ includeArchived }) =>
        sites.filter((s) => includeArchived || !s.archived).map(withCustomerIds),
      get: async (siteId) => {
        const site = sites.find((s) => s.id === siteId);
        return site ? withCustomerIds(site) : undefined;
      },
      create: async (record) => {
        const created = buildSite(record);
        sites.push(created);
        return withCustomerIds(created);
      },
      createMany: async (records) => {
        for (const record of records) sites.push(buildSite(record));
        return records.length;
      },
      update: async (siteId, version, record) => {
        const index = sites.findIndex((s) => s.id === siteId);
        const existing = current(sites[index], version);
        if (!existing) return undefined;
        sites[index] = buildSite(record, existing);
        return withCustomerIds(sites[index]);
      },
      setArchived: async (siteId, version, archived) => {
        const index = sites.findIndex((s) => s.id === siteId);
        const existing = current(sites[index], version);
        if (!existing) return undefined;
        const using = activeUsing((o) => o.stops.some((s) => s.siteId === siteId));
        if (archived && using.length > 0) throw new InUseError(using);
        sites[index] = { ...existing, archived, version: version + 1 };
        return withCustomerIds(sites[index]);
      },
    },
    referenceLists: { get: async () => lists },
    resources: {
      list: async ({ kind, includeArchived }) =>
        resources.filter((r) => (!kind || r.kind === kind) && (includeArchived || !r.archived)),
      get: async (resourceId) => resources.find((r) => r.id === resourceId),
      findActiveByPlate: async (key, exceptId) =>
        resources.find(
          (r) =>
            r.kind !== 'driver' && !r.archived && r.id !== exceptId && plateKey(r.plate) === key,
        ),
      findDriverByEmployeeNumber: async (employeeNumber, exceptId) =>
        resources.find(
          (r) =>
            r.kind === 'driver' &&
            r.id !== exceptId &&
            r.employeeNumber?.toLowerCase() === employeeNumber.toLowerCase(),
        ),
      create: async (input) => {
        const created = build(input);
        if (plateTaken(created)) throw new PlateTakenError();
        resources.push(created);
        return created;
      },
      createMany: async (inputs) => {
        const created = inputs.map(build);
        const before = resources.length;
        for (const resource of created) {
          resources.push(resource);
          if (plateTaken(resource)) {
            resources.length = before;
            throw new PlateTakenError();
          }
        }
        return created.length;
      },
      update: async (resourceId, version, details) => {
        const existing = current(
          resources.find((r) => r.id === resourceId),
          version,
        );
        if (!existing) return undefined;
        const updated = { ...existing, ...details, version: version + 1 } as StoredResource;
        if (plateTaken(updated)) throw new PlateTakenError();
        return replace(updated);
      },
      setArchived: async (resourceId, version, archived) => {
        const existing = current(
          resources.find((r) => r.id === resourceId),
          version,
        );
        if (!existing) return undefined;
        const updated = { ...existing, archived, version: version + 1 };
        if (plateTaken(updated)) throw new PlateTakenError();
        return replace(updated);
      },
    },
    documents: {
      get: async (documentId) => allDocuments().find((d) => d.id === documentId),
      add: async (resourceId, input) => {
        const resource = resources.find((r) => r.id === resourceId);
        if (resource?.documents.some((d) => d.documentTypeId === input.documentTypeId)) {
          throw new DocumentTypeTakenError();
        }
        const created = { ...input, id: id('document'), resourceId, version: 1 };
        withDocuments(resourceId, (docs) => [...docs, created]);
        return created;
      },
      update: async (documentId, version, input) => {
        const existing = current(
          allDocuments().find((d) => d.id === documentId),
          version,
        );
        if (!existing) return undefined;
        const updated = { ...existing, ...input, version: version + 1 };
        withDocuments(existing.resourceId, (docs) =>
          docs.map((d) => (d.id === documentId ? updated : d)),
        );
        return updated;
      },
      remove: async (documentId, version) => {
        const existing = current(
          allDocuments().find((d) => d.id === documentId),
          version,
        );
        if (!existing) return false;
        withDocuments(existing.resourceId, (docs) => docs.filter((d) => d.id !== documentId));
        return true;
      },
    },
    bookings: {
      listByResource: async (resourceId) => bookings.filter((b) => b.resourceId === resourceId),
      listOverlapping: async () => [],
      insert: async (booking) => {
        const created = { ...booking, id: id('booking') };
        bookings.push(created);
        return created;
      },
    },
  };
  return { ports, resources, bookings, customers, sites, units, orders };
}
