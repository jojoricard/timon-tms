import type {
  CustomerInput,
  CustomerRepository,
  SiteRecord,
  SiteRepository,
  StoredContact,
  StoredCustomer,
  StoredSite,
} from '@timon/app';
import { type LocatedBy, Temporal, type Weekday } from '@timon/domain';
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { translateErrors } from './errors.ts';
import {
  contact,
  customer,
  customerSite,
  site,
  siteOpening,
  siteProtectiveEquipment,
} from './schema.ts';

/** The company created by migration 0004; customers and sites belong to it (SPEC-002). */
export const defaultCompanyId = '10000000-0000-4000-8000-000000000001';

const instant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());

type CustomerRow = typeof customer.$inferSelect;
type SiteRow = typeof site.$inferSelect;

function customerValues(input: CustomerInput) {
  return {
    code: input.code,
    name: input.name,
    country: input.country,
    siret: input.siret,
    vatNumber: input.vatNumber,
    billingStreet1: input.billingStreet1,
    billingStreet2: input.billingStreet2,
    billingPostcode: input.billingPostcode,
    billingCity: input.billingCity,
    notes: input.notes,
  };
}

export function customerRepository(db: Database): CustomerRepository {
  async function load(rows: CustomerRow[]): Promise<StoredCustomer[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [contacts, links] = await Promise.all([
      db
        .select()
        .from(contact)
        .where(inArray(contact.customerId, ids))
        .orderBy(asc(contact.sortOrder)),
      db.select().from(customerSite).where(inArray(customerSite.customerId, ids)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      country: row.country,
      siret: row.siret,
      vatNumber: row.vatNumber,
      billingStreet1: row.billingStreet1,
      billingStreet2: row.billingStreet2,
      billingPostcode: row.billingPostcode,
      billingCity: row.billingCity,
      notes: row.notes,
      archived: row.archivedAt !== null,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      contacts: contacts
        .filter((c) => c.customerId === row.id)
        .map(
          ({ id, name, role, phone, email }): StoredContact => ({ id, name, role, phone, email }),
        ),
      siteIds: links.filter((l) => l.customerId === row.id).map((l) => l.siteId),
    }));
  }

  const select = async (...conditions: Parameters<typeof and>) =>
    load(
      await db
        .select()
        .from(customer)
        .where(and(...conditions)),
    );

  async function get(id: string) {
    return (await select(eq(customer.id, id)))[0];
  }

  /**
   * Contacts keep their id when they stay; those left out are deleted for good (rule 3).
   * Usual sites are replaced as a whole.
   */
  async function writeChildren(
    tx: Database,
    customerId: string,
    input: CustomerInput,
    fresh = false,
  ) {
    const kept = input.contacts.flatMap((c) => (c.id ? [c.id] : []));
    if (!fresh)
      await tx
        .delete(contact)
        .where(
          and(
            eq(contact.customerId, customerId),
            kept.length > 0 ? notInArray(contact.id, kept) : undefined,
          ),
        );
    for (const [sortOrder, c] of input.contacts.entries()) {
      const values = { name: c.name, role: c.role, phone: c.phone, email: c.email, sortOrder };
      const updated =
        c.id && !fresh
          ? await tx
              .update(contact)
              .set(values)
              .where(and(eq(contact.id, c.id), eq(contact.customerId, customerId)))
              .returning({ id: contact.id })
          : [];
      if (updated.length === 0) await tx.insert(contact).values({ ...values, customerId });
    }
    if (!fresh) await tx.delete(customerSite).where(eq(customerSite.customerId, customerId));
    if (input.siteIds.length > 0) {
      await tx.insert(customerSite).values(input.siteIds.map((siteId) => ({ customerId, siteId })));
    }
  }

  async function insert(tx: Database, input: CustomerInput) {
    const [row] = await tx
      .insert(customer)
      .values({ ...customerValues(input), companyId: defaultCompanyId })
      .returning({ id: customer.id });
    if (!row) throw new Error('Insert returned no row');
    await writeChildren(tx, row.id, input, true);
    return row.id;
  }

  return {
    list: async ({ includeArchived }) =>
      load(
        await db
          .select()
          .from(customer)
          .where(includeArchived ? undefined : isNull(customer.archivedAt))
          .orderBy(asc(customer.code)),
      ),
    get,
    findByCode: async (code, exceptId) =>
      (await select(eq(customer.code, code), exceptId ? ne(customer.id, exceptId) : undefined))[0],
    findActiveBySiret: async (siret, exceptId) =>
      (
        await select(
          eq(customer.siret, siret),
          isNull(customer.archivedAt),
          exceptId ? ne(customer.id, exceptId) : undefined,
        )
      )[0],
    create: async (input) => {
      const id = await translateErrors(() => db.transaction((tx) => insert(tx, input)));
      const created = await get(id);
      if (!created) throw new Error(`Customer ${id} vanished`);
      return created;
    },
    createMany: (inputs) =>
      translateErrors(() =>
        db.transaction(async (tx) => {
          for (const input of inputs) await insert(tx, input);
          return inputs.length;
        }),
      ),
    update: async (id, input) => {
      const updated = await translateErrors(() =>
        db.transaction(async (tx) => {
          const rows = await tx
            .update(customer)
            .set({ ...customerValues(input), updatedAt: sql`now()` })
            .where(eq(customer.id, id))
            .returning({ id: customer.id });
          if (rows.length === 0) return false;
          await writeChildren(tx, id, input);
          return true;
        }),
      );
      return updated ? get(id) : undefined;
    },
    setArchived: async (id, archived) => {
      const rows = await translateErrors(() =>
        db
          .update(customer)
          .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
          .where(eq(customer.id, id))
          .returning({ id: customer.id }),
      );
      return rows.length > 0 ? get(id) : undefined;
    },
  };
}

function siteValues(record: SiteRecord) {
  return {
    name: record.name,
    street1: record.street1,
    street2: record.street2,
    postcode: record.postcode,
    city: record.city,
    country: record.country,
    latitude: record.location?.latitude ?? null,
    longitude: record.location?.longitude ?? null,
    locatedBy: record.locatedBy,
    timeZone: record.timeZone,
    bookingRequired: record.bookingRequired,
    bookingMethod: record.bookingMethod,
    bookingDetail: record.bookingDetail,
    maxLengthCm: record.maxLengthCm,
    maxWeightKg: record.maxWeightKg,
    loadingDock: record.loadingDock,
    semiTrailersAccepted: record.semiTrailersAccepted,
    gatePhone: record.gatePhone,
    instructions: record.instructions,
  };
}

export function siteRepository(db: Database): SiteRepository {
  async function load(rows: SiteRow[]): Promise<StoredSite[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [openings, equipment, links] = await Promise.all([
      db.select().from(siteOpening).where(inArray(siteOpening.siteId, ids)),
      db.select().from(siteProtectiveEquipment).where(inArray(siteProtectiveEquipment.siteId, ids)),
      db.select().from(customerSite).where(inArray(customerSite.siteId, ids)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      street1: row.street1,
      street2: row.street2,
      postcode: row.postcode,
      city: row.city,
      country: row.country,
      location:
        row.latitude === null || row.longitude === null
          ? null
          : { latitude: row.latitude, longitude: row.longitude },
      locatedBy: row.locatedBy as LocatedBy,
      timeZone: row.timeZone,
      openings: openings
        .filter((o) => o.siteId === row.id)
        .map((o) => ({
          weekday: o.weekday as Weekday,
          startMinute: o.startMinute,
          endMinute: o.endMinute,
        }))
        .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
      bookingRequired: row.bookingRequired,
      bookingMethod: row.bookingMethod,
      bookingDetail: row.bookingDetail,
      protectiveEquipmentIds: equipment
        .filter((e) => e.siteId === row.id)
        .map((e) => e.protectiveEquipmentId),
      maxLengthCm: row.maxLengthCm,
      maxWeightKg: row.maxWeightKg,
      loadingDock: row.loadingDock,
      semiTrailersAccepted: row.semiTrailersAccepted,
      gatePhone: row.gatePhone,
      instructions: row.instructions,
      archived: row.archivedAt !== null,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      customerIds: links.filter((l) => l.siteId === row.id).map((l) => l.customerId),
    }));
  }

  async function get(id: string) {
    return (await load(await db.select().from(site).where(eq(site.id, id))))[0];
  }

  /** Opening ranges and protective equipment, replaced as a whole. */
  async function writeChildren(tx: Database, siteId: string, record: SiteRecord, fresh = false) {
    if (!fresh) {
      await tx.delete(siteOpening).where(eq(siteOpening.siteId, siteId));
      await tx.delete(siteProtectiveEquipment).where(eq(siteProtectiveEquipment.siteId, siteId));
    }
    if (record.openings.length > 0) {
      await tx.insert(siteOpening).values(record.openings.map((o) => ({ ...o, siteId })));
    }
    if (record.protectiveEquipmentIds.length > 0) {
      await tx.insert(siteProtectiveEquipment).values(
        record.protectiveEquipmentIds.map((protectiveEquipmentId) => ({
          siteId,
          protectiveEquipmentId,
        })),
      );
    }
  }

  async function insert(tx: Database, record: SiteRecord) {
    const [row] = await tx
      .insert(site)
      .values({ ...siteValues(record), companyId: defaultCompanyId })
      .returning({ id: site.id });
    if (!row) throw new Error('Insert returned no row');
    await writeChildren(tx, row.id, record, true);
    return row.id;
  }

  return {
    list: async ({ includeArchived }) =>
      load(
        await db
          .select()
          .from(site)
          .where(includeArchived ? undefined : isNull(site.archivedAt))
          .orderBy(asc(site.name)),
      ),
    get,
    create: async (record) => {
      const id = await translateErrors(() => db.transaction((tx) => insert(tx, record)));
      const created = await get(id);
      if (!created) throw new Error(`Site ${id} vanished`);
      return created;
    },
    createMany: (records) =>
      translateErrors(() =>
        db.transaction(async (tx) => {
          for (const record of records) await insert(tx, record);
          return records.length;
        }),
      ),
    update: async (id, record) => {
      const updated = await translateErrors(() =>
        db.transaction(async (tx) => {
          const rows = await tx
            .update(site)
            .set({ ...siteValues(record), updatedAt: sql`now()` })
            .where(eq(site.id, id))
            .returning({ id: site.id });
          if (rows.length === 0) return false;
          await writeChildren(tx, id, record);
          return true;
        }),
      );
      return updated ? get(id) : undefined;
    },
    setArchived: async (id, archived) => {
      const rows = await db
        .update(site)
        .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(site.id, id))
        .returning({ id: site.id });
      return rows.length > 0 ? get(id) : undefined;
    },
  };
}
