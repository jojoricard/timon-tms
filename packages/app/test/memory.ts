import { plateKey, type ResourceBooking, Temporal } from '@timon/domain';
import {
  DocumentTypeTakenError,
  type NewResource,
  PlateTakenError,
  type Ports,
  type ReferenceLists,
  type StoredDocument,
  type StoredResource,
} from '../src/index.ts';

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
};

/**
 * Ports kept in memory, with the database's guarantees: one active resource per plate, one
 * document per type. `now` fixes the clock.
 */
export function memoryPorts(now = '2026-10-06T10:00:00Z') {
  const resources: StoredResource[] = [];
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

  const ports: Ports = {
    clock: { now: () => at },
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
  return { ports, resources, bookings };
}
