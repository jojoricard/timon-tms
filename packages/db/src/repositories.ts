import type {
  BookingRepository,
  Clock,
  DocumentRepository,
  ListItem,
  NewDocument,
  NewResource,
  Ports,
  ReferenceListRepository,
  ResourceRepository,
  StoredDocument,
  StoredResource,
} from '@timon/app';
import {
  type Period,
  plateKey,
  type ResourceBooking,
  type ResourceDetails,
  Temporal,
} from '@timon/domain';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { customerRepository, siteRepository } from './customer-repositories.ts';
import type { Database } from './database.ts';
import { translateErrors } from './errors.ts';
import {
  bodyType,
  capability,
  document,
  documentType,
  protectiveEquipment,
  resource,
  resourceBooking,
  resourceCapability,
  resourceProtectiveEquipment,
  tradeLabel,
} from './schema.ts';
import { formatRange } from './tstzrange.ts';

/** The single subsidiary created by migration 0004, until subsidiaries have screens (#14). */
export const defaultSubsidiaryId = '10000000-0000-4000-8000-000000000002';

const systemClock: Clock = { now: () => Temporal.Now.instant() };

/** Every port the database serves; the geocoder is added by the entry point. */
export type Repositories = Omit<Ports, 'geocoder'>;

export function createRepositories(db: Database, clock: Clock = systemClock): Repositories {
  return {
    resources: resourceRepository(db),
    documents: documentRepository(db),
    referenceLists: referenceListRepository(db),
    bookings: bookingRepository(db),
    customers: customerRepository(db),
    sites: siteRepository(db),
    clock,
  };
}

type ResourceRow = typeof resource.$inferSelect;
type DocumentRow = typeof document.$inferSelect;

function toDocument(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    resourceId: row.resourceId,
    documentTypeId: row.documentTypeId,
    reference: row.reference,
    issuedOn: row.issuedOn ? Temporal.PlainDate.from(row.issuedOn) : null,
    expiresOn: Temporal.PlainDate.from(row.expiresOn),
  };
}

function documentValues(resourceId: string, input: NewDocument) {
  return {
    resourceId,
    documentTypeId: input.documentTypeId,
    reference: input.reference,
    issuedOn: input.issuedOn?.toString() ?? null,
    expiresOn: input.expiresOn.toString(),
  };
}

function toResource(
  row: ResourceRow,
  capabilityIds: readonly string[],
  protectiveEquipmentIds: readonly string[],
  documents: readonly StoredDocument[],
): StoredResource {
  const common = {
    id: row.id,
    archived: row.archivedAt !== null,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
    updatedAt: Temporal.Instant.fromEpochMilliseconds(row.updatedAt.getTime()),
    documents,
  };
  if (row.kind === 'driver') {
    return {
      ...common,
      kind: 'driver',
      lastName: row.lastName ?? '',
      firstName: row.firstName ?? '',
      displayName: row.displayName ?? '',
      employeeNumber: row.employeeNumber,
      phone: row.phone,
      protectiveEquipmentIds,
    };
  }
  if (!row.plate || !row.vehicleKind || !row.category || row.gvwKg === null) {
    throw new Error(`Vehicle ${row.id} is incomplete`);
  }
  return {
    ...common,
    kind: row.kind,
    plate: row.plate,
    vehicleKind: row.vehicleKind,
    category: row.category,
    gvwKg: row.gvwKg,
    gcwKg: row.gcwKg,
    makeModel: row.makeModel,
    bodyTypeId: row.bodyTypeId,
    tradeLabelId: row.tradeLabelId,
    capabilityIds,
  };
}

/** Column values of a resource; every column is set so that an update clears what is gone. */
function resourceValues(details: ResourceDetails) {
  const none = {
    lastName: null,
    firstName: null,
    displayName: null,
    employeeNumber: null,
    phone: null,
    plate: null,
    plateKey: null,
    vehicleKind: null,
    category: null,
    gvwKg: null,
    gcwKg: null,
    makeModel: null,
    bodyTypeId: null,
    tradeLabelId: null,
  };
  if (details.kind === 'driver') {
    const { lastName, firstName, displayName, employeeNumber, phone } = details;
    return { ...none, kind: details.kind, lastName, firstName, displayName, employeeNumber, phone };
  }
  const { plate, vehicleKind, category, gvwKg, gcwKg, makeModel, bodyTypeId, tradeLabelId } =
    details;
  return {
    ...none,
    kind: details.kind,
    plate,
    plateKey: plateKey(plate),
    vehicleKind,
    category,
    gvwKg,
    gcwKg,
    makeModel,
    bodyTypeId,
    tradeLabelId,
  };
}

/** Capabilities of a vehicle and protective equipment of a driver, replaced as a whole. */
async function replaceLinks(tx: Database, resourceId: string, details: ResourceDetails) {
  await tx.delete(resourceCapability).where(eq(resourceCapability.resourceId, resourceId));
  await tx
    .delete(resourceProtectiveEquipment)
    .where(eq(resourceProtectiveEquipment.resourceId, resourceId));
  if (details.kind === 'driver') {
    if (details.protectiveEquipmentIds.length > 0) {
      await tx.insert(resourceProtectiveEquipment).values(
        details.protectiveEquipmentIds.map((protectiveEquipmentId) => ({
          resourceId,
          protectiveEquipmentId,
        })),
      );
    }
  } else if (details.capabilityIds.length > 0) {
    await tx
      .insert(resourceCapability)
      .values(details.capabilityIds.map((capabilityId) => ({ resourceId, capabilityId })));
  }
}

function resourceRepository(db: Database): ResourceRepository {
  async function load(rows: ResourceRow[]): Promise<StoredResource[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [documents, capabilities, equipment] = await Promise.all([
      db.select().from(document).where(inArray(document.resourceId, ids)),
      db.select().from(resourceCapability).where(inArray(resourceCapability.resourceId, ids)),
      db
        .select()
        .from(resourceProtectiveEquipment)
        .where(inArray(resourceProtectiveEquipment.resourceId, ids)),
    ]);
    return rows.map((row) =>
      toResource(
        row,
        capabilities.filter((c) => c.resourceId === row.id).map((c) => c.capabilityId),
        equipment.filter((e) => e.resourceId === row.id).map((e) => e.protectiveEquipmentId),
        documents.filter((d) => d.resourceId === row.id).map(toDocument),
      ),
    );
  }

  async function get(id: string) {
    const rows = await db.select().from(resource).where(eq(resource.id, id));
    return (await load(rows))[0];
  }

  async function insert(tx: Database, { details, documents }: NewResource) {
    const [row] = await tx
      .insert(resource)
      .values({ ...resourceValues(details), subsidiaryId: defaultSubsidiaryId })
      .returning({ id: resource.id });
    if (!row) throw new Error('Insert returned no row');
    await replaceLinks(tx, row.id, details);
    if (documents.length > 0) {
      await tx.insert(document).values(documents.map((d) => documentValues(row.id, d)));
    }
    return row.id;
  }

  return {
    list: async ({ kind, includeArchived }) => {
      const rows = await db
        .select()
        .from(resource)
        .where(
          and(
            kind ? eq(resource.kind, kind) : undefined,
            includeArchived ? undefined : isNull(resource.archivedAt),
          ),
        )
        .orderBy(asc(resource.lastName), asc(resource.firstName), asc(resource.plateKey));
      return load(rows);
    },
    get,
    findActiveByPlate: async (key, exceptId) => {
      const rows = await db
        .select()
        .from(resource)
        .where(
          and(
            eq(resource.plateKey, key),
            isNull(resource.archivedAt),
            exceptId ? ne(resource.id, exceptId) : undefined,
          ),
        );
      return (await load(rows))[0];
    },
    create: async (input) => {
      const id = await translateErrors(() => db.transaction((tx) => insert(tx, input)));
      const created = await get(id);
      if (!created) throw new Error(`Resource ${id} vanished`);
      return created;
    },
    createMany: (inputs) =>
      translateErrors(() =>
        db.transaction(async (tx) => {
          for (const input of inputs) await insert(tx, input);
          return inputs.length;
        }),
      ),
    update: async (id, details) => {
      const updated = await translateErrors(() =>
        db.transaction(async (tx) => {
          const rows = await tx
            .update(resource)
            .set({ ...resourceValues(details), updatedAt: sql`now()` })
            .where(and(eq(resource.id, id), eq(resource.kind, details.kind)))
            .returning({ id: resource.id });
          if (rows.length === 0) return false;
          await replaceLinks(tx, id, details);
          return true;
        }),
      );
      return updated ? get(id) : undefined;
    },
    setArchived: async (id, archived) => {
      const rows = await translateErrors(() =>
        db
          .update(resource)
          .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
          .where(eq(resource.id, id))
          .returning({ id: resource.id }),
      );
      return rows.length > 0 ? get(id) : undefined;
    },
  };
}

function documentRepository(db: Database): DocumentRepository {
  const get = async (id: string) => {
    const [row] = await db.select().from(document).where(eq(document.id, id));
    return row ? toDocument(row) : undefined;
  };
  return {
    get,
    add: async (resourceId, input) => {
      const [row] = await translateErrors(() =>
        db.insert(document).values(documentValues(resourceId, input)).returning(),
      );
      if (!row) throw new Error('Insert returned no row');
      return toDocument(row);
    },
    update: async (id, input) => {
      const existing = await get(id);
      if (!existing) return undefined;
      const [row] = await translateErrors(() =>
        db
          .update(document)
          .set(documentValues(existing.resourceId, input))
          .where(eq(document.id, id))
          .returning(),
      );
      return row ? toDocument(row) : undefined;
    },
    remove: async (id) => {
      const rows = await db.delete(document).where(eq(document.id, id)).returning();
      return rows.length > 0;
    },
  };
}

function referenceListRepository(db: Database): ReferenceListRepository {
  const listOf = async (
    table: typeof bodyType | typeof tradeLabel | typeof capability | typeof protectiveEquipment,
  ) => {
    const rows = await db.select().from(table).orderBy(asc(table.sortOrder), asc(table.name));
    return rows.map(({ id, code, name }): ListItem => ({ id, code, name }));
  };
  return {
    get: async () => {
      const [types, bodyTypes, tradeLabels, capabilities, protectiveEquipmentList] =
        await Promise.all([
          db
            .select()
            .from(documentType)
            .orderBy(asc(documentType.sortOrder), asc(documentType.name)),
          listOf(bodyType),
          listOf(tradeLabel),
          listOf(capability),
          listOf(protectiveEquipment),
        ]);
      return {
        documentTypes: types.map(({ id, code, name, appliesTo, blocking, warnDays }) => ({
          id,
          code,
          name,
          appliesTo,
          blocking,
          warnDays,
        })),
        bodyTypes,
        tradeLabels,
        capabilities,
        protectiveEquipment: protectiveEquipmentList,
      };
    },
  };
}

function bookingRepository(db: Database): BookingRepository {
  const byStart = sql`lower(${resourceBooking.period})`;
  return {
    listByResource: (resourceId) =>
      db
        .select()
        .from(resourceBooking)
        .where(eq(resourceBooking.resourceId, resourceId))
        .orderBy(byStart),
    listOverlapping: (resourceId: string, period: Period) =>
      db
        .select()
        .from(resourceBooking)
        .where(
          and(
            eq(resourceBooking.resourceId, resourceId),
            sql`${resourceBooking.period} && ${formatRange(period)}::tstzrange`,
          ),
        )
        .orderBy(byStart),
    insert: async (booking): Promise<ResourceBooking> => {
      const [created] = await translateErrors(() =>
        db.insert(resourceBooking).values(booking).returning(),
      );
      if (!created) throw new Error('Insert returned no row');
      return created;
    },
  };
}
