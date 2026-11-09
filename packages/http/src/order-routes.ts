import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cancelOrder,
  createOrder,
  getOrder,
  listOrders,
  type OrderEvent as OrderEventView,
  type OrderResult,
  type OrderSummary as OrderSummaryView,
  type OrderView,
  orderHistory,
  type Ports,
  type Stale,
  type StopSummary,
  updateOrder,
} from '@timon/app';
import {
  formatMinutes,
  type OrderDetails,
  type OrderRequirement,
  type OrderTotals,
  type OrderWarning,
  parseTime,
  Temporal,
} from '@timon/domain';
import {
  CancelInput,
  NewOrderInput,
  Order,
  OrderHistory,
  OrderInput,
  OrderList,
  OrderQuery,
} from './order-schemas.ts';
import { Invalid, Problem } from './schemas.ts';
import { validationHook } from './validation.ts';
import { guardedAnswers, ifMatch, staleBody, versionOf } from './versions.ts';

// SPEC-004: orders, their changes, their cancelling and their history.

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { ...json(schema, 'Request body'), required: true },
});
const id = z.object({ id: z.uuid() });

const time = (minutes: number | null) => (minutes === null ? null : formatMinutes(minutes));

const toTotals = (t: OrderTotals) => ({ ...t, quantities: { ...t.quantities } });
const toRequirement = (r: OrderRequirement) => ({
  code: r.code,
  params: { ...r.params },
  ids: [...r.ids],
  source: { kind: r.source.kind, lines: [...r.source.lines], siteIds: [...r.source.siteIds] },
});
const toWarning = (w: OrderWarning) => ({ ...w, params: { ...w.params } });
const toIssue = (i: { field: string; code: string; params?: Readonly<Record<string, unknown>> }) =>
  ({ ...i, ...(i.params ? { params: { ...i.params } } : {}) }) as {
    field: string;
    code: string;
    params?: Record<string, string | number>;
  };

export function toOrder(o: OrderView): z.infer<typeof Order> {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    cancelReason: o.cancelReason,
    version: o.version,
    createdAt: o.createdAt.toString(),
    updatedAt: o.updatedAt.toString(),
    historyCount: o.historyCount,
    customer: o.customer ? { ...o.customer } : null,
    customerId: o.details.customerId,
    customerReference: o.details.customerReference,
    notes: o.details.notes,
    bodyTypeId: o.details.bodyTypeId,
    sideLoading: o.details.sideLoading,
    tailLift: o.details.tailLift,
    stops: o.details.stops.map((s) => ({
      id: s.id,
      kind: s.kind,
      siteId: s.siteId,
      date: s.date?.toString() ?? null,
      start: time(s.startMinute),
      end: time(s.endMinute),
      bookingMade: s.bookingMade,
      bookingReference: s.bookingReference,
    })),
    lines: o.details.lines.map((l) => ({ ...l })),
    sites: o.sites.map((s) => ({ ...s })),
    shape: o.shape,
    totals: toTotals(o.totals),
    requirements: o.requirements.map(toRequirement),
    warnings: o.warnings.map(toWarning),
    review: o.review.map(toIssue),
  };
}

const toStopSummary = (s: StopSummary | null) =>
  s
    ? {
        siteId: s.siteId,
        siteName: s.siteName,
        date: s.date.toString(),
        start: formatMinutes(s.startMinute),
        end: formatMinutes(s.endMinute),
      }
    : null;

const toSummary = (o: OrderSummaryView) => ({
  ...o,
  customer: o.customer ? { ...o.customer } : null,
  firstPickup: toStopSummary(o.firstPickup),
  lastDelivery: toStopSummary(o.lastDelivery),
  totals: toTotals(o.totals),
  requirements: o.requirements.map(toRequirement),
  warnings: o.warnings.map(toWarning),
  review: o.review.map(toIssue),
});

const toEvent = (e: OrderEventView): z.infer<typeof OrderHistory>['events'][number] => {
  const base = { id: e.id, at: e.at.toString(), authorId: e.authorId };
  switch (e.kind) {
    case 'created':
      return { ...base, ...e, at: base.at, fileLines: [...e.fileLines] };
    case 'changed':
      return {
        ...base,
        kind: 'changed',
        changes: e.changes.map((c) => ({ ...c, goods: c.goods ? { ...c.goods } : null })),
      };
    case 'status':
      return { ...base, ...e, at: base.at };
  }
};

/** "24:00" is the end of the day: 1,440 minutes. */
const minutes = (value: string | null | undefined) =>
  value === null || value === undefined ? null : (parseTime(value) ?? null);

/** The request body as the domain's order; optional fields become null or false. */
export function fromOrderInput(input: z.infer<typeof OrderInput>): OrderDetails {
  return {
    customerId: input.customerId,
    customerReference: input.customerReference ?? null,
    notes: input.notes ?? null,
    bodyTypeId: input.bodyTypeId ?? null,
    sideLoading: input.sideLoading ?? false,
    tailLift: input.tailLift ?? false,
    stops: input.stops.map((s) => ({
      id: s.id,
      kind: s.kind,
      siteId: s.siteId,
      date: s.date ? Temporal.PlainDate.from(s.date) : null,
      startMinute: minutes(s.start),
      endMinute: minutes(s.end),
      bookingMade: s.bookingMade ?? false,
      bookingReference: s.bookingReference ?? null,
    })),
    lines: input.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      packaging: l.packaging,
      weightKg: l.weightKg,
      floorDm: l.floorDm ?? null,
      unNumber: l.unNumber ?? null,
      adrClass: l.adrClass ?? null,
      temperatureMin: l.temperatureMin ?? null,
      temperatureMax: l.temperatureMax ?? null,
      fromStopId: l.fromStopId,
      toStopId: l.toStopId,
    })),
  };
}

/** A refused write, as a status and a body the interface can translate. */
function failure(result: Exclude<OrderResult, { ok: true } | Stale>) {
  switch (result.reason) {
    case 'not-found':
      return { status: 404, body: { error: 'not-found' } } as const;
    case 'cancelled':
      return { status: 409, body: { error: 'cancelled' } } as const;
    case 'invalid':
      return {
        status: 400,
        body: { error: 'invalid', issues: result.issues.map(toIssue) },
      } as const;
  }
}

const writeAnswers = {
  200: json(Order, 'The order'),
  400: json(z.union([Invalid, Problem]), 'A rule is broken; each issue names its field'),
  404: json(Problem, 'No such order'),
  409: json(Problem, 'The order is cancelled: it is read only (rule 6)'),
};

const routes = {
  list: createRoute({
    method: 'get',
    path: '/orders',
    request: { query: OrderQuery },
    responses: {
      200: json(OrderList, 'Orders to plan and to review from the date, by first pickup'),
    },
  }),
  get: createRoute({
    method: 'get',
    path: '/orders/{id}',
    request: { params: id },
    responses: { 200: json(Order, 'The order'), 404: json(Problem, 'No such order') },
  }),
  history: createRoute({
    method: 'get',
    path: '/orders/{id}/history',
    request: { params: id },
    responses: {
      200: json(OrderHistory, 'The entries of its history, newest first'),
      404: json(Problem, 'No such order'),
    },
  }),
  create: createRoute({
    method: 'post',
    path: '/orders',
    request: body(NewOrderInput),
    responses: { ...writeAnswers, 201: json(Order, 'Order created, with its number') },
  }),
  update: createRoute({
    method: 'put',
    path: '/orders/{id}',
    request: { params: id, headers: ifMatch, ...body(OrderInput) },
    responses: { ...writeAnswers, ...guardedAnswers },
  }),
  cancel: createRoute({
    method: 'post',
    path: '/orders/{id}/cancel',
    request: { params: id, headers: ifMatch, ...body(CancelInput) },
    responses: { ...writeAnswers, ...guardedAnswers },
  }),
};

const dayOf = (iso: string | undefined) => (iso ? Temporal.PlainDate.from(iso) : undefined);

/** SPEC-004: orders. */
export function orderApi(ports: Ports) {
  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(routes.list, async (c) => {
      const q = c.req.valid('query');
      const list = await listOrders(ports, {
        query: q.q,
        status: q.status,
        includeCancelled: q.cancelled,
        from: dayOf(q.from),
        to: dayOf(q.to),
        customerId: q.customer,
      });
      return c.json(
        { day: list.day.toString(), counts: list.counts, orders: list.orders.map(toSummary) },
        200,
      );
    })
    .openapi(routes.get, async (c) => {
      const order = await getOrder(ports, c.req.valid('param').id);
      return order ? c.json(toOrder(order), 200) : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.history, async (c) => {
      const events = await orderHistory(ports, c.req.valid('param').id);
      return events
        ? c.json({ events: events.map(toEvent) }, 200)
        : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.create, async (c) => {
      const input = c.req.valid('json');
      const result = await createOrder(ports, fromOrderInput(input), {
        duplicatedFrom: input.duplicatedFrom,
      });
      if (result.ok) return c.json(toOrder(result.order), 201);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.update, async (c) => {
      const result = await updateOrder(
        ports,
        c.req.valid('param').id,
        versionOf(c.req.valid('header')),
        fromOrderInput(c.req.valid('json')),
      );
      if (result.ok) return c.json(toOrder(result.order), 200);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.cancel, async (c) => {
      const result = await cancelOrder(
        ports,
        c.req.valid('param').id,
        versionOf(c.req.valid('header')),
        c.req.valid('json').reason,
      );
      if (result.ok) return c.json(toOrder(result.order), 200);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    });
}
