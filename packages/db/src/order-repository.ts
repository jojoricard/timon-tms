import {
  ArchivedReferenceError,
  InUseError,
  type NewOrderEvent,
  type OrderEvent,
  type OrderRecord,
  type OrderRef,
  type OrderRepository,
  type StoredOrder,
} from '@timon/app';
import { Temporal } from '@timon/domain';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { defaultCompanyId } from './customer-repositories.ts';
import type { Database } from './database.ts';
import { translateErrors } from './errors.ts';
import {
  customer,
  orderCounter,
  orderEvent,
  orderGoods,
  orderStop,
  site,
  transportOrder,
} from './schema.ts';
import { atVersion, missingOrStale, nextVersion } from './versions.ts';

const instant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());

type OrderRow = typeof transportOrder.$inferSelect;

const active = sql`${transportOrder.status} <> 'cancelled'`;

/**
 * SPEC-004 rule 8, the side of the order: the customer and the sites are read FOR SHARE, so that
 * an archiving that started first is waited for and seen, and one that starts later waits for
 * this transaction and then sees the order.
 */
async function lockActive(tx: Database, orders: readonly OrderRecord[]) {
  const customerIds = [...new Set(orders.map((o) => o.customerId))].sort();
  const owners = await tx
    .select({ archivedAt: customer.archivedAt })
    .from(customer)
    .where(inArray(customer.id, customerIds))
    .orderBy(asc(customer.id))
    .for('share');
  if (owners.some((o) => o.archivedAt)) throw new ArchivedReferenceError('A customer is archived');
  const siteIds = [...new Set(orders.flatMap((o) => o.stops.map((s) => s.siteId)))].sort();
  if (siteIds.length === 0) return;
  const sites = await tx
    .select({ archivedAt: site.archivedAt })
    .from(site)
    .where(inArray(site.id, siteIds))
    .orderBy(asc(site.id))
    .for('share');
  if (sites.some((s) => s.archivedAt)) throw new ArchivedReferenceError('A site is archived');
}

/**
 * SPEC-004 rule 8, the side of the customer or the site: the row is locked FOR UPDATE before the
 * orders are read, so that an order being written with it is waited for and counted.
 */
export async function assertUnused(
  tx: Database,
  using: { customerId: string } | { siteId: string },
) {
  let orders: OrderRef[];
  if ('customerId' in using) {
    await tx
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, using.customerId))
      .for('update');
    orders = await tx
      .select({ id: transportOrder.id, number: transportOrder.number })
      .from(transportOrder)
      .where(and(eq(transportOrder.customerId, using.customerId), active))
      .orderBy(asc(transportOrder.number));
  } else {
    await tx.select({ id: site.id }).from(site).where(eq(site.id, using.siteId)).for('update');
    orders = await tx
      .selectDistinct({ id: transportOrder.id, number: transportOrder.number })
      .from(transportOrder)
      .innerJoin(orderStop, eq(orderStop.orderId, transportOrder.id))
      .where(and(eq(orderStop.siteId, using.siteId), active))
      .orderBy(asc(transportOrder.number));
  }
  if (orders.length > 0) throw new InUseError(orders);
}

function headerValues(order: OrderRecord) {
  return {
    customerId: order.customerId,
    customerReference: order.customerReference,
    notes: order.notes,
    bodyTypeId: order.bodyTypeId,
    sideLoading: order.sideLoading,
    tailLift: order.tailLift,
    status: order.status,
  };
}

const formatNumber = (year: number, sequence: number) =>
  `CMD-${year}-${String(sequence).padStart(6, '0')}`;

export function orderRepository(db: Database): OrderRepository {
  async function load(rows: OrderRow[]): Promise<StoredOrder[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [stops, goods, events] = await Promise.all([
      db
        .select()
        .from(orderStop)
        .where(inArray(orderStop.orderId, ids))
        .orderBy(asc(orderStop.sortOrder)),
      db
        .select()
        .from(orderGoods)
        .where(inArray(orderGoods.orderId, ids))
        .orderBy(asc(orderGoods.sortOrder)),
      db
        .select({ orderId: orderEvent.orderId, n: count() })
        .from(orderEvent)
        .where(inArray(orderEvent.orderId, ids))
        .groupBy(orderEvent.orderId),
    ]);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      cancelReason: row.cancelReason,
      version: row.version,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      historyCount: events.find((e) => e.orderId === row.id)?.n ?? 0,
      splitRootId: row.splitRootId,
      customerId: row.customerId,
      customerReference: row.customerReference,
      notes: row.notes,
      bodyTypeId: row.bodyTypeId,
      sideLoading: row.sideLoading,
      tailLift: row.tailLift,
      stops: stops
        .filter((s) => s.orderId === row.id)
        .map((s) => ({
          id: s.id,
          kind: s.kind,
          siteId: s.siteId,
          period: s.slot,
          bookingMade: s.bookingMade,
          bookingReference: s.bookingReference,
        })),
      lines: goods
        .filter((g) => g.orderId === row.id)
        .map((g) => ({
          id: g.id,
          description: g.description,
          quantity: g.quantity,
          packaging: g.packaging,
          weightKg: g.weightKg,
          floorDm: g.floorDm,
          unNumber: g.unNumber,
          adrClass: g.adrClass,
          temperatureMin: g.temperatureMin,
          temperatureMax: g.temperatureMax,
          fromStopId: g.fromStopId,
          toStopId: g.toStopId,
        })),
    }));
  }

  async function get(id: string) {
    return (await load(await db.select().from(transportOrder).where(eq(transportOrder.id, id))))[0];
  }

  const stopRows = (orderId: string, order: OrderRecord) =>
    order.stops.map((s, sortOrder) => ({
      id: s.id,
      orderId,
      kind: s.kind,
      siteId: s.siteId,
      slot: s.period,
      bookingMade: s.bookingMade,
      bookingReference: s.bookingReference,
      sortOrder,
    }));

  const goodsRows = (orderId: string, order: OrderRecord) =>
    order.lines.map((l, sortOrder) => ({
      id: l.id,
      orderId,
      sortOrder,
      description: l.description,
      quantity: l.quantity,
      packaging: l.packaging,
      weightKg: l.weightKg,
      floorDm: l.floorDm,
      unNumber: l.unNumber,
      adrClass: l.adrClass,
      temperatureMin: l.temperatureMin,
      temperatureMax: l.temperatureMax,
      fromStopId: l.fromStopId,
      toStopId: l.toStopId,
    }));

  const eventRows = (orderId: string, events: readonly NewOrderEvent[]) =>
    events.map(({ at, kind, ...details }) => ({
      orderId,
      at: new Date(at.epochMilliseconds),
      kind,
      details,
    }));

  /** Rows of one table, a statement per batch: PostgreSQL takes 65,535 parameters at most. */
  async function insertRows<T>(rows: readonly T[], write: (batch: T[]) => Promise<unknown>) {
    for (let i = 0; i < rows.length; i += 500) await write(rows.slice(i, i + 500));
  }

  /** Stops and lines, replaced as a whole under the order's version. */
  async function writeChildren(tx: Database, orderId: string, order: OrderRecord) {
    await tx.delete(orderGoods).where(eq(orderGoods.orderId, orderId));
    await tx.delete(orderStop).where(eq(orderStop.orderId, orderId));
    await insertRows(stopRows(orderId, order), (rows) => tx.insert(orderStop).values(rows));
    await insertRows(goodsRows(orderId, order), (rows) => tx.insert(orderGoods).values(rows));
  }

  /**
   * Writes new orders in a few statements whatever their count. Their numbers are taken at once
   * from the counter row, which stays locked until the commit: the next creation waits for it.
   */
  async function insert(
    tx: Database,
    orders: readonly {
      order: OrderRecord;
      events: readonly NewOrderEvent[];
      splitRootId?: string;
    }[],
    year: number,
  ): Promise<{ id: string; number: string }[]> {
    if (orders.length === 0) return [];
    await lockActive(
      tx,
      orders.map((o) => o.order),
    );
    const [counter] = await tx
      .insert(orderCounter)
      .values({ companyId: defaultCompanyId, year, lastValue: orders.length })
      .onConflictDoUpdate({
        target: [orderCounter.companyId, orderCounter.year],
        set: { lastValue: sql`${orderCounter.lastValue} + ${orders.length}` },
      })
      .returning({ lastValue: orderCounter.lastValue });
    if (!counter) throw new Error('No order number');
    const first = counter.lastValue - orders.length + 1;
    const ids = orders.map(() => globalThis.crypto.randomUUID());
    const numbers = orders.map((_, i) => formatNumber(year, first + i));
    await insertRows(
      orders.map(({ order, splitRootId }, i) => ({
        ...headerValues(order),
        id: ids[i] ?? '',
        companyId: defaultCompanyId,
        number: numbers[i] ?? '',
        splitRootId: splitRootId ?? null,
      })),
      (rows) => tx.insert(transportOrder).values(rows),
    );
    await insertRows(
      orders.flatMap(({ order }, i) => stopRows(ids[i] ?? '', order)),
      (rows) => tx.insert(orderStop).values(rows),
    );
    await insertRows(
      orders.flatMap(({ order }, i) => goodsRows(ids[i] ?? '', order)),
      (rows) => tx.insert(orderGoods).values(rows),
    );
    await insertRows(
      orders.flatMap(({ events }, i) => eventRows(ids[i] ?? '', events)),
      (rows) => tx.insert(orderEvent).values(rows),
    );
    return ids.map((id, i) => ({ id, number: numbers[i] ?? '' }));
  }

  return {
    list: async ({ statuses, customerId }) =>
      statuses.length === 0
        ? []
        : load(
            await db
              .select()
              .from(transportOrder)
              .where(
                and(
                  inArray(transportOrder.status, [...statuses]),
                  customerId ? eq(transportOrder.customerId, customerId) : undefined,
                ),
              )
              .orderBy(asc(transportOrder.number)),
          ),
    get,
    findByReference: (customerId, reference, exceptFamily) =>
      db
        .select({ id: transportOrder.id, number: transportOrder.number })
        .from(transportOrder)
        .where(
          and(
            eq(transportOrder.customerId, customerId),
            eq(transportOrder.customerReference, reference),
            active,
            exceptFamily
              ? sql`coalesce(${transportOrder.splitRootId}, ${transportOrder.id}) <> ${exceptFamily}`
              : undefined,
          ),
        )
        .orderBy(asc(transportOrder.number)),
    create: async (order, year, event) => {
      const [{ id } = { id: '' }] = await translateErrors(() =>
        db.transaction((tx) => insert(tx, [{ order, events: [event] }], year)),
      );
      const created = await get(id);
      if (!created) throw new Error(`Order ${id} vanished`);
      return created;
    },
    createMany: (orders, year) =>
      translateErrors(() =>
        db.transaction(
          async (tx) =>
            (
              await insert(
                tx,
                orders.map(({ order, event }) => ({ order, events: [event] })),
                year,
              )
            ).length,
        ),
      ),
    split: async (id, version, kept, moved, year, events) => {
      const ids = await translateErrors(() =>
        db.transaction(async (tx) => {
          await lockActive(tx, [kept, moved]);
          // The order joins its family, or starts one: its own id when never split before.
          const rows = await tx
            .update(transportOrder)
            .set({
              ...headerValues(kept),
              splitRootId: sql`coalesce(${transportOrder.splitRootId}, ${transportOrder.id})`,
              version: nextVersion(transportOrder),
              updatedAt: sql`now()`,
            })
            .where(and(atVersion(transportOrder, id, version), active))
            .returning({ number: transportOrder.number, splitRootId: transportOrder.splitRootId });
          const [row] = rows;
          if (!row) return missingOrStale(tx, transportOrder, id);
          await writeChildren(tx, id, kept);
          const [created] = await insert(
            tx,
            [{ order: moved, events: [], splitRootId: row.splitRootId ?? id }],
            year,
          );
          if (!created) throw new Error('No order created');
          const entries = events({ kept: { id, number: row.number }, moved: created });
          await tx
            .insert(orderEvent)
            .values([...eventRows(id, entries.kept), ...eventRows(created.id, entries.moved)]);
          return { kept: id, moved: created.id };
        }),
      );
      if (!ids) return undefined;
      const [keptOrder, movedOrder] = await Promise.all([get(ids.kept), get(ids.moved)]);
      if (!keptOrder || !movedOrder) throw new Error(`Order ${id} vanished`);
      return { kept: keptOrder, moved: movedOrder };
    },
    update: async (id, version, order, events) => {
      const updated = await translateErrors(() =>
        db.transaction(async (tx) => {
          await lockActive(tx, [order]);
          const rows = await tx
            .update(transportOrder)
            .set({
              ...headerValues(order),
              version: nextVersion(transportOrder),
              updatedAt: sql`now()`,
            })
            .where(and(atVersion(transportOrder, id, version), active))
            .returning({ id: transportOrder.id });
          if (rows.length === 0) return missingOrStale(tx, transportOrder, id);
          await writeChildren(tx, id, order);
          if (events.length > 0) await tx.insert(orderEvent).values(eventRows(id, events));
          return true;
        }),
      );
      return updated ? get(id) : undefined;
    },
    cancel: async (id, version, reason, event) => {
      const cancelled = await db.transaction(async (tx) => {
        const rows = await tx
          .update(transportOrder)
          .set({
            status: 'cancelled',
            cancelReason: reason,
            version: nextVersion(transportOrder),
            updatedAt: sql`now()`,
          })
          .where(and(atVersion(transportOrder, id, version), active))
          .returning({ id: transportOrder.id });
        if (rows.length === 0) return missingOrStale(tx, transportOrder, id);
        await tx.insert(orderEvent).values(eventRows(id, [event]));
        return true;
      });
      return cancelled ? get(id) : undefined;
    },
    history: async (id) => {
      const rows = await db
        .select()
        .from(orderEvent)
        .where(eq(orderEvent.orderId, id))
        .orderBy(desc(orderEvent.sequence));
      return rows.map(
        (row) =>
          ({
            ...(row.details as object),
            id: row.id,
            kind: row.kind,
            at: instant(row.at),
            authorId: row.authorId,
          }) as OrderEvent,
      );
    },
  };
}
