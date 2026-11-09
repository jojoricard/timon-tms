import { orderRecord, type ReferenceLists, type StoredSite } from '@timon/app';
import {
  type AdrClass,
  checkOrder,
  type GoodsLine,
  type OrderDetails,
  type OrderStop,
  orderWarnings,
  type Packaging,
  parseTime,
  type StopKind,
  type Temporal,
} from '@timon/domain';
import type { Repositories } from './repositories.ts';
import { demoSiteNames } from './seed-customers.ts';

// SPEC-004, Demo data: about 60 orders over the seven days from today, from the demo customers
// and sites. Chilled goods for the dairy and the pharmaceutical warehouse, dangerous goods for
// the agricultural supplier, pallets for the breweries and the DIY store. Each order is checked
// with the rules before it is written: an ordinary one must raise no warning, an order meant to
// show a warning must raise exactly that one, and the two orders to review must be to review.

type StopSpec = {
  readonly kind: StopKind;
  readonly site: string;
  readonly start: string;
  readonly end: string;
  /** Days after the order's day. */
  readonly later?: number;
  /** False leaves a booking to make at a site that requires one. */
  readonly booked?: boolean;
};

type LineSpec = {
  readonly description: string;
  readonly quantity: number;
  readonly packaging: Packaging;
  readonly weightKg: number;
  readonly adr?: readonly [string, AdrClass];
  readonly temperature?: readonly [number, number];
  /** Indices of its two stops. */
  readonly from: number;
  readonly to: number;
};

type Template = {
  readonly customer: string;
  readonly prefix: string;
  readonly stops: readonly StopSpec[];
  readonly lines: readonly LineSpec[];
  readonly body?: string;
  readonly sideLoading?: boolean;
  readonly tailLift?: boolean;
  readonly notes?: string;
  /** The warnings the order is meant to show, in order. */
  readonly warns?: readonly string[];
};

const pickup = (site: string, start: string, end: string, extra: Partial<StopSpec> = {}) => ({
  kind: 'pickup' as const,
  site,
  start,
  end,
  ...extra,
});
const delivery = (site: string, start: string, end: string, extra: Partial<StopSpec> = {}) => ({
  kind: 'delivery' as const,
  site,
  start,
  end,
  ...extra,
});

/** The orders a working day brings, tried in turn; those that do not fit the day are skipped. */
const everyday: Template[] = [
  {
    customer: 'MONTS-LAIT',
    prefix: 'LML',
    body: 'refrigerated',
    stops: [
      pickup('laiterie', '05:00', '06:30'),
      delivery('corbas', '08:00', '09:00'),
      delivery('dock-b', '09:30', '10:30'),
    ],
    lines: [
      {
        description: 'Yaourts nature, pots de 125 g',
        quantity: 14,
        packaging: 'euro-pallet',
        weightKg: 7_800,
        temperature: [2, 6],
        from: 0,
        to: 1,
      },
      {
        description: 'Fromages blancs, seaux de 5 kg',
        quantity: 10,
        packaging: 'euro-pallet',
        weightKg: 5_900,
        temperature: [2, 6],
        from: 0,
        to: 2,
      },
    ],
  },
  {
    customer: 'PHARMALP',
    prefix: 'PH',
    tailLift: true,
    stops: [pickup('corbas', '07:00', '08:00'), delivery('meyzieu', '09:00', '10:00')],
    lines: [
      {
        description: 'Vaccins, chaîne du froid',
        quantity: 4,
        packaging: 'euro-pallet',
        weightKg: 1_200,
        temperature: [2, 8],
        from: 0,
        to: 1,
      },
      {
        description: 'Réactifs de diagnostic',
        quantity: 2,
        packaging: 'euro-pallet',
        weightKg: 600,
        temperature: [4, 6],
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'RHONE-AGRO',
    prefix: 'RAS',
    stops: [pickup('venissieux', '07:00', '08:00'), delivery('vienne', '10:00', '11:00')],
    lines: [
      {
        description: 'Ammonitrate 33,5 %, big bags',
        quantity: 22,
        packaging: 'pallet',
        weightKg: 24_000,
        adr: ['2067', '5.1'],
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'BRASS-RHONE',
    prefix: 'BR',
    sideLoading: true,
    stops: [
      pickup('villeurbanne', '06:00', '07:00'),
      delivery('chassieu', '08:00', '09:00'),
      delivery('corbas', '09:30', '10:30'),
    ],
    lines: [
      {
        description: 'Fûts de bière, 30 L',
        quantity: 8,
        packaging: 'pallet',
        weightKg: 4_200,
        from: 0,
        to: 1,
      },
      {
        description: 'Bouteilles, casiers consignés',
        quantity: 10,
        packaging: 'pallet',
        weightKg: 5_400,
        from: 0,
        to: 2,
      },
    ],
  },
  {
    customer: 'DUPONT-MAT',
    prefix: 'DM',
    body: 'flatbed',
    stops: [pickup('venissieux', '06:30', '07:30'), delivery('part-dieu', '08:00', '09:30')],
    lines: [
      {
        description: 'Parpaings, palettes filmées',
        quantity: 9,
        packaging: 'pallet',
        weightKg: 11_200,
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'LUMIERE-EM',
    prefix: 'LE',
    body: 'box',
    tailLift: true,
    stops: [pickup('dock-b', '08:00', '09:00'), delivery('chassieu', '10:00', '11:00')],
    lines: [
      {
        description: 'Lave-linge, cartons',
        quantity: 24,
        packaging: 'euro-pallet',
        weightKg: 7_900,
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'SAVOIE-PAP',
    prefix: 'PS',
    body: 'curtainsider',
    stops: [pickup('dock-b', '07:00', '09:00'), delivery('venissieux', '13:00', '14:00')],
    lines: [
      {
        description: 'Bobines de papier kraft',
        quantity: 22,
        packaging: 'pallet',
        weightKg: 21_500,
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'VERCORS-FRO',
    prefix: 'FV',
    body: 'refrigerated',
    stops: [pickup('vercors', '06:30', '08:00'), delivery('corbas', '11:00', '12:00')],
    lines: [
      {
        description: 'Bleu du Vercors, meules',
        quantity: 14,
        packaging: 'euro-pallet',
        weightKg: 8_100,
        temperature: [0, 4],
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'ALPES-FROID',
    prefix: 'AFL',
    body: 'refrigerated',
    stops: [pickup('corbas', '13:00', '14:00'), delivery('meyzieu', '14:30', '15:30')],
    lines: [
      {
        description: 'Plasma, conteneurs isothermes',
        quantity: 6,
        packaging: 'euro-pallet',
        weightKg: 1_800,
        temperature: [2, 8],
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'TEXT-CROIX',
    prefix: 'TC',
    stops: [pickup('corbas', '06:00', '07:00'), delivery('chassieu', '07:30', '08:30')],
    lines: [
      {
        description: 'Rouleaux de tissu, colis',
        quantity: 40,
        packaging: 'parcel',
        weightKg: 1_400,
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'GARNIER-BOIS',
    prefix: 'GB',
    body: 'curtainsider',
    stops: [
      pickup('venissieux', '07:00', '08:00'),
      pickup('dock-b', '09:00', '10:00'),
      delivery('corbas', '13:00', '14:00'),
    ],
    lines: [
      {
        description: 'Panneaux OSB, 18 mm',
        quantity: 12,
        packaging: 'pallet',
        weightKg: 9_600,
        from: 0,
        to: 2,
      },
      {
        description: 'Contreplaqué, 12 mm',
        quantity: 8,
        packaging: 'pallet',
        weightKg: 6_100,
        from: 1,
        to: 2,
      },
    ],
  },
  {
    customer: 'TRANSALP-IT',
    prefix: 'TR',
    body: 'curtainsider',
    stops: [pickup('corbas', '07:00', '08:00'), delivery('torino', '08:00', '12:00', { later: 1 })],
    lines: [
      {
        description: 'Disques de frein',
        quantity: 16,
        packaging: 'pallet',
        weightKg: 8_400,
        from: 0,
        to: 1,
      },
    ],
  },
  {
    customer: 'MONTS-LAIT',
    prefix: 'LML',
    body: 'refrigerated',
    stops: [pickup('laiterie', '07:00', '08:30'), delivery('corbas', '10:00', '11:00')],
    lines: [
      {
        description: 'Crème fraîche, seaux de 5 L',
        quantity: 12,
        packaging: 'euro-pallet',
        weightKg: 6_300,
        temperature: [2, 6],
        from: 0,
        to: 1,
      },
    ],
  },
];

/** Orders meant to show one warning each, on the first working day of the week. */
const withWarnings: Template[] = [
  {
    customer: 'PHARMALP',
    prefix: 'PH',
    tailLift: true,
    notes: 'Vaccins en premier : le quai de Meyzieu ferme à midi.',
    stops: [
      pickup('corbas', '09:00', '10:00'),
      delivery('meyzieu', '12:15', '13:00'),
      delivery('dock-b', '14:00', '15:00', { booked: false }),
    ],
    lines: [
      {
        description: 'Vaccins, chaîne du froid',
        quantity: 4,
        packaging: 'euro-pallet',
        weightKg: 1_200,
        temperature: [2, 8],
        from: 0,
        to: 1,
      },
      {
        description: 'Dispositifs médicaux',
        quantity: 6,
        packaging: 'pallet',
        weightKg: 2_000,
        from: 0,
        to: 2,
      },
    ],
    warns: ['site-closed', 'booking-to-make'],
  },
  {
    customer: 'GARNIER-BOIS',
    prefix: 'GB',
    body: 'curtainsider',
    stops: [pickup('venissieux', '07:00', '08:00'), delivery('corbas', '13:00', '14:00')],
    lines: [
      {
        description: 'Poutres en lamellé-collé',
        quantity: 20,
        packaging: 'pallet',
        weightKg: 27_400,
        from: 0,
        to: 1,
      },
    ],
    warns: ['weight-over'],
  },
  {
    customer: 'BRASS-RHONE',
    prefix: 'BR',
    sideLoading: true,
    stops: [pickup('villeurbanne', '06:00', '07:00'), delivery('chassieu', '15:00', '16:30')],
    lines: [
      {
        description: 'Fûts de bière, 30 L',
        quantity: 18,
        packaging: 'pallet',
        weightKg: 9_600,
        from: 0,
        to: 1,
      },
    ],
    warns: ['outside-opening-hours'],
  },
];

/** The two orders to review: several pickups and deliveries, and a site not located. */
const toReview: Template[] = [
  {
    customer: 'TRANSALP-IT',
    prefix: 'TR',
    body: 'curtainsider',
    stops: [
      pickup('corbas', '07:00', '08:00'),
      pickup('venissieux', '09:00', '10:00'),
      delivery('torino', '08:00', '12:00', { later: 1 }),
      delivery('chassieu', '10:30', '11:30'),
    ],
    lines: [
      {
        description: 'Disques de frein',
        quantity: 8,
        packaging: 'pallet',
        weightKg: 4_200,
        from: 0,
        to: 2,
      },
      {
        description: 'Filtres',
        quantity: 6,
        packaging: 'pallet',
        weightKg: 2_100,
        from: 0,
        to: 3,
      },
      {
        description: 'Boîtes de vitesses',
        quantity: 8,
        packaging: 'pallet',
        weightKg: 5_600,
        from: 1,
        to: 2,
      },
    ],
  },
  {
    customer: 'LUMIERE-EM',
    prefix: 'LE',
    body: 'box',
    stops: [pickup('dock-c', '06:00', '07:00'), delivery('corbas', '09:00', '10:00')],
    lines: [
      {
        description: 'Réfrigérateurs, cartons',
        quantity: 20,
        packaging: 'euro-pallet',
        weightKg: 6_400,
        from: 0,
        to: 1,
      },
    ],
  },
];

/** Floor metres of a deck taken by pallets: 33 Euro pallets or 26 pallets per 13.6 m. */
function floorOf(quantity: number, packaging: Packaging): number | null {
  if (packaging === 'euro-pallet') return Math.ceil((quantity * 136) / 33);
  if (packaging === 'pallet') return Math.ceil((quantity * 136) / 26);
  return null;
}

type Built = { order: OrderDetails; template: Template };

function build(
  template: Template,
  day: Temporal.PlainDate,
  serial: number,
  context: {
    customers: Map<string, string>;
    sites: Map<string, StoredSite>;
    lists: ReferenceLists;
  },
): Built {
  const siteOf = (key: string) => {
    const site = context.sites.get(demoSiteNames[key] ?? key);
    if (!site) throw new Error(`No demo site ${key}`);
    return site;
  };
  const customerId = context.customers.get(template.customer);
  if (!customerId) throw new Error(`No demo customer ${template.customer}`);
  const stops = template.stops.map((spec, index): OrderStop => {
    const site = siteOf(spec.site);
    const booked = site.bookingRequired && spec.booked !== false;
    return {
      id: `stop-${index}`,
      kind: spec.kind,
      siteId: site.id,
      date: day.add({ days: spec.later ?? 0 }),
      startMinute: parseTime(spec.start) ?? 0,
      endMinute: parseTime(spec.end) ?? 0,
      bookingMade: booked,
      // A reference of its own for each stop booked.
      bookingReference: booked ? `RDV-${51_000 + serial * 10 + index}` : null,
    };
  });
  const lines = template.lines.map(
    (spec, index): GoodsLine => ({
      id: `line-${index}`,
      description: spec.description,
      quantity: spec.quantity,
      packaging: spec.packaging,
      weightKg: spec.weightKg,
      floorDm: floorOf(spec.quantity, spec.packaging),
      unNumber: spec.adr?.[0] ?? null,
      adrClass: spec.adr?.[1] ?? null,
      temperatureMin: spec.temperature?.[0] ?? null,
      temperatureMax: spec.temperature?.[1] ?? null,
      fromStopId: `stop-${spec.from}`,
      toStopId: `stop-${spec.to}`,
    }),
  );
  const body = template.body
    ? context.lists.bodyTypes.find((b) => b.code === template.body)?.id
    : undefined;
  return {
    template,
    order: {
      customerId,
      customerReference: `${template.prefix}-${20_900 + serial}`,
      notes: template.notes ?? null,
      bodyTypeId: body ?? null,
      sideLoading: template.sideLoading ?? false,
      tailLift: template.tailLift ?? false,
      stops,
      lines,
    },
  };
}

/** Real ids for the stops and lines, the links following. */
function withIds(order: OrderDetails): OrderDetails {
  const ids = new Map(order.stops.map((s) => [s.id, globalThis.crypto.randomUUID()]));
  return {
    ...order,
    stops: order.stops.map((s) => ({ ...s, id: ids.get(s.id) ?? s.id })),
    lines: order.lines.map((l) => ({
      ...l,
      id: globalThis.crypto.randomUUID(),
      fromStopId: ids.get(l.fromStopId) ?? l.fromStopId,
      toStopId: ids.get(l.toStopId) ?? l.toStopId,
    })),
  };
}

const ordinaryPerDay = (day: Temporal.PlainDate) => (day.dayOfWeek <= 5 ? 11 : 4);

/** The demo's orders: about 60 over the seven days from `today`. */
export async function seedOrders(
  repositories: Repositories,
  today: Temporal.PlainDate,
): Promise<number> {
  const [customers, sites, lists] = await Promise.all([
    repositories.customers.list({ includeArchived: false }),
    repositories.sites.list({ includeArchived: false }),
    repositories.referenceLists.get(),
  ]);
  const context = {
    customers: new Map(customers.map((c) => [c.code, c.id])),
    sites: new Map(sites.map((s) => [s.name, s])),
    lists,
  };
  const byId = new Map(sites.map((s) => [s.id, s]));
  const days = Array.from({ length: 7 }, (_, i) => today.add({ days: i }));
  const weekdays = days.filter((d) => d.dayOfWeek <= 5);
  const [firstWorkday = today, secondWorkday = today] = weekdays;

  let serial = 0;
  const kept: { order: OrderDetails; status: 'to-plan' | 'to-review' }[] = [];
  const accept = (template: Template, day: Temporal.PlainDate, expect: 'plan' | 'review') => {
    const { order } = build(template, day, serial, context);
    const { blocking, review } = checkOrder(order, byId);
    if (blocking.length > 0) return false;
    if (review.length > 0 !== (expect === 'review')) return false;
    const warnings = orderWarnings(order, byId, []).map((w) => w.code);
    if (warnings.join() !== (template.warns ?? []).join()) return false;
    serial += 1;
    kept.push({ order, status: expect === 'review' ? 'to-review' : 'to-plan' });
    return true;
  };

  for (const template of withWarnings) accept(template, firstWorkday, 'plan');
  for (const template of toReview) accept(template, secondWorkday, 'review');
  for (const [index, day] of days.entries()) {
    let added = 0;
    for (let i = 0; i < everyday.length && added < ordinaryPerDay(day); i += 1) {
      const template = everyday[(i + index * 3) % everyday.length];
      if (template && accept(template, day, 'plan')) added += 1;
    }
  }

  // Written in the order of their first pickup, as a dispatcher would have entered them.
  const firstStart = (order: OrderDetails) => {
    const first = order.stops.find((s) => s.kind === 'pickup');
    return `${first?.date?.toString() ?? ''} ${String(first?.startMinute ?? 0).padStart(4, '0')}`;
  };
  kept.sort((a, b) => firstStart(a.order).localeCompare(firstStart(b.order)));
  const at = repositories.clock.now();
  return repositories.orders.createMany(
    kept.map(({ order, status }) => ({
      order: orderRecord(withIds(order), status, byId),
      event: {
        at,
        kind: 'created',
        origin: 'demo',
        status,
        source: null,
        fileName: null,
        fileLines: [],
      },
    })),
    today.year,
  );
}
