import type { OrderStatus, OrderTotals, Packaging, RequirementCode, StopKind } from '@timon/domain';
import type {
  IssueJson,
  ListItemJson,
  OrderEventJson,
  OrderRequirementJson,
  OrderWarningJson,
  ReferenceListsJson,
} from '@timon/http';
import type { Tone } from '@timon/ui';
import { equipmentLabel, weekdayName } from '../customers/customer-labels.ts';
import { capitalise, entryLabel, formatDate, formatNumber, inSentence } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';

// The codes of SPEC-004 as text, in the interface's language.

type Message = () => string;

export const statusLabel: Record<OrderStatus, Message> = {
  'to-plan': m.order_status_to_plan,
  'to-review': m.order_status_to_review,
  cancelled: m.order_status_cancelled,
};

export const statusTone: Record<OrderStatus, Tone> = {
  'to-plan': 'petrol',
  'to-review': 'warning',
  cancelled: 'neutral',
};

export const stopKindLabel: Record<StopKind, Message> = {
  pickup: m.stop_pickup,
  delivery: m.stop_delivery,
};

export function packagingLabel(packaging: Packaging, count: number): string {
  switch (packaging) {
    case 'euro-pallet':
      return m.packaging_euro_pallet({ count });
    case 'pallet':
      return m.packaging_pallet({ count });
    case 'parcel':
      return m.packaging_parcel({ count });
    case 'bulk':
      return m.packaging_bulk();
  }
}

/** "3,800 kg" */
export const kilograms = (kg: number) => m.unit_kg({ kg: formatNumber(kg) });

/** Floor metres from decimetres: "5.4 floor metres", the decimal in the reader's language. */
export const floorMetres = (dm: number) =>
  new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    dm / 10,
  );

/** "+2 to +6 °C" */
export function temperatureRange(min: number, max: number): string {
  const sign = (t: number) => (t > 0 ? `+${t}` : String(t));
  return m.temperature_range({ min: sign(min), max: sign(max) });
}

/**
 * "26 Euro pallets · 14,300 kg": pallets of both kinds count as pallets, Euro pallets alone keep
 * their name; parcels apart; bulk shows its weight only.
 */
export function goodsSummary(totals: OrderTotals): string {
  return goodsParts(totals).join(' · ');
}

/** The parts of the goods summary, each kept on one line in a table. */
export function goodsParts(totals: OrderTotals): string[] {
  const q = totals.quantities;
  const parts: string[] = [];
  if (q['euro-pallet'] > 0 && q.pallet === 0) {
    parts.push(packagingLabel('euro-pallet', q['euro-pallet']));
  } else if (q.pallet + q['euro-pallet'] > 0) {
    parts.push(packagingLabel('pallet', q.pallet + q['euro-pallet']));
  }
  if (q.parcel > 0) parts.push(packagingLabel('parcel', q.parcel));
  parts.push(kilograms(totals.weightKg));
  return parts;
}

/**
 * The requirements the list shows, as on its mockup: those of the goods and the order, and a tail
 * lift or crane for a site without a dock. Protective equipment and access limits show on the
 * order itself.
 */
export const listedRequirements: readonly RequirementCode[] = [
  'adr',
  'temperature',
  'atp',
  'body-type',
  'side-loading',
  'tail-lift',
  'tail-lift-or-crane',
];

/** "09/11 05:00–06:30": short date and slot, for the list. */
export function shortSlot(date: string, start: string, end: string): string {
  return `${formatDate(date).slice(0, 5)} ${start}–${end}`;
}

/** The label of a requirement, as the list and the form show it. */
export function requirementLabel(
  r: Pick<OrderRequirementJson, 'code' | 'params' | 'ids'>,
  lists: ReferenceListsJson | undefined,
): string {
  const p = r.params;
  const labels: Record<RequirementCode, () => string> = {
    adr: () => m.requirement_adr({ classes: String(p.classes ?? '') }),
    temperature: () => temperatureRange(Number(p.min), Number(p.max)),
    atp: m.requirement_atp,
    'body-type': () =>
      entryLabel(lists?.bodyTypes.find((b) => b.id === r.ids[0])) || m.requirement_body_type(),
    'side-loading': m.requirement_side_loading,
    'tail-lift': m.requirement_tail_lift,
    'tail-lift-or-crane': m.requirement_tail_lift_or_crane,
    'protective-equipment': () =>
      r.ids
        .map((id) =>
          equipmentLabel(
            lists?.protectiveEquipment.find((e) => e.id === id) as ListItemJson | undefined,
            true,
          ),
        )
        .join(' · '),
    'max-length': () => m.requirement_max_length({ metres: formatNumber(Number(p.cm) / 100) }),
    'max-weight': () => m.requirement_max_weight({ weight: kilograms(Number(p.kg)) }),
    'no-semi-trailer': m.requirement_no_semi_trailer,
  };
  return labels[r.code]();
}

/** Where a requirement comes from: "Lines 1 and 2", "Ticked on the order", the sites. */
export function requirementSource(
  r: OrderRequirementJson,
  siteName: (id: string) => string,
  /** The lines share one range: it is the tightest of theirs. */
  oneRange = true,
): string {
  const { kind, lines, siteIds } = r.source;
  if (kind === 'order') return m.source_order();
  if (kind === 'lines') {
    const numbers = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
      lines.map(String),
    );
    const text =
      lines.length === 1 ? m.source_line({ n: numbers }) : m.source_lines({ lines: numbers });
    if (r.code === 'temperature' && oneRange && lines.length > 1)
      return `${text}, ${m.source_tightest()}`;
    if (r.code === 'atp') return m.source_temperature_goods();
    return text;
  }
  const names = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
    siteIds.map(siteName),
  );
  return r.code === 'protective-equipment' ? m.source_equipment({ sites: names }) : names;
}

/** A warning as a short label, for the list. */
export function warningLabel(w: OrderWarningJson): string {
  const p = w.params;
  switch (w.code) {
    case 'site-closed':
      return m.warning_closed_short({ start: String(p.start), end: String(p.end) });
    case 'outside-opening-hours':
      return m.warning_outside_hours_short();
    case 'booking-to-make':
      return m.warning_booking_short();
    case 'temperature-conflict':
      return m.warning_temperature_short();
    case 'weight-over':
      return kilograms(Number(p.weightKg));
    case 'floor-over':
      return m.warning_floor_short({ metres: floorMetres(Number(p.floorDm)) });
    case 'reference-used':
      return m.warning_reference_short();
  }
}

/** A warning as a sentence, for the form. */
export function warningText(w: OrderWarningJson, stopKind: StopKind | undefined): string {
  const p = w.params;
  const at = stopKind === 'pickup' ? m.pickup_at : m.delivery_at;
  const where = () => capitalise(at({ site: String(p.site) }));
  switch (w.code) {
    case 'site-closed':
      return m.warning_closed({
        where: where(),
        day: weekdayName(Number(p.weekday)),
        start: String(p.start),
        end: String(p.end),
      });
    case 'outside-opening-hours':
      return m.warning_outside_hours({
        where: where(),
        day: weekdayName(Number(p.weekday)),
        start: String(p.start),
        end: String(p.end),
      });
    case 'booking-to-make':
      return m.warning_booking({ where: where() });
    case 'temperature-conflict':
      return m.warning_temperature();
    case 'weight-over':
      return m.warning_weight({
        weight: kilograms(Number(p.weightKg)),
        max: kilograms(Number(p.maxKg)),
      });
    case 'floor-over':
      return m.warning_floor({
        metres: floorMetres(Number(p.floorDm)),
        max: floorMetres(Number(p.maxDm)),
      });
    case 'reference-used':
      return m.warning_reference({ orders: String(p.orders) });
  }
}

/** Why an order is to review, in a few words for the list. */
export function reviewLabel(issue: IssueJson): string {
  const p = issue.params ?? {};
  if (issue.code === 'several-pickups-and-deliveries') {
    return m.review_shape({
      pickups: m.count_pickups({ count: Number(p.pickups) }),
      deliveries: m.count_deliveries({ count: Number(p.deliveries) }),
    });
  }
  if (issue.code === 'site-not-located') return m.review_site_not_located();
  return issue.code;
}

/** "2 pickups · 3 deliveries", the side that is single left out. */
export function stopCounts(pickups: number, deliveries: number): string | null {
  const parts: string[] = [];
  if (pickups > 1) parts.push(m.count_pickups({ count: pickups }));
  if (deliveries > 1) parts.push(m.count_deliveries({ count: deliveries }));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "09/11 10:42" and "2026", as the history shows them. */
export function eventTime(at: string): { time: string; year: string } {
  const date = new Date(at);
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Paris',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    time: `${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`,
    year: part('year'),
  };
}

/** "2026-11-09 11:00–12:00" as kept by the history → "09/11/2026 11:00–12:00". */
export function slotTextLabel(value: unknown): string {
  if (typeof value !== 'string') return m.none();
  const match = /^(\d{4}-\d{2}-\d{2}) (.+)$/.exec(value);
  return match?.[1] ? `${formatDate(match[1])} ${match[2]}` : value;
}

const fieldName: Record<string, Message> = {
  customer: m.field_customer,
  customerReference: m.field_customer_reference,
  notes: m.section_notes,
  bodyType: m.field_body_type,
  sideLoading: m.requirement_side_loading,
  tailLift: m.requirement_tail_lift,
  site: m.col_site,
  slot: m.field_slot,
  bookingMade: m.field_booking_made,
  bookingReference: m.field_booking_reference,
  description: m.field_description,
  quantity: m.field_quantity,
  packaging: m.field_packaging,
  weightKg: m.field_weight,
  floorDm: m.field_floor_metres,
  unNumber: m.field_un_number,
  adrClass: m.field_adr_class,
  temperatureMin: m.field_temperature_min,
  temperatureMax: m.field_temperature_max,
  fromStop: m.field_from_stop,
  toStop: m.field_to_stop,
};

function changeValue(
  field: string | null,
  value: unknown,
  lists: ReferenceListsJson | undefined,
): string {
  if (value === null || value === undefined || value === '') return m.none();
  if (typeof value === 'boolean') return value ? m.yes() : m.no();
  if (field === 'slot') return slotTextLabel(value);
  if (field === 'bodyType') return entryLabel(lists?.bodyTypes.find((b) => b.id === value));
  if (field === 'packaging') return packagingLabel(value as Packaging, 2);
  if (field === 'weightKg') return kilograms(Number(value));
  if (field === 'floorDm') return floorMetres(Number(value));
  return String(value);
}

type Change = Extract<OrderEventJson, { kind: 'changed' }>['changes'][number];

/** One change as a sentence: "Delivery at X: slot 11:00–12:00 to 12:15–13:00." */
export function changeText(change: Change, lists: ReferenceListsJson | undefined): string {
  const field = change.field ? inSentence(fieldName[change.field]?.() ?? change.field) : '';
  const from = changeValue(change.field, change.from, lists);
  const to = changeValue(change.field, change.to, lists);
  const where = () =>
    (change.stopKind === 'pickup' ? m.pickup_at : m.delivery_at)({ site: change.site ?? '' });
  const goods = () =>
    change.goods
      ? [
          packagingLabel(change.goods.packaging, change.goods.quantity),
          kilograms(change.goods.weightKg),
          change.goods.temperatureMin !== null && change.goods.temperatureMax !== null
            ? temperatureRange(change.goods.temperatureMin, change.goods.temperatureMax)
            : null,
        ]
          .filter(Boolean)
          .join(', ')
      : '';
  switch (change.kind) {
    case 'header':
      if (typeof change.to === 'boolean') {
        return m.change_ticked({
          field: capitalise(field),
          ticked: change.to ? m.ticked() : m.unticked(),
        });
      }
      return m.change_field({ field: capitalise(field), from, to });
    case 'stop-added':
      return m.change_stop_added({ where: where(), slot: slotTextLabel(change.to) });
    case 'stop-removed':
      return m.change_stop_removed({ where: where() });
    case 'stop-changed':
      if (change.field === 'bookingMade') {
        return change.to
          ? m.change_booking_made({ where: where() })
          : m.change_booking_undone({ where: where() });
      }
      return m.change_stop({ where: capitalise(where()), field, from, to });
    case 'line-added':
      return m.change_line_added({
        n: change.line ?? 0,
        description: change.description ?? '',
        goods: goods(),
      });
    case 'line-removed':
      return m.change_line_removed({ n: change.line ?? 0, description: change.description ?? '' });
    case 'line-changed':
      return m.change_line({ n: change.line ?? 0, field, from, to });
  }
}

/** The title of a history entry. */
export function eventTitle(event: OrderEventJson): string {
  switch (event.kind) {
    case 'created':
      return {
        hand: m.event_created_hand,
        import: m.event_created_import,
        demo: m.event_created_demo,
        duplicate: m.event_created_duplicate,
      }[event.origin]();
    case 'changed':
      return m.event_changed();
    case 'status':
      return event.to === 'cancelled' ? m.event_cancelled() : m.event_status();
  }
}

/** What a history entry says, sentence by sentence. */
export function eventLines(event: OrderEventJson, lists: ReferenceListsJson | undefined): string[] {
  switch (event.kind) {
    case 'created': {
      const status = m.event_status_is({ status: inSentence(statusLabel[event.status]()) });
      if (event.origin === 'duplicate' && event.source) {
        return [m.event_duplicated_from({ number: event.source }), status];
      }
      if (event.origin === 'import' && event.fileName) {
        return [m.event_file({ file: event.fileName, lines: event.fileLines.join(', ') }), status];
      }
      return [status];
    }
    case 'changed':
      return event.changes.map((c) => changeText(c, lists));
    case 'status':
      return [
        m.event_status_change({
          from: inSentence(statusLabel[event.from]()),
          to: inSentence(statusLabel[event.to]()),
        }),
        ...(event.reason ? [m.event_reason({ reason: event.reason })] : []),
      ];
  }
}
