import {
  BookingOverlapError,
  type BookingRepository,
  type Clock,
  type DocumentRepository,
  DocumentTypeTakenError,
  type ListItem,
  type NewDocument,
  type NewResource,
  PlateTakenError,
  type Ports,
  type ReferenceListRepository,
  type ResourceRepository,
  type StoredDocument,
  type StoredResource,
} from '@timon/app';
import {
  type Period,
  plateKey,
  type ResourceBooking,
  type ResourceDetails,
  Temporal,
} from '@timon/domain';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import {
  bodyType,
  capability,
  document,
  documentType,
  resource,
  resourceBooking,
  resourceCapability,
  tradeLabel,
} from './schema.ts';
import { formatRange } from './tstzrange.ts';

/** The single subsidiary created by migration 0004, until subsidiaries have screens (#14). */
export const defaultSubsidiaryId = '10000000-0000-4000-8000-000000000002';

const systemClock: Clock = { now: () => Temporal.Now.instant() };

export function createRepositories(db: Database, clock: Clock = systemClock): Ports {
  return {
    resources: resourceRepository(db),
    documents: documentRepository(db),
    referenceLists: referenceListRepository(db),
    bookings: bookingRepository(db),
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

const capabilityIdsOf = (details: ResourceDetails) =>
  details.kind === 'driver' ? [] : details.capabilityIds;

function resourceRepository(db: Database): ResourceRepository {
  async function load(rows: ResourceRow[]): Promise<StoredResource[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [documents, capabilities] = await Promise.all([
      db.select().from(document).where(inArray(document.resourceId, ids)),
      db.select().from(resourceCapability).where(inArray(resourceCapability.resourceId, ids)),
    ]);
    return rows.map((row) =>
      toResource(
        row,
        capabilities.filter((c) => c.resourceId === row.id).map((c) => c.capabilityId),
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
    const capabilityIds = capabilityIdsOf(details);
    if (capabilityIds.length > 0) {
      await tx
        .insert(resourceCapability)
        .values(capabilityIds.map((capabilityId) => ({ resourceId: row.id, capabilityId })));
    }
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
          await tx.delete(resourceCapability).where(eq(resourceCapability.resourceId, id));
          const capabilityIds = capabilityIdsOf(details);
          if (capabilityIds.length > 0) {
            await tx
              .insert(resourceCapability)
              .values(capabilityIds.map((capabilityId) => ({ resourceId: id, capabilityId })));
          }
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
  const listOf = async (table: typeof bodyType | typeof tradeLabel | typeof capability) => {
    const rows = await db.select().from(table).orderBy(asc(table.sortOrder), asc(table.name));
    return rows.map(({ id, code, name }): ListItem => ({ id, code, name }));
  };
  return {
    get: async () => {
      const [types, bodyTypes, tradeLabels, capabilities] = await Promise.all([
        db.select().from(documentType).orderBy(asc(documentType.sortOrder), asc(documentType.name)),
        listOf(bodyType),
        listOf(tradeLabel),
        listOf(capability),
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

// The database is the last word on these rules: its violations become the errors of the ports.
const violations: Record<string, () => Error> = {
  resource_booking_no_overlap: () => new BookingOverlapError('Overlapping booking'),
  resource_active_plate: () => new PlateTakenError('Plate used by another active resource'),
  document_resource_type: () => new DocumentTypeTakenError('Document type already recorded'),
};

async function translateErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const constraint = violatedConstraint(error);
    const translated = constraint ? violations[constraint]?.() : undefined;
    if (translated) throw Object.assign(translated, { cause: error });
    throw error;
  }
}

// node-postgres and PGlite both expose the SQLSTATE as `code` and the constraint name;
// Drizzle may wrap the error in `cause`.
function violatedConstraint(error: unknown): string | undefined {
  for (let e = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === '23P01' || code === '23505') {
      return typeof constraint === 'string' ? constraint : undefined;
    }
  }
  return undefined;
}
