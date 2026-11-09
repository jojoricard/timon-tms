import { z } from '@hono/zod-openapi';
import { orderOrigins, orderStatusFilters } from '@timon/app';
import {
  adrClasses,
  orderStatuses,
  orderWarningCodes,
  packagings,
  requirementCodes,
  stopKinds,
  textLimits,
} from '@timon/domain';
import { Issue, instant } from './schemas.ts';

const day = z.iso.date().openapi({ example: '2026-11-10' });
const text = (max: number) => z.string().max(max).nullable().optional();
/** A record named by the form: an id, or nothing chosen yet. */
const choice = z.union([z.literal(''), z.uuid()]);
/** "08:00"; 24:00 ends a slot at midnight. */
const time = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/)
  .openapi({ example: '08:00' });
/** The key of a stop or a line: its id, or a key the form chose for a new one. */
const key = z.string().min(1).max(64);
const Params = z.record(z.string(), z.union([z.string(), z.number()]));

export const OrderStatus = z.enum(orderStatuses).openapi('OrderStatus');
const StopKind = z.enum(stopKinds).openapi('StopKind');
const Packaging = z.enum(packagings).openapi('Packaging');
const AdrClass = z.enum(adrClasses).openapi('AdrClass');

const StopFields = {
  kind: StopKind,
  siteId: choice,
  /** In the site's time zone; an end earlier than the start falls on the next day. */
  date: day.nullable(),
  start: time.nullable(),
  end: time.nullable(),
  bookingMade: z.boolean(),
  bookingReference: z.string().max(textLimits.stop.bookingReference).nullable(),
};

const LineFields = {
  description: z.string().max(textLimits.goods.description),
  quantity: z.number().int(),
  packaging: Packaging,
  weightKg: z.number().int(),
  /** Floor metres in decimetres: 1.6 m is 16. */
  floorDm: z.number().int().nullable(),
  unNumber: z.string().max(10).nullable(),
  adrClass: AdrClass.nullable(),
  temperatureMin: z.number().int().nullable(),
  temperatureMax: z.number().int().nullable(),
  fromStopId: key,
  toStopId: key,
};

export const StopInput = z
  .object({
    ...StopFields,
    id: key,
    date: StopFields.date.optional(),
    start: StopFields.start.optional(),
    end: StopFields.end.optional(),
    bookingMade: z.boolean().optional(),
    bookingReference: text(textLimits.stop.bookingReference),
  })
  .openapi('StopInput');

export const LineInput = z
  .object({
    ...LineFields,
    id: key,
    floorDm: LineFields.floorDm.optional(),
    unNumber: LineFields.unNumber.optional(),
    adrClass: LineFields.adrClass.optional(),
    temperatureMin: LineFields.temperatureMin.optional(),
    temperatureMax: LineFields.temperatureMax.optional(),
  })
  .openapi('GoodsLineInput');

export const OrderInput = z
  .object({
    customerId: choice,
    customerReference: text(textLimits.order.customerReference),
    notes: text(textLimits.order.notes),
    bodyTypeId: z.uuid().nullable().optional(),
    sideLoading: z.boolean().optional(),
    tailLift: z.boolean().optional(),
    stops: z.array(StopInput).max(50),
    lines: z.array(LineInput).max(200),
  })
  .openapi('OrderInput');

export const NewOrderInput = OrderInput.extend({
  /** The order this one copies (criterion 16), for its history. */
  duplicatedFrom: z.uuid().optional(),
}).openapi('NewOrderInput');

/** The goods lines that go to the new order; the others stay. */
export const SplitInput = z.object({ lines: z.array(key).max(200) }).openapi('SplitOrderInput');

export const OrderImportInput = z
  .object({ csv: z.string(), fileName: z.string().max(255) })
  .openapi('OrderImportInput');

export const CancelInput = z
  .object({ reason: z.string().max(textLimits.order.cancelReason) })
  .openapi('CancelOrderInput');

const Stop = z.object({ ...StopFields, id: z.uuid() }).openapi('Stop');
const GoodsLine = z.object({ ...LineFields, id: z.uuid() }).openapi('GoodsLine');

const Totals = z
  .object({
    weightKg: z.number().int(),
    floorDm: z.number().int(),
    quantities: z.object(
      Object.fromEntries(packagings.map((p) => [p, z.number().int()])) as Record<
        (typeof packagings)[number],
        z.ZodNumber
      >,
    ),
  })
  .openapi('OrderTotals');

export const Requirement = z
  .object({
    code: z.enum(requirementCodes),
    params: Params,
    ids: z.array(z.string()),
    source: z.object({
      kind: z.enum(['lines', 'order', 'sites']),
      lines: z.array(z.number().int()),
      siteIds: z.array(z.string()),
    }),
  })
  .openapi('OrderRequirement');

export const Warning = z
  .object({ code: z.enum(orderWarningCodes), stopId: z.string().nullable(), params: Params })
  .openapi('OrderWarning');

const OrderCustomer = z
  .object({ id: z.uuid(), code: z.string(), name: z.string(), archived: z.boolean() })
  .openapi('OrderCustomer');

export const Order = z
  .object({
    id: z.uuid(),
    number: z.string().openapi({ example: 'CMD-2026-000412' }),
    status: OrderStatus,
    cancelReason: z.string().nullable(),
    /** ADR-005: every change and the cancelling are made under it. */
    version: z.number().int(),
    createdAt: instant,
    updatedAt: instant,
    historyCount: z.number().int(),
    customer: OrderCustomer.nullable(),
    customerId: z.uuid(),
    customerReference: z.string().nullable(),
    notes: z.string().nullable(),
    bodyTypeId: z.uuid().nullable(),
    sideLoading: z.boolean(),
    tailLift: z.boolean(),
    stops: z.array(Stop),
    lines: z.array(GoodsLine),
    sites: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        street1: z.string(),
        postcode: z.string(),
        city: z.string(),
        archived: z.boolean(),
      }),
    ),
    shape: z.enum(['one-pickup', 'one-delivery', 'several-both', 'incomplete']),
    totals: Totals,
    requirements: z.array(Requirement),
    warnings: z.array(Warning),
    /** Why the order is to review. */
    review: z.array(Issue),
  })
  .openapi('Order');

const StopSummary = z
  .object({ siteId: z.uuid(), siteName: z.string(), date: day, start: time, end: time })
  .openapi('StopSummary');

export const OrderSummary = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: OrderStatus,
    version: z.number().int(),
    customer: OrderCustomer.nullable(),
    customerReference: z.string().nullable(),
    firstPickup: StopSummary.nullable(),
    lastDelivery: StopSummary.nullable(),
    pickups: z.number().int(),
    deliveries: z.number().int(),
    totals: Totals,
    requirements: z.array(Requirement),
    warnings: z.array(Warning),
    review: z.array(Issue),
  })
  .openapi('OrderSummary');

export const OrderList = z
  .object({
    day,
    counts: z.object({
      'to-plan': z.number().int(),
      'to-review': z.number().int(),
      cancelled: z.number().int(),
    }),
    orders: z.array(OrderSummary),
  })
  .openapi('OrderList');

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const OrderQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(orderStatusFilters).optional(),
  cancelled: flag,
  /** First pickup on or after; today by default. */
  from: day.optional(),
  to: day.optional(),
  customer: z.uuid().optional(),
});

const ChangeValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const OrderChange = z
  .object({
    kind: z.enum([
      'header',
      'stop-added',
      'stop-removed',
      'stop-changed',
      'line-added',
      'line-removed',
      'line-changed',
    ]),
    field: z.string().nullable(),
    stopKind: StopKind.nullable(),
    site: z.string().nullable(),
    line: z.number().int().nullable(),
    description: z.string().nullable(),
    from: ChangeValue,
    to: ChangeValue,
    goods: z
      .object({
        quantity: z.number().int(),
        packaging: Packaging,
        weightKg: z.number().int(),
        temperatureMin: z.number().int().nullable(),
        temperatureMax: z.number().int().nullable(),
      })
      .nullable(),
  })
  .openapi('OrderChange');

const EventBase = { id: z.uuid(), at: instant, authorId: z.uuid().nullable() };

export const OrderEvent = z
  .discriminatedUnion('kind', [
    z.object({
      ...EventBase,
      kind: z.literal('created'),
      origin: z.enum(orderOrigins),
      status: OrderStatus,
      source: z.string().nullable(),
      /** The order it was duplicated or split from; null before it was recorded. */
      sourceId: z.uuid().nullable(),
      fileName: z.string().nullable(),
      fileLines: z.array(z.number().int()),
    }),
    z.object({ ...EventBase, kind: z.literal('changed'), changes: z.array(OrderChange) }),
    /** Lines of this order, numbered from 1 as they were, moved to the order `other`. */
    z.object({
      ...EventBase,
      kind: z.literal('split'),
      other: z.string(),
      otherId: z.uuid(),
      lines: z.array(z.number().int()),
    }),
    z.object({
      ...EventBase,
      kind: z.literal('status'),
      from: OrderStatus,
      to: OrderStatus,
      reason: z.string().nullable(),
    }),
  ])
  .openapi('OrderEvent');

export const OrderHistory = z.object({ events: z.array(OrderEvent) }).openapi('OrderHistory');

export const SplitOrders = z.object({ kept: Order, moved: Order }).openapi('SplitOrders');

const ImportWarning = z
  .object({
    code: z.enum([...orderWarningCodes, 'no-reference']),
    stopId: z.string().nullable(),
    params: Params,
  })
  .openapi('OrderImportWarning');

export const OrderImportCheck = z
  .object({
    problem: z
      .object({ code: z.string(), params: z.record(z.string(), z.unknown()).optional() })
      .nullable(),
    rows: z.array(
      z.object({
        line: z.number().int(),
        cells: z.record(z.string(), z.string()),
        issues: z.array(Issue),
      }),
    ),
    orders: z.array(
      z.object({
        reference: z.string().nullable(),
        customer: z.object({ code: z.string(), name: z.string() }).nullable(),
        lines: z.array(z.number().int()),
        pickups: z.number().int(),
        deliveries: z.number().int(),
        goodsLines: z.number().int(),
        result: z.enum(['ready', 'to-review', 'errors']),
        warnings: z.array(ImportWarning),
        review: z.array(Issue),
      }),
    ),
    summary: z.object({
      lines: z.number().int(),
      orders: z.number().int(),
      ready: z.number().int(),
      toReview: z.number().int(),
      withErrors: z.number().int(),
    }),
    ready: z.boolean(),
  })
  .openapi('OrderImportCheck');
