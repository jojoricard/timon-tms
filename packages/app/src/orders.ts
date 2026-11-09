import {
  checkOrder,
  companyDay,
  type GoodsLine,
  type Issue,
  type OrderDetails,
  type OrderRequirement,
  type OrderShape,
  type OrderSites,
  type OrderStatus,
  type OrderStop,
  type OrderTotals,
  type OrderWarning,
  orderChanges,
  orderRequirements,
  orderShape,
  orderTotals,
  orderWarnings,
  slotOf,
  slotOfStop,
  slotPeriod,
  Temporal,
} from '@timon/domain';
import {
  ArchivedReferenceError,
  type NewOrderEvent,
  type OrderEvent,
  type OrderRecord,
  type OrderRef,
  type Ports,
  type StopRecord,
  type StoredCustomer,
  type StoredOrder,
  type StoredSite,
} from './ports.ts';
import type { FieldIssue } from './resources.ts';
import { searchable } from './search.ts';
import { guarded, type Stale, stale } from './versions.ts';

// SPEC-004: orders entered by hand, checked as they are saved, kept with their history.

export type OrderCustomer = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly archived: boolean;
};

export type OrderSiteSummary = {
  readonly id: string;
  readonly name: string;
  readonly street1: string;
  readonly postcode: string;
  readonly city: string;
  readonly archived: boolean;
};

export type OrderView = {
  readonly id: string;
  readonly number: string;
  readonly status: OrderStatus;
  readonly cancelReason: string | null;
  readonly version: number;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly historyCount: number;
  readonly details: OrderDetails;
  readonly customer: OrderCustomer | null;
  /** The sites of its stops, archived or not. */
  readonly sites: readonly OrderSiteSummary[];
  readonly shape: OrderShape;
  readonly totals: OrderTotals;
  readonly requirements: readonly OrderRequirement[];
  readonly warnings: readonly OrderWarning[];
  /** Why the order is to review; empty once nothing is left to fix. */
  readonly review: readonly Issue[];
};

export type OrderResult =
  | { readonly ok: true; readonly order: OrderView }
  | { readonly ok: false; readonly reason: 'not-found' }
  | Stale
  /** Rule 6: a cancelled order is read only. */
  | { readonly ok: false; readonly reason: 'cancelled' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] };

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const newId = () => globalThis.crypto.randomUUID();

/**
 * Trims text, keeps a booking reference only with a booking made, and gives a new id to every
 * stop and line that is not already one of `existing`, lines following their stops.
 */
export function normaliseOrder(input: OrderDetails, existing?: StoredOrder): OrderDetails {
  const known = (id: string, ids: readonly { id: string }[] | undefined) =>
    ids?.some((x) => x.id === id) ?? false;
  const stopIds = new Map(
    input.stops.map((s) => [s.id, known(s.id, existing?.stops) ? s.id : newId()]),
  );
  const stops = input.stops.map(
    (s): OrderStop => ({
      ...s,
      id: stopIds.get(s.id) ?? newId(),
      siteId: s.siteId.trim(),
      bookingReference: s.bookingMade ? clean(s.bookingReference) : null,
    }),
  );
  const lines = input.lines.map(
    (l): GoodsLine => ({
      ...l,
      id: known(l.id, existing?.lines) ? l.id : newId(),
      description: l.description.trim(),
      unNumber: clean(l.unNumber),
      // A line that names no stop of the order keeps what it named, for its issue.
      fromStopId: stopIds.get(l.fromStopId) ?? l.fromStopId,
      toStopId: stopIds.get(l.toStopId) ?? l.toStopId,
    }),
  );
  return {
    ...input,
    customerId: input.customerId.trim(),
    customerReference: clean(input.customerReference),
    notes: clean(input.notes),
    bodyTypeId: clean(input.bodyTypeId),
    stops,
    lines,
  };
}

type Context = {
  readonly customer: StoredCustomer | undefined;
  readonly sites: ReadonlyMap<string, StoredSite>;
};

async function contextOf(ports: Ports, customerId: string): Promise<Context> {
  const [customer, sites] = await Promise.all([
    customerId === '' ? undefined : ports.customers.get(customerId),
    ports.sites.list({ includeArchived: true }),
  ]);
  return { customer, sites: new Map(sites.map((s) => [s.id, s])) };
}

/** What only the application knows: the customer, the sites and the body type exist. */
async function referenceIssues(ports: Ports, order: OrderDetails, context: Context) {
  const issues: FieldIssue[] = [];
  if (order.customerId !== '') {
    if (!context.customer) issues.push({ field: 'customerId', code: 'unknown-value' });
    else if (context.customer.archived) issues.push({ field: 'customerId', code: 'archived' });
  }
  for (const [index, stop] of order.stops.entries()) {
    if (stop.siteId === '') continue;
    const site = context.sites.get(stop.siteId);
    if (!site) issues.push({ field: `stops.${index}.siteId`, code: 'unknown-value' });
    else if (site.archived) issues.push({ field: `stops.${index}.siteId`, code: 'archived' });
  }
  if (order.bodyTypeId) {
    const { bodyTypes } = await ports.referenceLists.get();
    if (!bodyTypes.some((b) => b.id === order.bodyTypeId)) {
      issues.push({ field: 'bodyTypeId', code: 'unknown-value' });
    }
  }
  return issues;
}

/** The order as stored: each slot as instants, read in its site's time zone. */
export function orderRecord(
  order: OrderDetails,
  status: OrderRecord['status'],
  sites: OrderSites,
): OrderRecord {
  const stops = order.stops.map((stop): StopRecord => {
    const slot = slotOfStop(stop);
    const site = sites.get(stop.siteId);
    if (!slot || !site) throw new Error(`Stop ${stop.id} has no slot or no site`);
    return {
      id: stop.id,
      kind: stop.kind,
      siteId: stop.siteId,
      period: slotPeriod(slot, site.timeZone),
      bookingMade: stop.bookingMade,
      bookingReference: stop.bookingReference,
    };
  });
  return { ...order, status, stops };
}

/** The order as the form shows it: each slot in its site's time zone. */
export function detailsOf(order: StoredOrder, sites: OrderSites): OrderDetails {
  return {
    customerId: order.customerId,
    customerReference: order.customerReference,
    notes: order.notes,
    bodyTypeId: order.bodyTypeId,
    sideLoading: order.sideLoading,
    tailLift: order.tailLift,
    lines: order.lines,
    stops: order.stops.map((stop): OrderStop => {
      const slot = slotOf(stop.period, sites.get(stop.siteId)?.timeZone ?? 'Europe/Paris');
      return {
        id: stop.id,
        kind: stop.kind,
        siteId: stop.siteId,
        date: slot.date,
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        bookingMade: stop.bookingMade,
        bookingReference: stop.bookingReference,
      };
    }),
  };
}

const customerOf = (c: StoredCustomer | undefined): OrderCustomer | null =>
  c ? { id: c.id, code: c.code, name: c.name, archived: c.archived } : null;

function view(order: StoredOrder, context: Context, sameReference: readonly OrderRef[]): OrderView {
  const details = detailsOf(order, context.sites);
  const siteIds = [...new Set(order.stops.map((s) => s.siteId))];
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    cancelReason: order.cancelReason,
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    historyCount: order.historyCount,
    details,
    customer: customerOf(context.customer),
    sites: siteIds.flatMap((id) => {
      const s = context.sites.get(id);
      return s
        ? [
            {
              id: s.id,
              name: s.name,
              street1: s.street1,
              postcode: s.postcode,
              city: s.city,
              archived: s.archived,
            },
          ]
        : [];
    }),
    shape: orderShape(details),
    totals: orderTotals(details),
    requirements: orderRequirements(details, context.sites),
    warnings: orderWarnings(
      details,
      context.sites,
      order.status === 'cancelled' ? [] : sameReference.map((o) => o.number),
    ),
    review: order.status === 'to-review' ? checkOrder(details, context.sites).review : [],
  };
}

async function sameReferenceOf(
  ports: Ports,
  order: Pick<OrderDetails, 'customerId' | 'customerReference'>,
  exceptId?: string,
) {
  return order.customerReference
    ? ports.orders.findByReference(order.customerId, order.customerReference, exceptId)
    : [];
}

export async function getOrder(ports: Ports, id: string): Promise<OrderView | undefined> {
  const order = await ports.orders.get(id);
  if (!order) return undefined;
  const context = await contextOf(ports, order.customerId);
  return view(order, context, await sameReferenceOf(ports, order, order.id));
}

/** The issues that keep an order from being saved, and its status otherwise. */
async function prepare(
  ports: Ports,
  order: OrderDetails,
  context: Context,
  reviewAllowed: boolean,
): Promise<
  | { ok: true; status: OrderRecord['status'] }
  | { ok: false; reason: 'invalid'; issues: FieldIssue[] }
> {
  const { blocking, review } = checkOrder(order, context.sites);
  const issues = [...(await referenceIssues(ports, order, context)), ...blocking];
  // By hand, an order is saved to plan or not at all; only an order already to review stays so.
  if (!reviewAllowed) issues.push(...review);
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  return { ok: true, status: review.length > 0 ? 'to-review' : 'to-plan' };
}

/** An archived customer or site, found by the repository after the check (rule 8). */
async function whenArchived<T>(
  ports: Ports,
  order: OrderDetails,
  run: () => Promise<T>,
): Promise<T | { ok: false; reason: 'invalid'; issues: FieldIssue[] }> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ArchivedReferenceError)) throw error;
    const issues = await referenceIssues(ports, order, await contextOf(ports, order.customerId));
    if (issues.length === 0) throw error;
    return { ok: false, reason: 'invalid', issues };
  }
}

const yearOf = (now: Temporal.Instant) => companyDay(now).year;

/**
 * Criterion 1: a new order gets the next number and is to plan. `duplicatedFrom` names the order
 * it copies (criterion 16), for its history.
 */
export async function createOrder(
  ports: Ports,
  input: OrderDetails,
  options: { duplicatedFrom?: string | undefined } = {},
): Promise<Exclude<OrderResult, Stale>> {
  const order = normaliseOrder(input);
  const context = await contextOf(ports, order.customerId);
  const prepared = await prepare(ports, order, context, false);
  if (!prepared.ok) return prepared;
  const source = options.duplicatedFrom
    ? await ports.orders.get(options.duplicatedFrom)
    : undefined;
  if (options.duplicatedFrom && !source) {
    return {
      ok: false,
      reason: 'invalid',
      issues: [{ field: 'duplicatedFrom', code: 'unknown-value' }],
    };
  }
  const now = ports.clock.now();
  return whenArchived(ports, order, async (): Promise<Exclude<OrderResult, Stale>> => {
    const created = await ports.orders.create(
      orderRecord(order, prepared.status, context.sites),
      yearOf(now),
      {
        at: now,
        kind: 'created',
        origin: source ? 'duplicate' : 'hand',
        status: prepared.status,
        source: source?.number ?? null,
        fileName: null,
        fileLines: [],
      },
    );
    return {
      ok: true,
      order: view(created, context, await sameReferenceOf(ports, order, created.id)),
    };
  });
}

/**
 * Rule 7: under the version read. A to-review order becomes to plan once nothing is left to fix;
 * the history records the fields changed, old and new, and the change of status.
 */
export async function updateOrder(
  ports: Ports,
  id: string,
  version: number,
  input: OrderDetails,
): Promise<OrderResult> {
  const existing = await ports.orders.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (existing.version !== version) return stale(existing.version);
  if (existing.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  const order = normaliseOrder(input, existing);
  const context = await contextOf(ports, order.customerId);
  const prepared = await prepare(ports, order, context, existing.status === 'to-review');
  if (!prepared.ok) return prepared;

  const before = await contextOf(ports, existing.customerId);
  const siteName = (siteId: string) => context.sites.get(siteId)?.name ?? siteId;
  const customerName = (customerId: string) =>
    (customerId === existing.customerId ? before.customer : context.customer)?.name ?? customerId;
  const at = ports.clock.now();
  const changes = orderChanges(detailsOf(existing, context.sites), order, siteName, customerName);
  const events: NewOrderEvent[] = [];
  if (changes.length > 0) events.push({ at, kind: 'changed', changes });
  if (prepared.status !== existing.status) {
    events.push({ at, kind: 'status', from: existing.status, to: prepared.status, reason: null });
  }
  return guarded(() =>
    whenArchived(ports, order, async (): Promise<OrderResult> => {
      const saved = await ports.orders.update(
        id,
        version,
        orderRecord(order, prepared.status, context.sites),
        events,
      );
      if (!saved) return { ok: false, reason: 'not-found' };
      return { ok: true, order: view(saved, context, await sameReferenceOf(ports, order, id)) };
    }),
  );
}

/** Rule 6: never deleted; cancelled with a reason, then read only (criterion 10). */
export async function cancelOrder(
  ports: Ports,
  id: string,
  version: number,
  reason: string,
): Promise<OrderResult> {
  const existing = await ports.orders.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (existing.version !== version) return stale(existing.version);
  if (existing.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  const why = clean(reason);
  if (!why)
    return { ok: false, reason: 'invalid', issues: [{ field: 'reason', code: 'required' }] };
  return guarded(async () => {
    const saved = await ports.orders.cancel(id, version, why, {
      at: ports.clock.now(),
      kind: 'status',
      from: existing.status,
      to: 'cancelled',
      reason: why,
    });
    if (!saved) return { ok: false, reason: 'not-found' } as const;
    return { ok: true, order: view(saved, await contextOf(ports, saved.customerId), []) } as const;
  });
}

export async function orderHistory(ports: Ports, id: string): Promise<OrderEvent[] | undefined> {
  const order = await ports.orders.get(id);
  return order ? ports.orders.history(id) : undefined;
}

export type StopSummary = {
  readonly siteId: string;
  readonly siteName: string;
  readonly date: Temporal.PlainDate;
  readonly startMinute: number;
  readonly endMinute: number;
};

/** A row of the list of orders. */
export type OrderSummary = {
  readonly id: string;
  readonly number: string;
  readonly status: OrderStatus;
  readonly version: number;
  readonly customer: OrderCustomer | null;
  readonly customerReference: string | null;
  readonly firstPickup: StopSummary | null;
  readonly lastDelivery: StopSummary | null;
  readonly pickups: number;
  readonly deliveries: number;
  readonly totals: OrderTotals;
  readonly requirements: readonly OrderRequirement[];
  readonly warnings: readonly OrderWarning[];
  readonly review: readonly Issue[];
};

export const orderStatusFilters = ['all', 'to-plan', 'to-review'] as const;
export type OrderStatusFilter = (typeof orderStatusFilters)[number];

export type OrderList = {
  readonly day: Temporal.PlainDate;
  /** Over the dates, the customer and the search, whatever the status. */
  readonly counts: Readonly<Record<OrderStatus, number>>;
  readonly orders: readonly OrderSummary[];
};

export type OrderListOptions = {
  readonly query?: string | undefined;
  readonly status?: OrderStatusFilter | undefined;
  readonly includeCancelled?: boolean | undefined;
  /** First pickup on or after; today by default. */
  readonly from?: Temporal.PlainDate | undefined;
  /** First pickup on or before. */
  readonly to?: Temporal.PlainDate | undefined;
  readonly customerId?: string | undefined;
};

function stopSummary(stop: StopRecord | undefined, context: Context): StopSummary | null {
  if (!stop) return null;
  const site = context.sites.get(stop.siteId);
  const slot = slotOf(stop.period, site?.timeZone ?? 'Europe/Paris');
  return { siteId: stop.siteId, siteName: site?.name ?? '', ...slot };
}

const byInstant = (key: 'start' | 'end') => (a: StopRecord, b: StopRecord) =>
  Temporal.Instant.compare(a.period[key], b.period[key]);

/**
 * The orders to plan and to review from today, sorted by first pickup; cancelled ones on request.
 * The search finds numbers and customers' references.
 */
export async function listOrders(ports: Ports, options: OrderListOptions = {}): Promise<OrderList> {
  const today = companyDay(ports.clock.now());
  const from = options.from ?? today;
  const [stored, customers, sites] = await Promise.all([
    ports.orders.list({
      statuses: ['to-plan', 'to-review', 'cancelled'],
      customerId: options.customerId,
    }),
    ports.customers.list({ includeArchived: true }),
    ports.sites.list({ includeArchived: true }),
  ]);
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const query = searchable(options.query?.trim() ?? '');

  const rows = stored.flatMap((order) => {
    const context: Context = {
      customer: customers.find((c) => c.id === order.customerId),
      sites: siteMap,
    };
    const pickups = order.stops.filter((s) => s.kind === 'pickup').sort(byInstant('start'));
    const deliveries = order.stops.filter((s) => s.kind === 'delivery').sort(byInstant('end'));
    const firstPickup = stopSummary(pickups[0], context);
    if (firstPickup) {
      if (Temporal.PlainDate.compare(firstPickup.date, from) < 0) return [];
      if (options.to && Temporal.PlainDate.compare(firstPickup.date, options.to) > 0) return [];
    }
    if (query !== '') {
      const haystack = searchable(`${order.number} ${order.customerReference ?? ''}`);
      if (!query.split(/\s+/).every((word) => haystack.includes(word))) return [];
    }
    return [{ order, context, pickups, deliveries, firstPickup }];
  });

  const counts = { 'to-plan': 0, 'to-review': 0, cancelled: 0 };
  for (const { order } of rows) counts[order.status] += 1;

  const status = options.status ?? 'all';
  const orders = rows
    .filter(({ order }) =>
      order.status === 'cancelled'
        ? (options.includeCancelled ?? false)
        : status === 'all' || order.status === status,
    )
    .sort(
      (a, b) =>
        (a.pickups[0] && b.pickups[0] ? byInstant('start')(a.pickups[0], b.pickups[0]) : 0) ||
        a.order.number.localeCompare(b.order.number),
    )
    .map(({ order, context, pickups, deliveries, firstPickup }): OrderSummary => {
      const details = detailsOf(order, context.sites);
      const sameReference =
        order.status === 'cancelled' || !order.customerReference
          ? []
          : stored
              .filter(
                (o) =>
                  o.id !== order.id &&
                  o.status !== 'cancelled' &&
                  o.customerId === order.customerId &&
                  o.customerReference === order.customerReference,
              )
              .map((o) => o.number);
      return {
        id: order.id,
        number: order.number,
        status: order.status,
        version: order.version,
        customer: customerOf(context.customer),
        customerReference: order.customerReference,
        firstPickup,
        lastDelivery: stopSummary(deliveries.at(-1), context),
        pickups: pickups.length,
        deliveries: deliveries.length,
        totals: orderTotals(details),
        requirements: orderRequirements(details, context.sites),
        warnings: orderWarnings(details, context.sites, sameReference),
        review: order.status === 'to-review' ? checkOrder(details, context.sites).review : [],
      };
    });
  return { day: today, counts, orders };
}
