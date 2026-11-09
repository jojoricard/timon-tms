import { describe, expect, it } from 'vitest';
import {
  checkOrder,
  type GoodsLine,
  type OrderDetails,
  type OrderSite,
  type OrderStop,
  orderChanges,
  orderRequirements,
  orderShape,
  orderTotals,
  orderWarnings,
  parseTime,
  slotOf,
  slotPeriod,
  Temporal,
} from '../src/index.ts';

// SPEC-004. Monday 9 and Tuesday 10 November 2026; times are in each site's time zone.

const weekdays = [1, 2, 3, 4, 5] as const;
const hours = (days: readonly number[], ...ranges: string[]) =>
  days.flatMap((weekday) =>
    ranges.map((range) => {
      const [start = '', end = ''] = range.split('-');
      return {
        weekday: weekday as 1,
        startMinute: parseTime(start) ?? 0,
        endMinute: parseTime(end) ?? 0,
      };
    }),
  );

const site = (id: string, extra: Partial<OrderSite> = {}): OrderSite => ({
  id,
  name: id,
  timeZone: 'Europe/Paris',
  locatedBy: 'address',
  openings: hours([1, 2, 3, 4, 5, 6, 7], '00:00-24:00'),
  bookingRequired: false,
  loadingDock: true,
  protectiveEquipmentIds: [],
  maxLengthCm: null,
  maxWeightKg: null,
  semiTrailersAccepted: true,
  ...extra,
});

const sites = new Map(
  [
    site('Hub de Corbas'),
    site('Entrepôt pharma Meyzieu', {
      openings: hours(weekdays, '08:00-12:00', '13:30-16:00'),
      bookingRequired: true,
      protectiveEquipmentIds: ['shoes', 'vest'],
    }),
    site('Plateforme Saint-Priest, quai C', { locatedBy: 'not-located' }),
    site('Plateforme Saint-Priest, quai B', {
      bookingRequired: true,
      protectiveEquipmentIds: ['vest', 'hat'],
      maxLengthCm: 1650,
    }),
    site('Silo de Vienne', { loadingDock: false, maxWeightKg: 32_000 }),
    site('Chantier Part-Dieu', { semiTrailersAccepted: false, maxLengthCm: 1200 }),
    site('Transalpina magazzino', { timeZone: 'Europe/Rome' }),
  ].map((s) => [s.id, s]),
);

const day = (iso: string) => Temporal.PlainDate.from(iso);
const minutes = (time: string) => parseTime(time) ?? -1;

const stop = (
  id: string,
  kind: OrderStop['kind'],
  siteId: string,
  date: string | null,
  start: string | null,
  end: string | null,
  extra: Partial<OrderStop> = {},
): OrderStop => ({
  id,
  kind,
  siteId,
  date: date ? day(date) : null,
  startMinute: start ? minutes(start) : null,
  endMinute: end ? minutes(end) : null,
  bookingMade: false,
  bookingReference: null,
  ...extra,
});

const line = (
  id: string,
  fromStopId: string,
  toStopId: string,
  extra: Partial<GoodsLine> = {},
): GoodsLine => ({
  id,
  description: 'Yoghourts, pots de 125 g',
  quantity: 10,
  packaging: 'euro-pallet',
  weightKg: 5_000,
  floorDm: 40,
  unNumber: null,
  adrClass: null,
  temperatureMin: null,
  temperatureMax: null,
  fromStopId,
  toStopId,
  ...extra,
});

const order = (
  stops: OrderStop[],
  lines: GoodsLine[],
  extra: Partial<OrderDetails> = {},
): OrderDetails => ({
  customerId: 'monts-lait',
  customerReference: 'LML-88213',
  notes: null,
  bodyTypeId: null,
  sideLoading: false,
  tailLift: false,
  stops,
  lines,
  ...extra,
});

/** One pickup at Corbas on 10/11 from 08:00 to 10:00, and one delivery given by the test. */
const simple = (delivery: OrderStop, lines?: GoodsLine[]) =>
  order(
    [stop('p', 'pickup', 'Hub de Corbas', '2026-11-10', '08:00', '10:00'), delivery],
    lines ?? [line('l1', 'p', delivery.id)],
  );

const codes = (issues: readonly { field: string; code: string }[]) =>
  issues.map((i) => `${i.field}:${i.code}`);

describe('slots', () => {
  it('are read in the site’s time zone, the end on the next day when it is earlier', () => {
    const period = slotPeriod(
      { date: day('2026-11-09'), startMinute: minutes('22:00'), endMinute: minutes('02:00') },
      'Europe/Paris',
    );
    expect(period.start.toString()).toBe('2026-11-09T21:00:00Z');
    expect(period.end.toString()).toBe('2026-11-10T01:00:00Z');
    expect(slotOf(period, 'Europe/Paris')).toEqual({
      date: day('2026-11-09'),
      startMinute: minutes('22:00'),
      endMinute: minutes('02:00'),
    });
  });

  it('a slot that ends when it starts is refused (rule 3)', () => {
    const issues = checkOrder(
      simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '12:00')),
      sites,
    ).blocking;
    expect(codes(issues)).toContain('stops.1.end:end-not-after-start');
  });
});

describe('the shape of an order (rules 1 and 2)', () => {
  it('one pickup and two deliveries is valid (criterion 1)', () => {
    const valid = order(
      [
        stop('p', 'pickup', 'Hub de Corbas', '2026-11-10', '06:00', '07:00'),
        stop('d1', 'delivery', 'Silo de Vienne', '2026-11-10', '09:00', '10:00'),
        stop('d2', 'delivery', 'Plateforme Saint-Priest, quai B', '2026-11-10', '11:00', '12:00'),
      ],
      [line('l1', 'p', 'd1'), line('l2', 'p', 'd2')],
    );
    expect(orderShape(valid)).toBe('one-pickup');
    expect(checkOrder(valid, sites)).toEqual({ blocking: [], review: [] });
  });

  it('several pickups and several deliveries is to review, not refused', () => {
    const merged = order(
      [
        stop('p1', 'pickup', 'Hub de Corbas', '2026-11-10', '06:00', '07:00'),
        stop('p2', 'pickup', 'Silo de Vienne', '2026-11-10', '07:00', '08:00'),
        stop('d1', 'delivery', 'Transalpina magazzino', '2026-11-11', '08:00', '12:00'),
        stop('d2', 'delivery', 'Plateforme Saint-Priest, quai B', '2026-11-10', '14:00', '15:00'),
      ],
      [line('l1', 'p1', 'd1'), line('l2', 'p2', 'd2')],
    );
    expect(orderShape(merged)).toBe('several-both');
    const { blocking, review } = checkOrder(merged, sites);
    expect(blocking).toEqual([]);
    expect(codes(review)).toEqual(['stops:several-pickups-and-deliveries']);
    expect(review[0]?.params).toEqual({ pickups: 2, deliveries: 2 });
  });

  it('needs a pickup, a delivery, and goods on every stop and every line on two stops', () => {
    expect(codes(checkOrder(order([], []), sites).blocking)).toEqual([
      'stops:pickup-required',
      'stops:delivery-required',
      'lines:required',
    ]);
    const idle = order(
      [
        stop('p', 'pickup', 'Hub de Corbas', '2026-11-10', '06:00', '07:00'),
        stop('d1', 'delivery', 'Silo de Vienne', '2026-11-10', '09:00', '10:00'),
        stop('d2', 'delivery', 'Hub de Corbas', '2026-11-10', '11:00', '12:00'),
      ],
      [line('l1', 'p', 'd1'), line('l2', 'd1', 'nowhere')],
    );
    expect(codes(checkOrder(idle, sites).blocking)).toEqual([
      'stops.2.siteId:stop-without-goods',
      'lines.1.fromStopId:required',
      'lines.1.toStopId:required',
    ]);
  });

  it('needs the customer, a site and a full slot on every stop', () => {
    const empty = order(
      [
        stop('p', 'pickup', '', null, null, null),
        stop('d', 'delivery', 'Hub de Corbas', null, '08:00', null),
      ],
      [line('l1', 'p', 'd')],
      { customerId: '' },
    );
    expect(codes(checkOrder(empty, sites).blocking)).toEqual([
      'customerId:required',
      'stops.0.siteId:required',
      'stops.0.date:required',
      'stops.0.start:required',
      'stops.0.end:required',
      'stops.1.date:required',
      'stops.1.end:required',
    ]);
  });

  it('a site that is not located puts the order to review (criterion 2)', () => {
    const { blocking, review } = checkOrder(
      simple(
        stop('d', 'delivery', 'Plateforme Saint-Priest, quai C', '2026-11-10', '12:00', '13:00'),
      ),
      sites,
    );
    expect(blocking).toEqual([]);
    expect(review).toEqual([
      {
        field: 'stops.1.siteId',
        code: 'site-not-located',
        params: { site: 'Plateforme Saint-Priest, quai C' },
      },
    ]);
  });
});

describe('a delivery before its pickup (rule 4)', () => {
  it('a delivery from 06:00 to 07:30 after a pickup from 08:00 is refused (criterion 3)', () => {
    const issues = checkOrder(
      simple(stop('d', 'delivery', 'Silo de Vienne', '2026-11-10', '06:00', '07:30')),
      sites,
    ).blocking;
    expect(issues).toEqual([
      {
        field: 'stops.1.end',
        code: 'delivery-before-pickup',
        params: { site: 'Hub de Corbas', start: '08:00' },
      },
    ]);
  });

  it('compares instants across time zones', () => {
    // 08:30 in Rome is 08:30 in Paris too in November: one hour zones apart would differ.
    const ok = simple(
      stop('d', 'delivery', 'Transalpina magazzino', '2026-11-10', '07:00', '08:30'),
    );
    expect(checkOrder(ok, sites).blocking).toEqual([]);
  });
});

describe('goods lines', () => {
  it('checks quantities, weights, dangerous goods and temperatures', () => {
    const wrong = simple(stop('d', 'delivery', 'Silo de Vienne', '2026-11-10', '12:00', '13:00'), [
      line('l1', 'p', 'd', {
        description: ' ',
        quantity: 0,
        weightKg: -1,
        floorDm: 0,
        unNumber: '206',
        adrClass: null,
        temperatureMin: 8,
        temperatureMax: 2,
      }),
      line('l2', 'p', 'd', { adrClass: '3', temperatureMin: -40, temperatureMax: null }),
    ]);
    expect(codes(checkOrder(wrong, sites).blocking)).toEqual([
      'lines.0.description:required',
      'lines.0.quantity:value-not-positive',
      'lines.0.weightKg:value-not-positive',
      'lines.0.floorDm:value-not-positive',
      'lines.0.unNumber:un-number-invalid',
      'lines.0.adrClass:required',
      'lines.0.temperatureMax:temperature-range-invalid',
      'lines.1.unNumber:required',
      'lines.1.temperatureMin:temperature-out-of-range',
      'lines.1.temperatureMax:required',
    ]);
  });
});

describe('totals (rule 5)', () => {
  it('add up the lines', () => {
    const totals = orderTotals(
      simple(stop('d', 'delivery', 'Silo de Vienne', '2026-11-10', '12:00', '13:00'), [
        line('l1', 'p', 'd', { quantity: 4, weightKg: 1_200, floorDm: 16 }),
        line('l2', 'p', 'd', { quantity: 6, packaging: 'pallet', weightKg: 2_000, floorDm: null }),
      ]),
    );
    expect(totals).toEqual({
      weightKg: 3_200,
      floorDm: 16,
      quantities: { 'euro-pallet': 4, pallet: 6, parcel: 0, bulk: 0 },
    });
  });
});

describe('warnings', () => {
  const meyzieu = (start: string, end: string, extra: Partial<OrderStop> = {}) =>
    simple(
      stop('d', 'delivery', 'Entrepôt pharma Meyzieu', '2026-11-10', start, end, {
        bookingMade: true,
        ...extra,
      }),
    );

  it('a slot during the lunch closure of Meyzieu says when it is closed (criterion 4)', () => {
    const delivery = meyzieu('12:15', '13:00');
    expect(orderWarnings(delivery, sites, [])).toEqual([
      {
        code: 'site-closed',
        stopId: 'd',
        params: { site: 'Entrepôt pharma Meyzieu', weekday: 2, start: '12:00', end: '13:30' },
      },
    ]);
    // A warning does not block.
    expect(checkOrder(delivery, sites).blocking).toEqual([]);
  });

  it('a slot past the closing time is outside the opening hours', () => {
    expect(orderWarnings(meyzieu('15:00', '17:00'), sites, [])).toEqual([
      {
        code: 'outside-opening-hours',
        stopId: 'd',
        params: { site: 'Entrepôt pharma Meyzieu', weekday: 2, start: '15:00', end: '17:00' },
      },
    ]);
    expect(orderWarnings(meyzieu('09:00', '11:00'), sites, [])).toEqual([]);
  });

  it('a site open day and night takes a slot over midnight', () => {
    const night = simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '22:00', '02:00'));
    expect(orderWarnings(night, sites, [])).toEqual([]);
  });

  it('a booking not ticked at a site that requires one (criterion 5)', () => {
    expect(orderWarnings(meyzieu('09:00', '10:00', { bookingMade: false }), sites, [])).toEqual([
      { code: 'booking-to-make', stopId: 'd', params: { site: 'Entrepôt pharma Meyzieu' } },
    ]);
  });

  it('27,000 kg is over the 25,000 kg of a semi-trailer (criterion 6)', () => {
    const heavy = simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '13:00'), [
      line('l1', 'p', 'd', { weightKg: 18_000 }),
      line('l2', 'p', 'd', { weightKg: 9_000 }),
    ]);
    expect(orderWarnings(heavy, sites, [])).toEqual([
      { code: 'weight-over', stopId: null, params: { weightKg: 27_000, maxKg: 25_000 } },
    ]);
  });

  it('more than 13.6 floor metres, and a reference another order uses', () => {
    const long = simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '13:00'), [
      line('l1', 'p', 'd', { floorDm: 80 }),
      line('l2', 'p', 'd', { floorDm: 57 }),
    ]);
    expect(orderWarnings(long, sites, ['CMD-2026-000012'])).toEqual([
      { code: 'floor-over', stopId: null, params: { floorDm: 137, maxDm: 136 } },
      { code: 'reference-used', stopId: null, params: { orders: 'CMD-2026-000012' } },
    ]);
  });
});

describe('requirements, each with its source', () => {
  it('UN 2067, class 5.1 asks for ADR, from that line (criterion 7)', () => {
    const fertiliser = simple(
      stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '13:00'),
      [line('l1', 'p', 'd'), line('l2', 'p', 'd', { unNumber: '2067', adrClass: '5.1' })],
    );
    expect(orderRequirements(fertiliser, sites)).toEqual([
      {
        code: 'adr',
        params: { classes: '5.1' },
        ids: [],
        source: { kind: 'lines', lines: [2], siteIds: [] },
      },
    ]);
  });

  it('+2 to +6 °C and +4 to +8 °C ask for +4 to +6 °C and an ATP certificate (criterion 8)', () => {
    const chilled = simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '13:00'), [
      line('l1', 'p', 'd', { temperatureMin: 2, temperatureMax: 6 }),
      line('l2', 'p', 'd', { temperatureMin: 4, temperatureMax: 8 }),
      line('l3', 'p', 'd'),
    ]);
    const source = { kind: 'lines', lines: [1, 2], siteIds: [] };
    expect(orderRequirements(chilled, sites)).toEqual([
      { code: 'temperature', params: { min: 4, max: 6 }, ids: [], source },
      { code: 'atp', params: {}, ids: [], source },
    ]);
  });

  it('ranges with nothing in common: each range with its lines, and a warning', () => {
    const apart = simple(stop('d', 'delivery', 'Hub de Corbas', '2026-11-10', '12:00', '13:00'), [
      line('l1', 'p', 'd', { temperatureMin: -20, temperatureMax: -18 }),
      line('l2', 'p', 'd', { temperatureMin: 2, temperatureMax: 6 }),
      line('l3', 'p', 'd', { temperatureMin: 4, temperatureMax: 8 }),
    ]);
    const lines = (numbers: number[]) => ({ kind: 'lines', lines: numbers, siteIds: [] });
    expect(orderRequirements(apart, sites)).toEqual([
      { code: 'temperature', params: { min: -20, max: -18 }, ids: [], source: lines([1]) },
      { code: 'temperature', params: { min: 2, max: 6 }, ids: [], source: lines([2]) },
      { code: 'temperature', params: { min: 4, max: 8 }, ids: [], source: lines([3]) },
      { code: 'atp', params: {}, ids: [], source: lines([1, 2, 3]) },
    ]);
    expect(orderWarnings(apart, sites, [])).toEqual([
      { code: 'temperature-conflict', stopId: null, params: { lines: '1, 2, 3' } },
    ]);
  });

  it('a site without a loading dock asks for a tail lift or a crane (criterion 9)', () => {
    const silo = simple(stop('d', 'delivery', 'Silo de Vienne', '2026-11-10', '12:00', '13:00'));
    expect(orderRequirements(silo, sites)).toEqual([
      {
        code: 'tail-lift-or-crane',
        params: {},
        ids: [],
        source: { kind: 'sites', lines: [], siteIds: ['Silo de Vienne'] },
      },
      {
        code: 'max-weight',
        params: { kg: 32_000 },
        ids: [],
        source: { kind: 'sites', lines: [], siteIds: ['Silo de Vienne'] },
      },
    ]);
  });

  it('what is ticked on the order, and the access limits and equipment of the sites', () => {
    const both = order(
      [
        stop('p', 'pickup', 'Plateforme Saint-Priest, quai B', '2026-11-10', '06:00', '07:00'),
        stop('d1', 'delivery', 'Entrepôt pharma Meyzieu', '2026-11-10', '09:00', '10:00'),
        stop('d2', 'delivery', 'Chantier Part-Dieu', '2026-11-10', '11:00', '12:00'),
      ],
      [line('l1', 'p', 'd1'), line('l2', 'p', 'd2')],
      { bodyTypeId: 'body-box', sideLoading: true, tailLift: true },
    );
    const order_ = { kind: 'order', lines: [], siteIds: [] };
    expect(orderRequirements(both, sites)).toEqual([
      { code: 'body-type', params: {}, ids: ['body-box'], source: order_ },
      { code: 'side-loading', params: {}, ids: [], source: order_ },
      { code: 'tail-lift', params: {}, ids: [], source: order_ },
      {
        code: 'protective-equipment',
        params: {},
        ids: ['vest', 'hat', 'shoes'],
        source: {
          kind: 'sites',
          lines: [],
          siteIds: ['Plateforme Saint-Priest, quai B', 'Entrepôt pharma Meyzieu'],
        },
      },
      {
        code: 'max-length',
        params: { cm: 1200 },
        ids: [],
        source: { kind: 'sites', lines: [], siteIds: ['Chantier Part-Dieu'] },
      },
      {
        code: 'no-semi-trailer',
        params: {},
        ids: [],
        source: { kind: 'sites', lines: [], siteIds: ['Chantier Part-Dieu'] },
      },
    ]);
  });
});

describe('the changes of an order, for its history (criterion 14)', () => {
  const before = simple(
    stop('d', 'delivery', 'Entrepôt pharma Meyzieu', '2026-11-09', '11:00', '12:00'),
  );
  const name = (id: string) => sites.get(id)?.name ?? id;

  it('a slot changed shows the old and the new slot', () => {
    const after = {
      ...before,
      stops: before.stops.map((s) =>
        s.id === 'd' ? { ...s, startMinute: minutes('12:15'), endMinute: minutes('13:00') } : s,
      ),
    };
    expect(orderChanges(before, after, name)).toEqual([
      {
        kind: 'stop-changed',
        field: 'slot',
        stopKind: 'delivery',
        site: 'Entrepôt pharma Meyzieu',
        line: null,
        description: null,
        from: '2026-11-09 11:00–12:00',
        to: '2026-11-09 12:15–13:00',
        goods: null,
      },
    ]);
  });

  it('a booking made, a line added and a requirement ticked', () => {
    const after: OrderDetails = {
      ...before,
      tailLift: true,
      stops: before.stops.map((s) =>
        s.id === 'd' ? { ...s, bookingMade: true, bookingReference: 'RDV-55102' } : s,
      ),
      lines: [
        ...before.lines,
        line('l2', 'p', 'd', {
          description: 'Diagnostic reagents',
          quantity: 2,
          weightKg: 600,
          temperatureMin: 4,
          temperatureMax: 6,
        }),
      ],
    };
    expect(orderChanges(before, after, name).map((c) => [c.kind, c.field, c.from, c.to])).toEqual([
      ['header', 'tailLift', false, true],
      ['stop-changed', 'bookingMade', false, true],
      ['stop-changed', 'bookingReference', null, 'RDV-55102'],
      ['line-added', null, null, null],
    ]);
    expect(orderChanges(before, after, name)[3]).toMatchObject({
      line: 2,
      description: 'Diagnostic reagents',
      goods: {
        quantity: 2,
        packaging: 'euro-pallet',
        weightKg: 600,
        temperatureMin: 4,
        temperatureMax: 6,
      },
    });
  });

  it('nothing changed, no entry', () => {
    expect(orderChanges(before, before, name)).toEqual([]);
  });
});
