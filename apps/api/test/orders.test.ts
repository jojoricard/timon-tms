// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories, seedCustomers, seedOrders } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// SPEC-004 through the HTTP API, on the customers and sites of the demo haulier, on PGlite
// in-process and on PostgreSQL 18 when TEST_DATABASE_URL is set (CI). Neither the fleet nor the
// units are seeded: orders do not use them yet. The demo orders are seeded only for the list.
// Today is Monday 9 November 2026, 10:00 in Paris.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
const today = Temporal.PlainDate.from('2026-11-09');
const now = Temporal.Instant.from('2026-11-09T09:00:00Z');

/** `version`, for a write to an existing record, goes in If-Match (ADR-005). */
async function call(method: string, path: string, body?: unknown, version?: number) {
  const response = await app.request(`/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as any };
}

let customers: Record<string, string>;
let sites: Record<string, any>;

beforeAll(async () => {
  database = await createTestDatabase();
  await seedCustomers(createRepositories(database.db, { now: () => now }));
  app = createApp({ ...createRepositories(database.db, { now: () => now }), geocoder: offline });
  const list = (await call('GET', '/customers')).body.customers;
  customers = Object.fromEntries(list.map((c: any) => [c.code, c.id]));
  const all = (await call('GET', '/sites')).body.sites;
  sites = Object.fromEntries(all.map((s: any) => [s.name, s]));
});

afterAll(() => database.close());

const corbas = 'Hub de Corbas — cross-dock';
const meyzieu = 'Entrepôt pharma Meyzieu';
const dockC = 'Plateforme Saint-Priest — quai C';
const vienne = 'Silo de Vienne';
const chassieu = 'Bricolage Chassieu';

const stop = (
  id: string,
  kind: 'pickup' | 'delivery',
  site: string,
  date: string,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind,
  siteId: sites[site].id,
  date,
  start,
  end,
  bookingMade: sites[site].bookingRequired,
  ...extra,
});

const line = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  id,
  description: 'Yaourts nature, pots de 125 g',
  quantity: 10,
  packaging: 'euro-pallet',
  weightKg: 5_000,
  floorDm: 40,
  fromStopId: from,
  toStopId: to,
  ...extra,
});

let reference = 90_000;

/**
 * A pickup at Corbas on 10/11 from 08:00 to 10:00, then the deliveries given; a reference of
 * its own, so that no other order shares it.
 */
const order = (deliveries: ReturnType<typeof stop>[], lines?: ReturnType<typeof line>[]) => ({
  customerId: customers['MONTS-LAIT'],
  customerReference: `LML-${++reference}`,
  stops: [stop('p', 'pickup', corbas, '2026-11-10', '08:00', '10:00'), ...deliveries],
  lines: lines ?? deliveries.map((d, i) => line(`l${i}`, 'p', d.id)),
});

const codes = (issues: { field: string; code: string }[]) =>
  issues.map((i) => `${i.field}:${i.code}`);

describe('entering an order', () => {
  it('criterion 1: one pickup, two deliveries, the next CMD-2026- number, to plan', async () => {
    const before = (await call('GET', '/orders?to=2026-11-15')).body.orders as any[];
    const last = Math.max(0, ...before.map((o) => Number(o.number.slice(-6))));
    const { status, body } = await call(
      'POST',
      '/orders',
      order([
        stop('d1', 'delivery', chassieu, '2026-11-10', '10:00', '11:00'),
        stop('d2', 'delivery', meyzieu, '2026-11-10', '13:30', '14:30'),
      ]),
    );
    expect(status).toBe(201);
    expect(body.number).toBe(`CMD-2026-${String(last + 1).padStart(6, '0')}`);
    expect(body.status).toBe('to-plan');
    expect(body.version).toBe(1);
    expect(body.warnings).toEqual([]);
    expect(body.stops.map((s: any) => [s.kind, s.date, s.start, s.end])).toEqual([
      ['pickup', '2026-11-10', '08:00', '10:00'],
      ['delivery', '2026-11-10', '10:00', '11:00'],
      ['delivery', '2026-11-10', '13:30', '14:30'],
    ]);
    // The ids the form chose are replaced; each line follows its stops.
    expect(body.lines.map((l: any) => [l.fromStopId, l.toStopId])).toEqual([
      [body.stops[0].id, body.stops[1].id],
      [body.stops[0].id, body.stops[2].id],
    ]);
  });

  it('criterion 2: a site that is not located cannot be saved to plan, and says why', async () => {
    const { status, body } = await call(
      'POST',
      '/orders',
      order([stop('d', 'delivery', dockC, '2026-11-10', '12:00', '13:00')]),
    );
    expect(status).toBe(400);
    expect(body.issues).toEqual([
      { field: 'stops.1.siteId', code: 'site-not-located', params: { site: dockC } },
    ]);
  });

  it('criterion 3: a delivery from 06:00 to 07:30 after a pickup from 08:00 is refused', async () => {
    const { status, body } = await call(
      'POST',
      '/orders',
      order([stop('d', 'delivery', chassieu, '2026-11-10', '06:00', '07:30')]),
    );
    expect(status).toBe(400);
    expect(codes(body.issues)).toEqual(['stops.1.end:delivery-before-pickup']);
  });

  it('criterion 4: a slot during the closure of Meyzieu warns, and is saved', async () => {
    const { status, body } = await call(
      'POST',
      '/orders',
      order([stop('d', 'delivery', meyzieu, '2026-11-10', '12:15', '13:00')]),
    );
    expect(status).toBe(201);
    expect(body.warnings).toEqual([
      {
        code: 'site-closed',
        stopId: body.stops[1].id,
        params: { site: meyzieu, weekday: 2, start: '12:00', end: '13:30' },
      },
    ]);
  });

  it('criterion 5: a booking not ticked at a site that requires one', async () => {
    const { status, body } = await call(
      'POST',
      '/orders',
      order([
        stop('d', 'delivery', meyzieu, '2026-11-10', '14:00', '15:00', { bookingMade: false }),
      ]),
    );
    expect(status).toBe(201);
    expect(body.warnings.map((w: any) => w.code)).toEqual(['booking-to-make']);
  });

  it('criterion 6: 18,000 kg and 9,000 kg warn that 27,000 kg is over 25,000 kg', async () => {
    const delivery = stop('d', 'delivery', chassieu, '2026-11-10', '10:00', '11:00');
    const { status, body } = await call(
      'POST',
      '/orders',
      order(
        [delivery],
        [
          line('l1', 'p', 'd', { weightKg: 18_000, floorDm: 50 }),
          line('l2', 'p', 'd', { weightKg: 9_000, floorDm: 50 }),
        ],
      ),
    );
    expect(status).toBe(201);
    expect(body.warnings).toEqual([
      { code: 'weight-over', stopId: null, params: { weightKg: 27_000, maxKg: 25_000 } },
    ]);
    expect(body.totals).toMatchObject({ weightKg: 27_000, floorDm: 100 });
  });

  it('lines with no common temperature range warn, and list each range with its lines', async () => {
    const delivery = stop('d', 'delivery', chassieu, '2026-11-10', '10:00', '11:00');
    const { status, body } = await call(
      'POST',
      '/orders',
      order(
        [delivery],
        [
          line('l1', 'p', 'd', { temperatureMin: -20, temperatureMax: -18 }),
          line('l2', 'p', 'd', { temperatureMin: 2, temperatureMax: 6 }),
        ],
      ),
    );
    expect(status).toBe(201);
    expect(body.warnings).toEqual([
      { code: 'temperature-conflict', stopId: null, params: { lines: '1, 2' } },
    ]);
    expect(
      body.requirements
        .filter((r: any) => r.code === 'temperature')
        .map((r: any) => [r.params, r.source.lines]),
    ).toEqual([
      [{ min: -20, max: -18 }, [1]],
      [{ min: 2, max: 6 }, [2]],
    ]);
  });

  it('a customer, a site or a body type that does not exist is an issue on its field', async () => {
    const { status, body } = await call('POST', '/orders', {
      ...order([stop('d', 'delivery', chassieu, '2026-11-10', '10:00', '11:00')]),
      customerId: globalThis.crypto.randomUUID(),
      bodyTypeId: globalThis.crypto.randomUUID(),
    });
    expect(status).toBe(400);
    expect(codes(body.issues)).toEqual(['customerId:unknown-value', 'bodyTypeId:unknown-value']);
  });

  it('a text over its limit is refused on its field', async () => {
    const { status, body } = await call('POST', '/orders', {
      ...order([stop('d', 'delivery', chassieu, '2026-11-10', '10:00', '11:00')]),
      customerReference: 'x'.repeat(101),
    });
    expect(status).toBe(400);
    expect(body.issues).toEqual([
      { field: 'customerReference', code: 'too-long', params: { max: 100 } },
    ]);
  });
});

describe('an existing order', () => {
  async function created() {
    const { body } = await call(
      'POST',
      '/orders',
      order([stop('d', 'delivery', meyzieu, '2026-11-10', '11:00', '12:00')]),
    );
    return body;
  }

  /** The body of a PUT: the order as read, with `change` applied. */
  const input = (o: any, change: (o: any) => void = () => {}) => {
    const copy = structuredClone({
      customerId: o.customerId,
      customerReference: o.customerReference,
      notes: o.notes,
      bodyTypeId: o.bodyTypeId,
      sideLoading: o.sideLoading,
      tailLift: o.tailLift,
      stops: o.stops,
      lines: o.lines,
    });
    change(copy);
    return copy;
  };

  it('criterion 14: a slot changed shows in the history, old and new', async () => {
    const o = await created();
    const changed = await call(
      'PUT',
      `/orders/${o.id}`,
      input(o, (c) => {
        c.stops[1].start = '12:15';
        c.stops[1].end = '13:00';
      }),
      o.version,
    );
    expect(changed.status).toBe(200);
    expect(changed.body.version).toBe(2);
    expect(changed.body.stops.map((s: any) => s.id)).toEqual(o.stops.map((s: any) => s.id));
    const { body } = await call('GET', `/orders/${o.id}/history`);
    expect(body.events.map((e: any) => e.kind)).toEqual(['changed', 'created']);
    expect(body.events[0].changes).toEqual([
      {
        kind: 'stop-changed',
        field: 'slot',
        stopKind: 'delivery',
        site: meyzieu,
        line: null,
        description: null,
        from: '2026-11-10 11:00–12:00',
        to: '2026-11-10 12:15–13:00',
        goods: null,
      },
    ]);
    expect(body.events[0].at).toBe(now.toString());
    expect(body.events[0].authorId).toBeNull();
    expect(body.events[1]).toMatchObject({ origin: 'hand', status: 'to-plan', source: null });
    expect((await call('GET', `/orders/${o.id}`)).body.historyCount).toBe(2);
  });

  it('rule 7: a change needs the version read (ADR-005)', async () => {
    const o = await created();
    expect((await call('PUT', `/orders/${o.id}`, input(o))).status).toBe(428);
    expect((await call('PUT', `/orders/${o.id}`, input(o), o.version)).status).toBe(200);
    const stale = await call('PUT', `/orders/${o.id}`, input(o), o.version);
    expect(stale).toEqual({ status: 412, body: { error: 'stale', version: 2 } });
    expect((await call('POST', `/orders/${o.id}/cancel`, { reason: 'x' }, 1)).status).toBe(412);
  });

  it('criterion 10: cancelling asks a reason, makes the order read only and hides it', async () => {
    const o = await created();
    const blank = await call('POST', `/orders/${o.id}/cancel`, { reason: ' ' }, o.version);
    expect(blank.status).toBe(400);
    expect(codes(blank.body.issues)).toEqual(['reason:required']);

    const { status, body } = await call(
      'POST',
      `/orders/${o.id}/cancel`,
      { reason: 'Annulée par le client au téléphone' },
      o.version,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Annulée par le client au téléphone',
      version: 2,
    });
    expect((await call('PUT', `/orders/${o.id}`, input(o), 2)).body).toEqual({
      error: 'cancelled',
    });
    expect((await call('POST', `/orders/${o.id}/cancel`, { reason: 'x' }, 2)).status).toBe(409);

    const listed = async (query: string) =>
      (await call('GET', `/orders${query}`)).body.orders.map((x: any) => x.id);
    expect(await listed('')).not.toContain(o.id);
    expect(await listed('?cancelled=true')).toContain(o.id);
    const history = (await call('GET', `/orders/${o.id}/history`)).body.events;
    expect(history[0]).toMatchObject({
      kind: 'status',
      from: 'to-plan',
      to: 'cancelled',
      reason: 'Annulée par le client au téléphone',
    });
  });

  it('criterion 16: a cancelled order duplicated becomes a new order to plan', async () => {
    const o = await created();
    await call('POST', `/orders/${o.id}/cancel`, { reason: 'Reportée' }, o.version);
    const copy = await call('POST', '/orders', { ...input(o), duplicatedFrom: o.id });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ status: 'to-plan', customerId: o.customerId });
    expect(copy.body.number).not.toBe(o.number);
    const history = (await call('GET', `/orders/${copy.body.id}/history`)).body.events;
    expect(history).toMatchObject([{ kind: 'created', origin: 'duplicate', source: o.number }]);
  });

  it('a reference already used by another order of the customer warns', async () => {
    const o = await created();
    const { body: again } = await call('POST', '/orders', {
      ...input(o),
      stops: o.stops.map((s: any) => ({ ...s, id: `new-${s.id}` })),
      lines: o.lines.map((l: any) => ({
        ...l,
        id: `new-${l.id}`,
        fromStopId: `new-${l.fromStopId}`,
        toStopId: `new-${l.toStopId}`,
      })),
    });
    expect(again.warnings).toEqual([
      {
        code: 'reference-used',
        stopId: null,
        params: { orders: expect.stringContaining(o.number) },
      },
    ]);
  });
});

describe('the list of orders', () => {
  beforeAll(() => seedOrders(createRepositories(database.db, { now: () => now }), today));

  it('shows the orders to plan and to review from today, by first pickup', async () => {
    const { body } = await call('GET', '/orders?to=2026-11-09');
    expect(body.day).toBe('2026-11-09');
    expect(body.orders.length).toBeGreaterThan(5);
    const starts = body.orders.map((o: any) => `${o.firstPickup.date} ${o.firstPickup.start}`);
    expect(starts).toEqual([...starts].sort());
    expect(body.orders.every((o: any) => o.firstPickup.date === '2026-11-09')).toBe(true);
  });

  it('finds an order by its number or the customer’s reference', async () => {
    const all = (await call('GET', '/orders?to=2026-11-15')).body.orders;
    const target = all[3];
    const byNumber = (await call('GET', `/orders?to=2026-11-15&q=${target.number}`)).body;
    expect(byNumber.orders.map((o: any) => o.id)).toEqual([target.id]);
    const byReference = (
      await call('GET', `/orders?to=2026-11-15&q=${target.customerReference.toLowerCase()}`)
    ).body;
    expect(byReference.orders.map((o: any) => o.id)).toContain(target.id);
  });

  it('filters by status and customer, and counts each status', async () => {
    const review = (await call('GET', '/orders?to=2026-11-15&status=to-review')).body;
    expect(review.orders.map((o: any) => o.review.map((i: any) => i.code))).toEqual([
      ['site-not-located'],
      ['several-pickups-and-deliveries'],
    ]);
    expect(review.counts['to-review']).toBe(2);
    const pharmalp = (await call('GET', `/orders?to=2026-11-15&customer=${customers.PHARMALP}`))
      .body;
    expect(pharmalp.orders.every((o: any) => o.customer.code === 'PHARMALP')).toBe(true);
  });
});

describe('rule 8: archiving a customer or a site an order uses', () => {
  let used: { number: string };
  beforeAll(async () => {
    const { status, body } = await call('POST', '/orders', {
      ...order([stop('d', 'delivery', vienne, '2026-11-10', '12:00', '13:00')]),
      customerId: customers['RHONE-AGRO'],
    });
    expect(status).toBe(201);
    used = body;
  });

  it('criterion 15: archiving the Silo de Vienne is refused and names the order', async () => {
    const site = sites[vienne];
    const { status, body } = await call(
      'POST',
      `/sites/${site.id}/archive`,
      undefined,
      site.version,
    );
    expect(status).toBe(409);
    expect(body.error).toBe('in-use');
    expect(body.orders.map((o: any) => o.number)).toContain(used.number);
    expect((await call('GET', `/sites/${site.id}`)).body.site.archived).toBe(false);
  });

  it('archiving a customer with orders is refused too', async () => {
    const { status, body } = await call(
      'POST',
      `/customers/${customers['RHONE-AGRO']}/archive`,
      undefined,
      1,
    );
    expect(status).toBe(409);
    expect(body.error).toBe('in-use');
    expect(body.orders.map((o: any) => o.number)).toContain(used.number);
  });
});
