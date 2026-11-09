import { blank, type Issue } from './issue.ts';
import { formatMinutes, type OpeningRange } from './opening-hours.ts';
import { type Period, periodOf } from './period.ts';
import type { SiteDetails } from './site.ts';
import { Temporal } from './temporal.ts';

// SPEC-004: an order is one pickup and n deliveries, or n pickups and one delivery, with its
// goods lines. The rules here run in the form, in the API and in the import alike.

export const stopKinds = ['pickup', 'delivery'] as const;
export type StopKind = (typeof stopKinds)[number];

export const packagings = ['euro-pallet', 'pallet', 'parcel', 'bulk'] as const;
export type Packaging = (typeof packagings)[number];

export const adrClasses = [
  '1',
  '2',
  '3',
  '4.1',
  '4.2',
  '4.3',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7',
  '8',
  '9',
] as const;
export type AdrClass = (typeof adrClasses)[number];

/** Planned, in progress and delivered come with the planning (issue #9). */
export const orderStatuses = ['to-plan', 'to-review', 'cancelled'] as const;
export type OrderStatus = (typeof orderStatuses)[number];

/** The usual payload of a semi-trailer, and the length of its deck in decimetres. */
export const semiTrailerPayloadKg = 25_000;
export const semiTrailerFloorDm = 136;

/** The temperatures a goods line may ask for, in °C. */
export const temperatureLimits = { min: -30, max: 30 } as const;

/**
 * A stop of an order. The slot is a date and two times in the site's time zone, in minutes since
 * midnight; an end earlier than the start falls on the next day. Each part may be missing while
 * the order is being entered.
 */
export type OrderStop = {
  /** The stop's own id, which goods lines name; a new stop has a key the form chose. */
  readonly id: string;
  readonly kind: StopKind;
  readonly siteId: string;
  readonly date: Temporal.PlainDate | null;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly bookingMade: boolean;
  readonly bookingReference: string | null;
};

export type GoodsLine = {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly packaging: Packaging;
  readonly weightKg: number;
  /** Floor metres, in decimetres: 1.6 m is 16. */
  readonly floorDm: number | null;
  readonly unNumber: string | null;
  readonly adrClass: AdrClass | null;
  readonly temperatureMin: number | null;
  readonly temperatureMax: number | null;
  readonly fromStopId: string;
  readonly toStopId: string;
};

export type OrderDetails = {
  readonly customerId: string;
  readonly customerReference: string | null;
  readonly notes: string | null;
  readonly bodyTypeId: string | null;
  readonly sideLoading: boolean;
  readonly tailLift: boolean;
  readonly stops: readonly OrderStop[];
  readonly lines: readonly GoodsLine[];
};

/** What the rules of an order need to know of a site. */
export type OrderSite = Pick<
  SiteDetails,
  | 'name'
  | 'locatedBy'
  | 'openings'
  | 'bookingRequired'
  | 'loadingDock'
  | 'protectiveEquipmentIds'
  | 'maxLengthCm'
  | 'maxWeightKg'
  | 'semiTrailersAccepted'
> & { readonly id: string; readonly timeZone: string };

export type OrderSites = ReadonlyMap<string, OrderSite>;

export type LocalSlot = {
  readonly date: Temporal.PlainDate;
  readonly startMinute: number;
  readonly endMinute: number;
};

const day = 24 * 60;

/** The local slot of a stop, when it is complete. */
export function slotOfStop(stop: OrderStop): LocalSlot | null {
  if (!stop.date || stop.startMinute === null || stop.endMinute === null) return null;
  return { date: stop.date, startMinute: stop.startMinute, endMinute: stop.endMinute };
}

/** Minutes from the start of the slot's date to its end: past 1,440 on the next day. */
const endOffset = (slot: LocalSlot) =>
  slot.endMinute <= slot.startMinute ? slot.endMinute + day : slot.endMinute;

function at(date: Temporal.PlainDate, minute: number, timeZone: string): Temporal.Instant {
  const days = Math.floor(minute / day);
  const rest = minute - days * day;
  return date
    .add({ days })
    .toZonedDateTime({
      timeZone,
      plainTime: new Temporal.PlainTime(Math.floor(rest / 60), rest % 60),
    })
    .toInstant();
}

/** Rule 3: the slot as instants, read in the site's time zone. */
export function slotPeriod(slot: LocalSlot, timeZone: string): Period {
  return periodOf(
    at(slot.date, slot.startMinute, timeZone),
    at(slot.date, endOffset(slot), timeZone),
  );
}

/** The local slot of a stored period, in the site's time zone. */
export function slotOf(period: Period, timeZone: string): LocalSlot {
  const start = period.start.toZonedDateTimeISO(timeZone);
  const end = period.end.toZonedDateTimeISO(timeZone);
  return {
    date: start.toPlainDate(),
    startMinute: start.hour * 60 + start.minute,
    endMinute: end.hour * 60 + end.minute,
  };
}

/** "2026-11-09 11:00–12:00", as the history keeps it. */
export function slotText(slot: LocalSlot | null): string | null {
  if (!slot) return null;
  return `${slot.date.toString()} ${formatMinutes(slot.startMinute)}–${formatMinutes(slot.endMinute % day)}`;
}

export type OrderShape = 'one-pickup' | 'one-delivery' | 'several-both' | 'incomplete';

/** Rule 1. One pickup and one delivery counts as one pickup. */
export function orderShape(order: Pick<OrderDetails, 'stops'>): OrderShape {
  const pickups = order.stops.filter((s) => s.kind === 'pickup').length;
  const deliveries = order.stops.length - pickups;
  if (pickups === 0 || deliveries === 0) return 'incomplete';
  if (pickups === 1) return 'one-pickup';
  if (deliveries === 1) return 'one-delivery';
  return 'several-both';
}

/**
 * SPEC-004, Splitting an order: the lines named go to a new order, the others stay. Each group
 * takes the stops its lines use, in their order; a stop both use goes to both, keeping its id,
 * so the new order gives its own a new one when it is stored. The header goes to both.
 */
export function splitOrder(
  order: OrderDetails,
  movedLineIds: readonly string[],
):
  | { readonly ok: true; readonly kept: OrderDetails; readonly moved: OrderDetails }
  | { readonly ok: false; readonly issues: readonly Issue[] } {
  const unknown = movedLineIds.find((id) => !order.lines.some((line) => line.id === id));
  if (unknown !== undefined) {
    return {
      ok: false,
      issues: [{ field: 'lines', code: 'unknown-value', params: { value: unknown } }],
    };
  }
  const moving = new Set(movedLineIds);
  const group = (lines: readonly GoodsLine[]): OrderDetails => ({
    ...order,
    stops: order.stops.filter((stop) =>
      lines.some((line) => line.fromStopId === stop.id || line.toStopId === stop.id),
    ),
    lines,
  });
  const kept = order.lines.filter((line) => !moving.has(line.id));
  const moved = order.lines.filter((line) => moving.has(line.id));
  if (kept.length === 0 || moved.length === 0) {
    return { ok: false, issues: [{ field: 'lines', code: 'split-group-empty' }] };
  }
  return { ok: true, kept: group(kept), moved: group(moved) };
}

export type OrderCheck = {
  /** The order cannot be saved: a missing field, a delivery before its pickup. */
  readonly blocking: readonly Issue[];
  /** The order can only be kept to review: several pickups and deliveries, a site not located. */
  readonly review: readonly Issue[];
};

const positiveInteger = (value: number) => Number.isInteger(value) && value > 0;

function checkLine(line: GoodsLine, index: number, order: OrderDetails): Issue[] {
  const field = (name: string) => `lines.${index}.${name}`;
  const issues: Issue[] = [];
  if (blank(line.description)) issues.push({ field: field('description'), code: 'required' });
  if (!positiveInteger(line.quantity)) {
    issues.push({ field: field('quantity'), code: 'value-not-positive' });
  }
  if (!positiveInteger(line.weightKg)) {
    issues.push({ field: field('weightKg'), code: 'value-not-positive' });
  }
  if (line.floorDm !== null && !positiveInteger(line.floorDm)) {
    issues.push({ field: field('floorDm'), code: 'value-not-positive' });
  }
  if (line.unNumber !== null && !/^\d{4}$/.test(line.unNumber)) {
    issues.push({ field: field('unNumber'), code: 'un-number-invalid' });
  } else if (line.unNumber === null && line.adrClass !== null) {
    issues.push({ field: field('unNumber'), code: 'required' });
  }
  if (line.unNumber !== null && line.adrClass === null) {
    issues.push({ field: field('adrClass'), code: 'required' });
  }
  const inRange = (t: number) =>
    Number.isInteger(t) && t >= temperatureLimits.min && t <= temperatureLimits.max;
  const { temperatureMin: min, temperatureMax: max } = line;
  const params = { min: temperatureLimits.min, max: temperatureLimits.max };
  if (min !== null && !inRange(min)) {
    issues.push({ field: field('temperatureMin'), code: 'temperature-out-of-range', params });
  } else if (min === null && max !== null) {
    issues.push({ field: field('temperatureMin'), code: 'required' });
  }
  if (max !== null && !inRange(max)) {
    issues.push({ field: field('temperatureMax'), code: 'temperature-out-of-range', params });
  } else if (max === null && min !== null) {
    issues.push({ field: field('temperatureMax'), code: 'required' });
  } else if (min !== null && max !== null && inRange(min) && min > max) {
    issues.push({ field: field('temperatureMax'), code: 'temperature-range-invalid' });
  }
  const stopOf = (id: string) => order.stops.find((s) => s.id === id);
  if (stopOf(line.fromStopId)?.kind !== 'pickup') {
    issues.push({ field: field('fromStopId'), code: 'required' });
  }
  if (stopOf(line.toStopId)?.kind !== 'delivery') {
    issues.push({ field: field('toStopId'), code: 'required' });
  }
  return issues;
}

/** Rules 1 to 4. */
export function checkOrder(order: OrderDetails, sites: OrderSites): OrderCheck {
  const blocking: Issue[] = [];
  const review: Issue[] = [];
  if (blank(order.customerId)) blocking.push({ field: 'customerId', code: 'required' });
  if (!order.stops.some((s) => s.kind === 'pickup')) {
    blocking.push({ field: 'stops', code: 'pickup-required' });
  }
  if (!order.stops.some((s) => s.kind === 'delivery')) {
    blocking.push({ field: 'stops', code: 'delivery-required' });
  }
  if (order.lines.length === 0) blocking.push({ field: 'lines', code: 'required' });

  const linked = (stop: OrderStop, line: GoodsLine) =>
    stop.kind === 'pickup' ? line.fromStopId === stop.id : line.toStopId === stop.id;
  for (const [index, stop] of order.stops.entries()) {
    const field = (name: string) => `stops.${index}.${name}`;
    const site = sites.get(stop.siteId);
    if (blank(stop.siteId)) blocking.push({ field: field('siteId'), code: 'required' });
    else if (site?.locatedBy === 'not-located') {
      review.push({
        field: field('siteId'),
        code: 'site-not-located',
        params: { site: site.name },
      });
    }
    if (!stop.date) blocking.push({ field: field('date'), code: 'required' });
    if (stop.startMinute === null) blocking.push({ field: field('start'), code: 'required' });
    if (stop.endMinute === null) blocking.push({ field: field('end'), code: 'required' });
    else if (stop.endMinute === stop.startMinute) {
      blocking.push({ field: field('end'), code: 'end-not-after-start' });
    }
    if (order.lines.length > 0 && !order.lines.some((line) => linked(stop, line))) {
      blocking.push({ field: field('siteId'), code: 'stop-without-goods' });
    }
  }
  for (const [index, line] of order.lines.entries())
    blocking.push(...checkLine(line, index, order));

  blocking.push(...deliveriesBeforePickups(order, sites));

  if (orderShape(order) === 'several-both') {
    const pickups = order.stops.filter((s) => s.kind === 'pickup').length;
    review.unshift({
      field: 'stops',
      code: 'several-pickups-and-deliveries',
      params: { pickups, deliveries: order.stops.length - pickups },
    });
  }
  return { blocking, review };
}

function periodOfStop(stop: OrderStop, sites: OrderSites): Period | null {
  const slot = slotOfStop(stop);
  const site = sites.get(stop.siteId);
  if (!slot || !site || slot.startMinute === slot.endMinute) return null;
  return slotPeriod(slot, site.timeZone);
}

/** Rule 4: a delivery ends after the start of the pickup of each line it receives. */
function deliveriesBeforePickups(order: OrderDetails, sites: OrderSites): Issue[] {
  const issues: Issue[] = [];
  for (const [index, delivery] of order.stops.entries()) {
    if (delivery.kind !== 'delivery') continue;
    const end = periodOfStop(delivery, sites)?.end;
    if (!end) continue;
    const pickupIds = new Set(
      order.lines.filter((l) => l.toStopId === delivery.id).map((l) => l.fromStopId),
    );
    for (const pickup of order.stops) {
      if (pickup.kind !== 'pickup' || !pickupIds.has(pickup.id)) continue;
      const start = periodOfStop(pickup, sites)?.start;
      if (start && Temporal.Instant.compare(end, start) <= 0) {
        issues.push({
          field: `stops.${index}.end`,
          code: 'delivery-before-pickup',
          params: {
            site: sites.get(pickup.siteId)?.name ?? '',
            start: formatMinutes(pickup.startMinute ?? 0),
          },
        });
      }
    }
  }
  return issues;
}

export type OrderTotals = {
  readonly weightKg: number;
  readonly floorDm: number;
  readonly quantities: Readonly<Record<Packaging, number>>;
};

/** A value being entered counts once it is a whole number above zero; until then, as nothing. */
const counted = (value: number | null) =>
  value !== null && Number.isInteger(value) && value > 0 ? value : 0;

/**
 * Rule 5: with one pickup everything is on board when leaving, with one delivery when arriving,
 * so the load is the sum of the lines.
 */
export function orderTotals(order: Pick<OrderDetails, 'lines'>): OrderTotals {
  const quantities: Record<Packaging, number> = { 'euro-pallet': 0, pallet: 0, parcel: 0, bulk: 0 };
  let weightKg = 0;
  let floorDm = 0;
  for (const line of order.lines) {
    quantities[line.packaging] += counted(line.quantity);
    weightKg += counted(line.weightKg);
    floorDm += counted(line.floorDm);
  }
  return { weightKg, floorDm, quantities };
}

export const orderWarningCodes = [
  'site-closed',
  'outside-opening-hours',
  'booking-to-make',
  'temperature-conflict',
  'weight-over',
  'floor-over',
  'reference-used',
] as const;

/** What might go wrong: shown on the order and in the list, never blocking. */
export type OrderWarning = {
  readonly code: (typeof orderWarningCodes)[number];
  /** The stop it is about; null for the whole order. */
  readonly stopId: string | null;
  readonly params: Readonly<Record<string, string | number>>;
};

/** The lines with a temperature, numbered from 1, and the range they all fit, if any. */
function chilledLines(order: Pick<OrderDetails, 'lines'>) {
  const lines = order.lines.flatMap((line, index) =>
    line.temperatureMin !== null && line.temperatureMax !== null
      ? [{ number: index + 1, min: line.temperatureMin, max: line.temperatureMax }]
      : [],
  );
  const min = Math.max(...lines.map((l) => l.min));
  const max = Math.min(...lines.map((l) => l.max));
  return { lines, common: lines.length > 0 && min <= max ? { min, max } : null };
}

type Interval = { start: number; end: number };

/** Opening intervals around the slot's date, in minutes from that date's midnight. */
function openIntervals(openings: readonly OpeningRange[], date: Temporal.PlainDate): Interval[] {
  const intervals: Interval[] = [];
  for (let offset = -1; offset <= 2; offset += 1) {
    const weekday = ((((date.dayOfWeek - 1 + offset) % 7) + 7) % 7) + 1;
    for (const range of openings) {
      if (range.weekday !== weekday) continue;
      intervals.push({
        start: range.startMinute + offset * day,
        end: range.endMinute + offset * day,
      });
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Whether the slot fits the opening hours; else the closure it falls in. */
function openingWarning(stop: OrderStop, site: OrderSite): OrderWarning | null {
  const slot = slotOfStop(stop);
  if (!slot || slot.startMinute === slot.endMinute) return null;
  const start = slot.startMinute;
  const end = endOffset(slot);
  const open = openIntervals(site.openings, slot.date);
  if (open.some((i) => i.start <= start && end <= i.end)) return null;

  // The first closed minute of the slot, and the closure around it.
  const closed = open.find((i) => i.start <= start && start < i.end)?.end ?? start;
  const closesAt = Math.max(...open.filter((i) => i.end <= closed).map((i) => i.end));
  const opensAt = Math.min(...open.filter((i) => i.start > closed).map((i) => i.start));
  const sameDay =
    Number.isFinite(closesAt) &&
    Number.isFinite(opensAt) &&
    Math.floor(closesAt / day) === Math.floor(opensAt / day) &&
    closesAt % day !== 0;
  if (sameDay) {
    const shift = Math.floor(closesAt / day);
    return {
      code: 'site-closed',
      stopId: stop.id,
      params: {
        site: site.name,
        weekday: slot.date.add({ days: shift }).dayOfWeek,
        start: formatMinutes(closesAt - shift * day),
        end: formatMinutes(opensAt - shift * day),
      },
    };
  }
  return {
    code: 'outside-opening-hours',
    stopId: stop.id,
    params: {
      site: site.name,
      weekday: slot.date.dayOfWeek,
      start: formatMinutes(slot.startMinute),
      end: formatMinutes(slot.endMinute % day),
    },
  };
}

/**
 * The warnings of an order. `sameReference` holds the numbers of the customer's other orders,
 * not cancelled, with the same reference.
 */
export function orderWarnings(
  order: OrderDetails,
  sites: OrderSites,
  sameReference: readonly string[],
): OrderWarning[] {
  const warnings: OrderWarning[] = [];
  for (const stop of order.stops) {
    const site = sites.get(stop.siteId);
    if (!site) continue;
    const opening = openingWarning(stop, site);
    if (opening) warnings.push(opening);
    if (site.bookingRequired && !stop.bookingMade) {
      warnings.push({ code: 'booking-to-make', stopId: stop.id, params: { site: site.name } });
    }
  }
  // Goods kept at temperatures that do not meet need a multi-temperature body or two orders.
  const chilled = chilledLines(order);
  if (chilled.lines.length > 0 && !chilled.common) {
    warnings.push({
      code: 'temperature-conflict',
      stopId: null,
      params: { lines: chilled.lines.map((l) => l.number).join(', ') },
    });
  }
  const totals = orderTotals(order);
  if (totals.weightKg > semiTrailerPayloadKg) {
    warnings.push({
      code: 'weight-over',
      stopId: null,
      params: { weightKg: totals.weightKg, maxKg: semiTrailerPayloadKg },
    });
  }
  if (totals.floorDm > semiTrailerFloorDm) {
    warnings.push({
      code: 'floor-over',
      stopId: null,
      params: { floorDm: totals.floorDm, maxDm: semiTrailerFloorDm },
    });
  }
  if (sameReference.length > 0) {
    warnings.push({
      code: 'reference-used',
      stopId: null,
      params: { orders: sameReference.join(', ') },
    });
  }
  return warnings;
}

export const requirementCodes = [
  'adr',
  'temperature',
  'atp',
  'body-type',
  'side-loading',
  'tail-lift',
  'tail-lift-or-crane',
  'protective-equipment',
  'max-length',
  'max-weight',
  'no-semi-trailer',
] as const;
export type RequirementCode = (typeof requirementCodes)[number];

/** Where a requirement comes from: goods lines (numbered from 1), the order, or sites. */
export type RequirementSource = {
  readonly kind: 'lines' | 'order' | 'sites';
  readonly lines: readonly number[];
  readonly siteIds: readonly string[];
};

/**
 * What a unit must offer to run the order. `ids` names entries of company lists: the body type,
 * the protective equipment.
 */
export type OrderRequirement = {
  readonly code: RequirementCode;
  readonly params: Readonly<Record<string, string | number>>;
  readonly ids: readonly string[];
  readonly source: RequirementSource;
};

const fromLines = (lines: number[]): RequirementSource => ({ kind: 'lines', lines, siteIds: [] });
const fromOrder: RequirementSource = { kind: 'order', lines: [], siteIds: [] };
const fromSites = (siteIds: string[]): RequirementSource => ({
  kind: 'sites',
  lines: [],
  siteIds,
});
const requirement = (
  code: RequirementCode,
  source: RequirementSource,
  params: Record<string, string | number> = {},
  ids: string[] = [],
): OrderRequirement => ({ code, params, ids, source });

/** The sites of the order's stops, once each, in the order of the stops. */
function sitesOf(order: OrderDetails, sites: OrderSites): OrderSite[] {
  const seen = new Set<string>();
  return order.stops.flatMap((stop) => {
    const site = sites.get(stop.siteId);
    if (!site || seen.has(site.id)) return [];
    seen.add(site.id);
    return [site];
  });
}

/** The strictest limit among the sites, and the sites that set it. */
function strictest(
  code: 'max-length' | 'max-weight',
  param: 'cm' | 'kg',
  limits: { site: OrderSite; limit: number | null }[],
): OrderRequirement[] {
  const set = limits.flatMap(({ site, limit }) => (limit === null ? [] : [{ site, limit }]));
  if (set.length === 0) return [];
  const lowest = Math.min(...set.map((s) => s.limit));
  const siteIds = set.filter((s) => s.limit === lowest).map((s) => s.site.id);
  return [requirement(code, fromSites(siteIds), { [param]: lowest })];
}

/** The requirements of the order, each with where it comes from. */
export function orderRequirements(order: OrderDetails, sites: OrderSites): OrderRequirement[] {
  const requirements: OrderRequirement[] = [];
  const numbered = order.lines.map((line, index) => ({ line, number: index + 1 }));

  const dangerous = numbered.filter(({ line }) => line.adrClass !== null || line.unNumber !== null);
  if (dangerous.length > 0) {
    const classes = adrClasses.filter((c) => dangerous.some(({ line }) => line.adrClass === c));
    requirements.push(
      requirement('adr', fromLines(dangerous.map((d) => d.number)), {
        classes: classes.join(', '),
      }),
    );
  }

  // The tightest range the lines share; with none, each range with its lines (and a warning).
  const chilled = chilledLines(order);
  if (chilled.lines.length > 0) {
    if (chilled.common) {
      requirements.push(
        requirement('temperature', fromLines(chilled.lines.map((l) => l.number)), {
          ...chilled.common,
        }),
      );
    } else {
      const ranges = new Map<string, { min: number; max: number; lines: number[] }>();
      for (const l of chilled.lines) {
        const key = `${l.min}/${l.max}`;
        const range = ranges.get(key) ?? { min: l.min, max: l.max, lines: [] };
        range.lines.push(l.number);
        ranges.set(key, range);
      }
      for (const { min, max, lines } of ranges.values()) {
        requirements.push(requirement('temperature', fromLines(lines), { min, max }));
      }
    }
    requirements.push(requirement('atp', fromLines(chilled.lines.map((l) => l.number))));
  }

  if (order.bodyTypeId)
    requirements.push(requirement('body-type', fromOrder, {}, [order.bodyTypeId]));
  if (order.sideLoading) requirements.push(requirement('side-loading', fromOrder));
  if (order.tailLift) requirements.push(requirement('tail-lift', fromOrder));

  const used = sitesOf(order, sites);
  const withoutDock = used.filter((s) => !s.loadingDock).map((s) => s.id);
  if (withoutDock.length > 0)
    requirements.push(requirement('tail-lift-or-crane', fromSites(withoutDock)));

  const equipped = used.filter((s) => s.protectiveEquipmentIds.length > 0);
  if (equipped.length > 0) {
    const ids = [...new Set(equipped.flatMap((s) => s.protectiveEquipmentIds))];
    requirements.push(
      requirement('protective-equipment', fromSites(equipped.map((s) => s.id)), {}, ids),
    );
  }
  requirements.push(
    ...strictest(
      'max-length',
      'cm',
      used.map((site) => ({ site, limit: site.maxLengthCm })),
    ),
    ...strictest(
      'max-weight',
      'kg',
      used.map((site) => ({ site, limit: site.maxWeightKg })),
    ),
  );
  const noSemi = used.filter((s) => !s.semiTrailersAccepted).map((s) => s.id);
  if (noSemi.length > 0) requirements.push(requirement('no-semi-trailer', fromSites(noSemi)));
  return requirements;
}

export type ChangeValue = string | number | boolean | null;

/** The goods of a line added or removed, for the history. */
export type ChangedGoods = Pick<
  GoodsLine,
  'quantity' | 'packaging' | 'weightKg' | 'temperatureMin' | 'temperatureMax'
>;

/**
 * One change of an order, as its history keeps it: names and slots are written as they were, so
 * that the entry still reads right once a site is renamed.
 */
export type OrderChange = {
  readonly kind:
    | 'header'
    | 'stop-added'
    | 'stop-removed'
    | 'stop-changed'
    | 'line-added'
    | 'line-removed'
    | 'line-changed';
  readonly field: string | null;
  readonly stopKind: StopKind | null;
  /** The site of the stop, by name. */
  readonly site: string | null;
  /** The number of the line, from 1. */
  readonly line: number | null;
  readonly description: string | null;
  readonly from: ChangeValue;
  readonly to: ChangeValue;
  readonly goods: ChangedGoods | null;
};

const change = (values: Partial<OrderChange> & Pick<OrderChange, 'kind'>): OrderChange => ({
  field: null,
  stopKind: null,
  site: null,
  line: null,
  description: null,
  from: null,
  to: null,
  goods: null,
  ...values,
});

const goodsOf = (line: GoodsLine): ChangedGoods => ({
  quantity: line.quantity,
  packaging: line.packaging,
  weightKg: line.weightKg,
  temperatureMin: line.temperatureMin,
  temperatureMax: line.temperatureMax,
});

const lineFields = [
  'description',
  'quantity',
  'packaging',
  'weightKg',
  'floorDm',
  'unNumber',
  'adrClass',
  'temperatureMin',
  'temperatureMax',
] as const;

/**
 * What changed between two versions of an order (criterion 14). Stops and lines are matched by
 * their id; `siteName` and `customerName` name what the history shows.
 */
export function orderChanges(
  before: OrderDetails,
  after: OrderDetails,
  siteName: (id: string) => string,
  customerName: (id: string) => string = (id) => id,
): OrderChange[] {
  const changes: OrderChange[] = [];
  const header = (field: string, from: ChangeValue, to: ChangeValue) => {
    if (from !== to) changes.push(change({ kind: 'header', field, from, to }));
  };
  if (before.customerId !== after.customerId) {
    header('customer', customerName(before.customerId), customerName(after.customerId));
  }
  header('customerReference', before.customerReference, after.customerReference);
  header('notes', before.notes, after.notes);
  header('bodyType', before.bodyTypeId, after.bodyTypeId);
  header('sideLoading', before.sideLoading, after.sideLoading);
  header('tailLift', before.tailLift, after.tailLift);

  const slot = (stop: OrderStop) => slotText(slotOfStop(stop));
  for (const stop of after.stops) {
    const old = before.stops.find((s) => s.id === stop.id);
    const about = { stopKind: stop.kind, site: siteName(stop.siteId) };
    if (!old) {
      changes.push(change({ kind: 'stop-added', ...about, to: slot(stop) }));
      continue;
    }
    const changed = (field: string, from: ChangeValue, to: ChangeValue) => {
      if (from !== to) changes.push(change({ kind: 'stop-changed', ...about, field, from, to }));
    };
    if (old.siteId !== stop.siteId) changed('site', siteName(old.siteId), siteName(stop.siteId));
    changed('slot', slot(old), slot(stop));
    changed('bookingMade', old.bookingMade, stop.bookingMade);
    changed('bookingReference', old.bookingReference, stop.bookingReference);
  }
  for (const stop of before.stops) {
    if (after.stops.some((s) => s.id === stop.id)) continue;
    changes.push(
      change({
        kind: 'stop-removed',
        stopKind: stop.kind,
        site: siteName(stop.siteId),
        from: slot(stop),
      }),
    );
  }

  const stopSite = (order: OrderDetails, id: string) => {
    const stop = order.stops.find((s) => s.id === id);
    return stop ? siteName(stop.siteId) : null;
  };
  for (const [index, line] of after.lines.entries()) {
    const old = before.lines.find((l) => l.id === line.id);
    const about = { line: index + 1, description: line.description };
    if (!old) {
      changes.push(change({ kind: 'line-added', ...about, goods: goodsOf(line) }));
      continue;
    }
    for (const field of lineFields) {
      if (old[field] !== line[field]) {
        changes.push(
          change({ kind: 'line-changed', ...about, field, from: old[field], to: line[field] }),
        );
      }
    }
    const ends: [string, string | null, string | null][] = [
      ['fromStop', stopSite(before, old.fromStopId), stopSite(after, line.fromStopId)],
      ['toStop', stopSite(before, old.toStopId), stopSite(after, line.toStopId)],
    ];
    for (const [field, from, to] of ends) {
      if (from !== to) changes.push(change({ kind: 'line-changed', ...about, field, from, to }));
    }
  }
  for (const [index, line] of before.lines.entries()) {
    if (after.lines.some((l) => l.id === line.id)) continue;
    changes.push(
      change({
        kind: 'line-removed',
        line: index + 1,
        description: line.description,
        goods: goodsOf(line),
      }),
    );
  }
  return changes;
}
