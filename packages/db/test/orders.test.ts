import {
  ArchivedReferenceError,
  InUseError,
  type NewOrderEvent,
  type OrderRecord,
  type OrderRef,
  type Ports,
  type SiteRecord,
  StaleVersionError,
  setCustomerArchived,
  setSiteArchived,
} from '@timon/app';
import { periodOf, Temporal } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index.ts';
import { createTestDatabase, offline, type TestDatabase } from '../src/testing.ts';

// SPEC-004 in the database: numbers never given twice, goods lines tied to stops of the right
// kind, and rule 8 under concurrent writes, in both orders of events.

let database: TestDatabase;
let ports: Ports;
const now = Temporal.Instant.from('2026-11-09T09:00:00Z');

beforeEach(async () => {
  database = await createTestDatabase();
  ports = { ...createRepositories(database.db, { now: () => now }), geocoder: offline };
});
afterEach(() => database.close());

const siteRecord = (name: string): SiteRecord => ({
  name,
  street1: '2 rue Marcel Mérieux',
  street2: null,
  postcode: '69960',
  city: 'Corbas',
  country: 'FR',
  location: { latitude: 45.67, longitude: 4.92 },
  locatedBy: 'address',
  timeZone: 'Europe/Paris',
  openings: [],
  bookingRequired: false,
  bookingMethod: null,
  bookingDetail: null,
  protectiveEquipmentIds: [],
  maxLengthCm: null,
  maxWeightKg: null,
  loadingDock: true,
  semiTrailersAccepted: true,
  gatePhone: null,
  instructions: null,
});

async function fixtures() {
  const customer = await ports.customers.create({
    code: 'MONTS-LAIT',
    name: 'Laiterie des Monts du Lyonnais',
    country: 'FR',
    siret: null,
    vatNumber: null,
    billingStreet1: null,
    billingStreet2: null,
    billingPostcode: null,
    billingCity: null,
    notes: null,
    contacts: [],
    siteIds: [],
  });
  const pickup = await ports.sites.create(siteRecord('Hub de Corbas'));
  const delivery = await ports.sites.create(siteRecord('Silo de Vienne'));
  return { customer, pickup, delivery };
}

const uuid = () => globalThis.crypto.randomUUID();

function record(customerId: string, pickupSiteId: string, deliverySiteId: string): OrderRecord {
  const p = uuid();
  const d = uuid();
  return {
    customerId,
    customerReference: 'LML-88213',
    notes: null,
    bodyTypeId: null,
    sideLoading: false,
    tailLift: false,
    status: 'to-plan',
    stops: [
      {
        id: p,
        kind: 'pickup',
        siteId: pickupSiteId,
        period: periodOf('2026-11-10T07:00:00Z', '2026-11-10T09:00:00Z'),
        bookingMade: false,
        bookingReference: null,
      },
      {
        id: d,
        kind: 'delivery',
        siteId: deliverySiteId,
        period: periodOf('2026-11-10T11:00:00Z', '2026-11-10T12:00:00Z'),
        bookingMade: false,
        bookingReference: null,
      },
    ],
    lines: [
      {
        id: uuid(),
        description: 'Yaourts',
        quantity: 10,
        packaging: 'euro-pallet',
        weightKg: 5_000,
        floorDm: 40,
        unNumber: null,
        adrClass: null,
        temperatureMin: 2,
        temperatureMax: 6,
        fromStopId: p,
        toStopId: d,
      },
    ],
  };
}

const created: NewOrderEvent = {
  at: now,
  kind: 'created',
  origin: 'hand',
  status: 'to-plan',
  source: null,
  fileName: null,
  fileLines: [],
};

describe('numbers', () => {
  it('follow each other per year, under concurrent creation, and are never reused', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const orders = await Promise.all(
      Array.from({ length: 6 }, () =>
        ports.orders.create(record(customer.id, pickup.id, delivery.id), 2026, created),
      ),
    );
    expect(orders.map((o) => o.number).sort()).toEqual([
      'CMD-2026-000001',
      'CMD-2026-000002',
      'CMD-2026-000003',
      'CMD-2026-000004',
      'CMD-2026-000005',
      'CMD-2026-000006',
    ]);
    const next = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2027,
      created,
    );
    expect(next.number).toBe('CMD-2027-000001');

    // A creation that fails after taking its number rolls back: no order ever had that number.
    await expect(
      ports.orders.create(record(customer.id, pickup.id, uuid()), 2026, created),
    ).rejects.toThrow();
    const after = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    expect(after.number).toBe('CMD-2026-000007');
  });
});

describe('goods lines', () => {
  it('cannot leave from a delivery or go to a pickup', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const order = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    const [p, d] = order.stops;
    const insert = (from: string | undefined, to: string | undefined) =>
      database.db.execute(sql`
        insert into order_goods (order_id, description, quantity, packaging, weight_kg,
          from_stop_id, to_stop_id)
        values (${order.id}, 'Reversed', 1, 'pallet', 100, ${from}, ${to})`);
    await expect(insert(d?.id, p?.id)).rejects.toThrow();
    await expect(insert(p?.id, d?.id)).resolves.toBeDefined();
  });

  it('cannot name the stop of another order', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const first = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    const second = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    await expect(
      database.db.execute(sql`
        insert into order_goods (order_id, description, quantity, packaging, weight_kg,
          from_stop_id, to_stop_id)
        values (${second.id}, 'Elsewhere', 1, 'pallet', 100, ${first.stops[0]?.id},
          ${second.stops[1]?.id})`),
    ).rejects.toThrow();
  });
});

describe('rule 8: a customer or a site used by an order to plan or to review', () => {
  it('order first, then archiving: the archiving is refused and names the order', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const order = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    const site = await setSiteArchived(ports, delivery.id, delivery.version, true);
    expect(site).toEqual({
      ok: false,
      reason: 'in-use',
      orders: [{ id: order.id, number: order.number }],
    });
    const owner = await setCustomerArchived(ports, customer.id, customer.version, true);
    expect(owner).toMatchObject({ ok: false, reason: 'in-use' });
    await expect(ports.sites.setArchived(pickup.id, pickup.version, true)).rejects.toThrow(
      InUseError,
    );
  });

  it('archiving first, then the order: the order is refused', async () => {
    const { customer, pickup, delivery } = await fixtures();
    await ports.sites.setArchived(delivery.id, delivery.version, true);
    await expect(
      ports.orders.create(record(customer.id, pickup.id, delivery.id), 2026, created),
    ).rejects.toThrow(ArchivedReferenceError);
    await ports.customers.setArchived(customer.id, customer.version, true);
    await expect(
      ports.orders.create(record(customer.id, pickup.id, pickup.id), 2026, created),
    ).rejects.toThrow(ArchivedReferenceError);
  });

  it('a change of an order to an archived site is refused', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const order = await ports.orders.create(
      record(customer.id, pickup.id, pickup.id),
      2026,
      created,
    );
    await ports.sites.setArchived(delivery.id, delivery.version, true);
    await expect(
      ports.orders.update(order.id, 1, record(customer.id, pickup.id, delivery.id), []),
    ).rejects.toThrow(ArchivedReferenceError);
  });

  it('at the same time: one of the two writes wins, never both', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const [archived, order] = await Promise.allSettled([
      ports.sites.setArchived(delivery.id, delivery.version, true),
      ports.orders.create(record(customer.id, pickup.id, delivery.id), 2026, created),
    ]);
    const outcomes = [archived.status, order.status];
    expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
    const site = await ports.sites.get(delivery.id);
    const orders = await ports.orders.list({ statuses: ['to-plan'] });
    expect(site?.archived && orders.length > 0).toBe(false);
  });

  it('a cancelled order no longer holds its customer or its sites', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const order = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    await ports.orders.cancel(order.id, 1, 'Annulée par le client', {
      at: now,
      kind: 'status',
      from: 'to-plan',
      to: 'cancelled',
      reason: 'Annulée par le client',
    });
    expect((await ports.sites.setArchived(delivery.id, delivery.version, true))?.archived).toBe(
      true,
    );
  });
});

describe('history', () => {
  it('keeps every entry, newest first, with an empty author', async () => {
    const { customer, pickup, delivery } = await fixtures();
    const order = await ports.orders.create(
      record(customer.id, pickup.id, delivery.id),
      2026,
      created,
    );
    const later = now.add({ minutes: 5 });
    const updated = await ports.orders.update(
      order.id,
      1,
      { ...record(customer.id, pickup.id, delivery.id), notes: 'Quai 4' },
      [
        {
          at: later,
          kind: 'changed',
          changes: [
            {
              kind: 'header',
              field: 'notes',
              stopKind: null,
              site: null,
              line: null,
              description: null,
              from: null,
              to: 'Quai 4',
              goods: null,
            },
          ],
        },
      ],
    );
    expect(updated?.version).toBe(2);
    expect(updated?.historyCount).toBe(2);
    const history = await ports.orders.history(order.id);
    expect(history.map((e) => [e.kind, e.at.toString(), e.authorId])).toEqual([
      ['changed', later.toString(), null],
      ['created', now.toString(), null],
    ]);
    expect(history[1]).toMatchObject({ origin: 'hand', status: 'to-plan' });
  });
});

describe('splitting', () => {
  /** Two pickups and two deliveries, one line from each pickup to each delivery. */
  async function merged() {
    const { customer, pickup, delivery } = await fixtures();
    const base = record(customer.id, pickup.id, delivery.id);
    const second = record(customer.id, delivery.id, pickup.id);
    const order = await ports.orders.create(
      {
        ...base,
        status: 'to-review',
        stops: [...base.stops, ...second.stops],
        lines: [...base.lines, ...second.lines],
      },
      2026,
      created,
    );
    const [p1, d1, p2, d2] = order.stops;
    const [l1, l2] = order.lines;
    const group = (stops: OrderRecord['stops'], lines: OrderRecord['lines']): OrderRecord => ({
      ...base,
      status: 'to-plan',
      stops,
      lines,
    });
    const copy = <T extends { id: string }>(x: T, ids: Map<string, string>) => {
      const id = uuid();
      ids.set(x.id, id);
      return { ...x, id };
    };
    const ids = new Map<string, string>();
    const movedStops = [p2, d2].map((s) => copy(s as NonNullable<typeof s>, ids));
    const movedLines = [l2].map((l) => ({
      ...(l as NonNullable<typeof l>),
      id: uuid(),
      fromStopId: ids.get(l?.fromStopId ?? '') ?? '',
      toStopId: ids.get(l?.toStopId ?? '') ?? '',
    }));
    return {
      order,
      kept: group([p1, d1] as OrderRecord['stops'], [l1] as OrderRecord['lines']),
      moved: group(movedStops, movedLines),
    };
  }

  const events = ({ moved }: { kept: OrderRef; moved: OrderRef }) => ({
    kept: [{ at: now, kind: 'split', other: moved.number, otherId: moved.id, lines: [2] } as const],
    moved: [{ ...created, origin: 'split', source: 'CMD-2026-000001' } as NewOrderEvent],
  });

  it('writes both groups in one transaction, the second numbered next, one family', async () => {
    const { order, kept, moved } = await merged();
    const split = await ports.orders.split(order.id, 1, kept, moved, 2026, events);
    expect(split?.kept).toMatchObject({
      id: order.id,
      number: 'CMD-2026-000001',
      version: 2,
      status: 'to-plan',
      splitRootId: order.id,
    });
    expect(split?.kept.lines).toHaveLength(1);
    expect(split?.moved).toMatchObject({
      number: 'CMD-2026-000002',
      version: 1,
      splitRootId: order.id,
    });
    expect((await ports.orders.history(order.id))[0]).toMatchObject({
      kind: 'split',
      other: 'CMD-2026-000002',
      lines: [2],
    });
    expect(await ports.orders.history(split?.moved.id ?? '')).toMatchObject([
      { kind: 'created', origin: 'split' },
    ]);
  });

  it('refused on a stale version, writes nothing and takes no number', async () => {
    const { order, kept, moved } = await merged();
    await expect(ports.orders.split(order.id, 7, kept, moved, 2026, events)).rejects.toThrow(
      StaleVersionError,
    );
    expect((await ports.orders.get(order.id))?.lines).toHaveLength(2);
    expect(await ports.orders.list({ statuses: ['to-plan', 'to-review'] })).toHaveLength(1);
    const next = await ports.orders.create(
      record(kept.customerId, kept.stops[0]?.siteId ?? '', kept.stops[1]?.siteId ?? ''),
      2026,
      created,
    );
    expect(next.number).toBe('CMD-2026-000002');
  });

  it('twice at the same time on one version: one wins, the other is stale', async () => {
    const { order, kept, moved } = await merged();
    const results = await Promise.allSettled([
      ports.orders.split(order.id, 1, kept, moved, 2026, events),
      ports.orders.split(order.id, 1, kept, { ...moved }, 2026, events),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await ports.orders.list({ statuses: ['to-plan', 'to-review'] })).toHaveLength(2);
  });

  it('a family is kept through a second split, and the reference search leaves it out', async () => {
    const { order, kept, moved } = await merged();
    const first = await ports.orders.split(order.id, 1, kept, moved, 2026, events);
    if (!first) throw new Error('not split');
    const again = await ports.orders.split(
      first.moved.id,
      1,
      { ...moved, lines: moved.lines, stops: moved.stops },
      record(kept.customerId, kept.stops[0]?.siteId ?? '', kept.stops[1]?.siteId ?? ''),
      2026,
      events,
    );
    expect(again?.moved.splitRootId).toBe(order.id);
    expect(again?.kept.splitRootId).toBe(order.id);
    expect(await ports.orders.findByReference(kept.customerId, 'LML-88213', order.id)).toEqual([]);
    const apart = await ports.orders.create(
      record(kept.customerId, kept.stops[0]?.siteId ?? '', kept.stops[1]?.siteId ?? ''),
      2026,
      created,
    );
    expect(
      (await ports.orders.findByReference(kept.customerId, 'LML-88213', order.id)).map(
        (o) => o.number,
      ),
    ).toEqual([apart.number]);
    expect(
      (await ports.orders.findByReference(kept.customerId, 'LML-88213', apart.id)).map(
        (o) => o.number,
      ),
    ).toEqual(['CMD-2026-000001', 'CMD-2026-000002', 'CMD-2026-000003']);
  });
});
