import { plateKey, type ResourceBooking, Temporal } from '@timon/domain';
import {
  CustomerCodeTakenError,
  type CustomerInput,
  DocumentTypeTakenError,
  type Geocoder,
  type NewResource,
  PlateTakenError,
  type Ports,
  type ReferenceLists,
  SiretTakenError,
  type SiteRecord,
  type StoredCustomer,
  type StoredDocument,
  type StoredResource,
  type StoredSite,
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
  let next = 0;
  const id = (prefix: string) => `${prefix}-${++next}`;
  const at = Temporal.Instant.from(now);

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
      archived: false,
      createdAt: at,
      updatedAt: at,
      documents: documents.map((d) => ({ ...d, id: id('document'), resourceId })),
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
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    customerIds: [],
  });

  const ports: Ports = {
    clock: { now: () => at },
    geocoder,
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
      update: async (customerId, input) => {
        const index = customers.findIndex((c) => c.id === customerId);
        const existing = customers[index];
        if (!existing) return undefined;
        const updated = buildCustomer(input, existing);
        const conflict = customerConflict(updated);
        if (conflict) throw conflict;
        customers[index] = updated;
        return updated;
      },
      setArchived: async (customerId, archived) => {
        const index = customers.findIndex((c) => c.id === customerId);
        const existing = customers[index];
        if (!existing) return undefined;
        const updated = { ...existing, archived };
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
      update: async (siteId, record) => {
        const index = sites.findIndex((s) => s.id === siteId);
        const existing = sites[index];
        if (!existing) return undefined;
        sites[index] = buildSite(record, existing);
        return withCustomerIds(sites[index]);
      },
      setArchived: async (siteId, archived) => {
        const index = sites.findIndex((s) => s.id === siteId);
        const existing = sites[index];
        if (!existing) return undefined;
        sites[index] = { ...existing, archived };
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
      update: async (resourceId, details) => {
        const existing = resources.find((r) => r.id === resourceId);
        if (!existing) return undefined;
        const updated = { ...existing, ...details } as StoredResource;
        if (plateTaken(updated)) throw new PlateTakenError();
        return replace(updated);
      },
      setArchived: async (resourceId, archived) => {
        const existing = resources.find((r) => r.id === resourceId);
        if (!existing) return undefined;
        const updated = { ...existing, archived };
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
        const created = { ...input, id: id('document'), resourceId };
        withDocuments(resourceId, (docs) => [...docs, created]);
        return created;
      },
      update: async (documentId, input) => {
        const existing = allDocuments().find((d) => d.id === documentId);
        if (!existing) return undefined;
        const updated = { ...existing, ...input };
        withDocuments(existing.resourceId, (docs) =>
          docs.map((d) => (d.id === documentId ? updated : d)),
        );
        return updated;
      },
      remove: async (documentId) => {
        const existing = allDocuments().find((d) => d.id === documentId);
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
  return { ports, resources, bookings, customers, sites };
}
