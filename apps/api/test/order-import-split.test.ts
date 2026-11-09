// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories, seedCustomers } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// SPEC-004, Import and Splitting an order, through the HTTP API, on the customers and sites of
// the demo haulier (criteria 11 to 13). Today is Monday 9 November 2026, 10:00 in Paris.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
const now = Temporal.Instant.from('2026-11-09T09:00:00Z');

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

let sites: Record<string, any>;

beforeAll(async () => {
  database = await createTestDatabase();
  await seedCustomers(createRepositories(database.db, { now: () => now }));
  app = createApp({ ...createRepositories(database.db, { now: () => now }), geocoder: offline });
  const all = (await call('GET', '/sites')).body.sites;
  sites = Object.fromEntries(all.map((s: any) => [s.name, s]));
});

afterAll(() => database.close());

const corbas = 'Hub de Corbas — cross-dock';
const venissieux = 'Dépôt de Vénissieux';
const torino = 'Transalpina magazzino';
const chassieu = 'Bricolage Chassieu';
const vienne = 'Silo de Vienne';
const dockC = 'Plateforme Saint-Priest — quai C';

const header = [
  'customer_code',
  'customer_reference',
  'pickup_site',
  'pickup_date',
  'pickup_from',
  'pickup_to',
  'delivery_site',
  'delivery_date',
  'delivery_from',
  'delivery_to',
  'description',
  'quantity',
  'packaging',
  'weight_kg',
  'floor_m',
  'un_number',
  'adr_class',
  'temperature_min',
  'temperature_max',
  'body_type',
  'side_loading',
  'tail_lift',
  'notes',
];

type Row = Partial<Record<(typeof header)[number], string>>;

let reference = 70_000;
/** A reference no other test uses. */
const nextReference = (prefix = 'TR') => `${prefix}-${++reference}`;

/** A goods line from Corbas on 10/11, 07:00–08:00, to Chassieu at 10:00–11:00, as `change` says. */
const row = (change: Row = {}): Row => ({
  customer_code: 'TRANSALP-IT',
  customer_reference: 'TR-77/11',
  pickup_site: corbas,
  pickup_date: '10/11/2026',
  pickup_from: '07:00',
  pickup_to: '08:00',
  delivery_site: chassieu,
  delivery_date: '10/11/2026',
  delivery_from: '10:00',
  delivery_to: '11:00',
  description: 'Disques de frein',
  quantity: '8',
  packaging: 'pallet',
  weight_kg: '4200',
  ...change,
});

const csv = (rows: Row[], separator = ';') =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))]
    .map((cells) => cells.join(separator))
    .join('\r\n');

const check = (rows: Row[], separator?: string) =>
  call('POST', '/imports/orders/check', { csv: csv(rows, separator) });
const runImport = (rows: Row[], fileName = 'transalpina-nov.csv') =>
  call('POST', '/imports/orders', { csv: csv(rows), fileName });

const listed = async (q: string) =>
  (await call('GET', `/orders?to=2026-12-31&q=${encodeURIComponent(q)}`)).body.orders as any[];

describe('the import file', () => {
  it('has a template in UTF-8 with a byte order mark, in English and French', async () => {
    // Read as bytes: decoding the body as text drops the byte order mark.
    const template = async (lang: string) => {
      const response = await app.request(`/api/imports/orders/template?lang=${lang}`);
      expect(response.headers.get('content-type')).toContain('text/csv');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      return new TextDecoder().decode(bytes);
    };
    expect((await template('en')).startsWith('customer_code;customer_reference;pickup_site;')).toBe(
      true,
    );
    expect((await template('fr')).startsWith('code_client;reference_client;site_enlevement;')).toBe(
      true,
    );
  });

  it('lists the values each column accepts', async () => {
    const { body } = await call('GET', '/imports/orders/columns?lang=en');
    const accepts = Object.fromEntries(body.map((c: any) => [c.header, c.accepts]));
    expect(accepts.pickup_date).toEqual({ kind: 'date' });
    expect(accepts.pickup_from).toEqual({ kind: 'time' });
    expect(accepts.weight_kg).toEqual({ kind: 'weight' });
    expect(accepts.floor_m).toEqual({ kind: 'metres' });
    expect(accepts.side_loading).toEqual({ kind: 'yes-no' });
    expect(accepts.packaging.kind).toBe('one-of');
    expect(accepts.packaging.values[0]).toContain('euro pallet');
    expect(accepts.adr_class.values.flat()).toContain('5.1');
    expect(accepts.body_type.values.flat()).toContain('curtainsider');
    expect(body.find((c: any) => c.header === 'customer_code').required).toBe(true);
  });
});

describe('criterion 11: lines sharing a reference with two pickups and two deliveries', () => {
  it('make one order, imported to review with the reason, the file in its history', async () => {
    const ref = nextReference();
    const rows = [
      row({ customer_reference: ref, delivery_site: torino, delivery_date: '11/11/2026' }),
      row({
        customer_reference: ref,
        pickup_site: venissieux,
        pickup_from: '09:00',
        pickup_to: '10:00',
        delivery_from: '11:00',
        delivery_to: '12:00',
        description: 'Boîtes de vitesses',
      }),
    ];
    const preview = await check(rows);
    expect(preview.status).toBe(200);
    expect(preview.body.ready).toBe(true);
    expect(preview.body.summary).toEqual({
      lines: 2,
      orders: 1,
      ready: 0,
      toReview: 1,
      withErrors: 0,
    });
    expect(preview.body.orders).toMatchObject([
      {
        reference: ref,
        customer: { code: 'TRANSALP-IT', name: 'Transalpina Ricambi S.r.l.' },
        lines: [2, 3],
        pickups: 2,
        deliveries: 2,
        goodsLines: 2,
        result: 'to-review',
        review: [{ code: 'several-pickups-and-deliveries' }],
      },
    ]);

    const imported = await runImport(rows);
    expect(imported).toMatchObject({ status: 201, body: { imported: 1, toReview: 1 } });
    const [order] = await listed(ref);
    expect(order).toMatchObject({ status: 'to-review', pickups: 2, deliveries: 2 });
    expect(order.review).toEqual([
      {
        field: 'stops',
        code: 'several-pickups-and-deliveries',
        params: { pickups: 2, deliveries: 2 },
      },
    ]);
    const history = (await call('GET', `/orders/${order.id}/history`)).body.events;
    expect(history).toMatchObject([
      {
        kind: 'created',
        origin: 'import',
        status: 'to-review',
        fileName: 'transalpina-nov.csv',
        fileLines: [2, 3],
      },
    ]);
  });
});

describe('criterion 13: an unknown site', () => {
  it('is an error on its line, and nothing is imported', async () => {
    const ref = nextReference('PH');
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({
        customer_code: 'PHARMALP',
        customer_reference: `${ref}-${Math.floor(i / 2)}`,
        description: `Ligne ${i + 2}`,
        ...(i === 5 ? { pickup_site: 'Pharmalp, quai froid' } : {}),
      }),
    );
    const preview = await check(rows);
    expect(preview.body.ready).toBe(false);
    const errors = preview.body.rows.filter((r: any) => r.issues.length > 0);
    expect(errors.map((r: any) => [r.line, r.issues])).toEqual([
      [
        7,
        [{ field: 'pickupSite', code: 'unknown-value', params: { value: 'Pharmalp, quai froid' } }],
      ],
    ]);
    expect(preview.body.summary).toMatchObject({ lines: 6, orders: 3, ready: 2, withErrors: 1 });
    expect(preview.body.orders.map((o: any) => [o.reference, o.lines, o.result])).toEqual([
      [`${ref}-0`, [2, 3], 'ready'],
      [`${ref}-1`, [4, 5], 'ready'],
      [`${ref}-2`, [6, 7], 'errors'],
    ]);

    const refused = await runImport(rows);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('import-invalid');
    expect(refused.body.check.rows.find((r: any) => r.line === 7).issues).toHaveLength(1);
    expect(await listed(ref)).toEqual([]);
  });
});

describe('the lines of an import', () => {
  it('read tabs, ISO and French dates, an end on the next day, metres and yes or no', async () => {
    const ref = nextReference();
    const preview = await check(
      [
        row({
          customer_reference: ref,
          pickup_date: '2026-11-10',
          pickup_from: '22:00',
          pickup_to: '02:00',
          delivery_date: '11/11/2026',
          delivery_from: '08:00',
          delivery_to: '09:00',
          floor_m: '2,4',
          temperature_min: '2',
          temperature_max: '6',
          body_type: 'tautliner',
          side_loading: 'oui',
          tail_lift: 'no',
          packaging: 'Palette Europe',
        }),
      ],
      '\t',
    );
    expect(preview.body.rows[0].issues).toEqual([]);
    expect(preview.body.ready).toBe(true);
    const imported = await call('POST', '/imports/orders', {
      csv: csv(
        [
          row({
            customer_reference: ref,
            pickup_date: '2026-11-10',
            pickup_from: '22:00',
            pickup_to: '02:00',
            delivery_date: '11/11/2026',
            delivery_from: '08:00',
            delivery_to: '09:00',
            floor_m: '2,4',
            temperature_min: '2',
            temperature_max: '6',
            body_type: 'tautliner',
            side_loading: 'oui',
            tail_lift: 'no',
            packaging: 'Palette Europe',
          }),
        ],
        '\t',
      ),
      fileName: 'tabs.tsv',
    });
    expect(imported.status).toBe(201);
    const [summary] = await listed(ref);
    const { body: order } = await call('GET', `/orders/${summary.id}`);
    expect(order.stops.map((s: any) => [s.kind, s.date, s.start, s.end])).toEqual([
      ['pickup', '2026-11-10', '22:00', '02:00'],
      ['delivery', '2026-11-11', '08:00', '09:00'],
    ]);
    expect(order.lines[0]).toMatchObject({
      packaging: 'euro-pallet',
      floorDm: 24,
      temperatureMin: 2,
      temperatureMax: 6,
    });
    expect(order).toMatchObject({ sideLoading: true, tailLift: false, status: 'to-plan' });
    expect(order.bodyTypeId).not.toBeNull();
  });

  it('name each wrong value on its line and column', async () => {
    const preview = await check([
      row({
        customer_reference: nextReference(),
        customer_code: 'NOBODY',
        pickup_date: '31/02/2026',
        pickup_from: '7h',
        quantity: 'huit',
        packaging: 'caisse',
        weight_kg: '',
        adr_class: '10',
        side_loading: 'peut-être',
      }),
    ]);
    expect(preview.body.rows[0].issues).toEqual([
      { field: 'customerCode', code: 'unknown-value', params: { value: 'NOBODY' } },
      { field: 'pickupDate', code: 'invalid-date', params: { value: '31/02/2026' } },
      { field: 'pickupFrom', code: 'invalid-time', params: { value: '7h' } },
      { field: 'quantity', code: 'invalid-number', params: { value: 'huit' } },
      { field: 'packaging', code: 'unknown-value', params: { value: 'caisse' } },
      { field: 'weightKg', code: 'required' },
      { field: 'adrClass', code: 'unknown-value', params: { value: '10' } },
      { field: 'sideLoading', code: 'unknown-value', params: { value: 'peut-être' } },
    ]);
  });

  it('find a site by its exact name once spaces are trimmed, and refuse two of that name', async () => {
    const trimmed = await check([
      row({ customer_reference: nextReference(), delivery_site: `  ${vienne} ` }),
    ]);
    expect(trimmed.body.rows[0].issues).toEqual([]);
    const otherCase = await check([
      row({ customer_reference: nextReference(), delivery_site: vienne.toUpperCase() }),
    ]);
    expect(otherCase.body.rows[0].issues).toEqual([
      { field: 'deliverySite', code: 'unknown-value', params: { value: vienne.toUpperCase() } },
    ]);

    const name = 'Entrepôt en double';
    const repositories = createRepositories(database.db, { now: () => now });
    const silo = await repositories.sites.get(sites[vienne].id);
    if (!silo) throw new Error('No Silo de Vienne');
    for (const city of ['Lyon', 'Villeurbanne'])
      await repositories.sites.create({ ...silo, name, city });
    const twice = await check([row({ customer_reference: nextReference(), pickup_site: name })]);
    expect(twice.body.rows[0].issues).toEqual([
      { field: 'pickupSite', code: 'site-ambiguous', params: { value: name, count: 2 } },
    ]);
  });

  it('must agree on the columns of the order', async () => {
    const ref = nextReference();
    const preview = await check([
      row({ customer_reference: ref, notes: 'Quai 4' }),
      row({ customer_reference: ref, notes: 'Quai 5', delivery_site: vienne }),
    ]);
    expect(preview.body.rows[1].issues).toEqual([
      { field: 'notes', code: 'header-disagrees', params: { line: 2 } },
    ]);
    expect(preview.body.ready).toBe(false);
  });

  it('give a delivery before its pickup as an error on the line of the delivery', async () => {
    const preview = await check([
      row({ customer_reference: nextReference(), delivery_from: '05:00', delivery_to: '06:00' }),
    ]);
    expect(preview.body.rows[0].issues).toEqual([
      {
        field: 'deliveryTo',
        code: 'delivery-before-pickup',
        params: { site: corbas, start: '07:00' },
      },
    ]);
  });

  it('import an order with a site not located to review', async () => {
    const ref = nextReference();
    const rows = [row({ customer_reference: ref, delivery_site: dockC })];
    expect((await check(rows)).body.orders[0]).toMatchObject({
      result: 'to-review',
      review: [{ code: 'site-not-located', params: { site: dockC } }],
    });
    expect((await runImport(rows)).body).toEqual({ imported: 1, toReview: 1 });
  });

  it('make one order per line without a reference, each with a warning', async () => {
    const rows = [
      row({ customer_reference: '' }),
      row({ customer_reference: '', delivery_site: vienne }),
    ];
    const preview = await check(rows);
    expect(preview.body.summary).toMatchObject({ orders: 2, ready: 2 });
    expect(preview.body.orders.map((o: any) => [o.reference, o.lines, o.warnings[0]])).toEqual([
      [null, [2], { code: 'no-reference', stopId: null, params: {} }],
      [null, [3], { code: 'no-reference', stopId: null, params: {} }],
    ]);
  });

  it('show the warnings each order will have', async () => {
    const ref = nextReference();
    const preview = await check([row({ customer_reference: ref, weight_kg: '26000' })]);
    // The Hub de Corbas requires a booking, and the file has no column for it.
    expect(preview.body.orders[0].result).toBe('ready');
    expect(preview.body.orders[0].warnings).toEqual([
      { code: 'booking-to-make', stopId: 's1', params: { site: corbas } },
      { code: 'weight-over', stopId: null, params: { weightKg: 26_000, maxKg: 25_000 } },
    ]);
  });
});

/** Imports one order of `rows` and returns it as the API reads it. */
async function imported(rows: Row[]) {
  const ref = rows[0]?.customer_reference ?? '';
  expect((await runImport(rows)).status).toBe(201);
  const [summary] = await listed(ref);
  return (await call('GET', `/orders/${summary.id}`)).body;
}

const linesOf = (order: any, ...descriptions: string[]) =>
  order.lines.filter((l: any) => descriptions.includes(l.description)).map((l: any) => l.id);

describe('criterion 12: splitting an order to review', () => {
  /** The order of the split mockup: Corbas and Vénissieux, to Turin and to Chassieu. */
  const mockup = (ref: string) => [
    row({ customer_reference: ref, delivery_site: torino, delivery_date: '11/11/2026' }),
    row({
      customer_reference: ref,
      description: 'Filtres',
      delivery_site: torino,
      delivery_date: '11/11/2026',
    }),
    row({ customer_reference: ref, description: 'Panneaux' }),
    row({
      customer_reference: ref,
      description: 'Boîtes de vitesses',
      pickup_site: venissieux,
      pickup_from: '09:00',
      pickup_to: '10:00',
      delivery_site: torino,
      delivery_date: '11/11/2026',
    }),
    row({
      customer_reference: ref,
      description: 'Roues de secours',
      pickup_site: venissieux,
      pickup_from: '09:00',
      pickup_to: '10:00',
      delivery_site: torino,
      delivery_date: '11/11/2026',
    }),
  ];

  it('makes two orders to plan, the first keeping its number, both histories recording it', async () => {
    const order = await imported(mockup(nextReference()));
    expect(order.status).toBe('to-review');
    const moved = linesOf(order, 'Boîtes de vitesses', 'Roues de secours');

    const { status, body } = await call(
      'POST',
      `/orders/${order.id}/split`,
      { lines: moved },
      order.version,
    );
    expect(status).toBe(200);
    expect(body.kept).toMatchObject({
      id: order.id,
      number: order.number,
      status: 'to-plan',
      version: order.version + 1,
      shape: 'one-pickup',
    });
    expect(body.kept.lines.map((l: any) => l.description)).toEqual([
      'Disques de frein',
      'Filtres',
      'Panneaux',
    ]);
    expect(body.kept.stops.map((s: any) => s.siteId)).toEqual([
      sites[corbas].id,
      sites[torino].id,
      sites[chassieu].id,
    ]);
    const next = Number(order.number.slice(-6)) + 1;
    expect(body.moved).toMatchObject({
      number: `CMD-2026-${String(next).padStart(6, '0')}`,
      status: 'to-plan',
      version: 1,
      customerReference: order.customerReference,
      shape: 'one-pickup',
    });
    expect(body.moved.stops.map((s: any) => s.siteId)).toEqual([
      sites[venissieux].id,
      sites[torino].id,
    ]);
    // Both share the customer's reference, and do not warn of it.
    for (const o of [body.kept, body.moved]) {
      expect(o.warnings.map((w: any) => w.code)).not.toContain('reference-used');
    }
    // The stop both groups use is copied, not shared.
    expect(body.moved.stops[1].id).not.toBe(body.kept.stops[1].id);

    const kept = (await call('GET', `/orders/${order.id}/history`)).body.events;
    expect(kept.slice(0, 2)).toMatchObject([
      { kind: 'split', other: body.moved.number, otherId: body.moved.id, lines: [4, 5] },
      { kind: 'status', from: 'to-review', to: 'to-plan', reason: null },
    ]);
    const created = (await call('GET', `/orders/${body.moved.id}/history`)).body.events;
    expect(created).toMatchObject([
      {
        kind: 'created',
        origin: 'split',
        status: 'to-plan',
        source: order.number,
        sourceId: order.id,
      },
    ]);
  });

  it('keeps a group of the wrong shape to review, to be split again', async () => {
    const order = await imported(mockup(nextReference()));
    const first = await call(
      'POST',
      `/orders/${order.id}/split`,
      { lines: linesOf(order, 'Roues de secours') },
      order.version,
    );
    expect(first.status).toBe(200);
    expect(first.body.kept).toMatchObject({ status: 'to-review', shape: 'several-both' });
    expect(first.body.moved).toMatchObject({ status: 'to-plan' });

    const again = await call(
      'POST',
      `/orders/${order.id}/split`,
      { lines: linesOf(first.body.kept, 'Boîtes de vitesses') },
      first.body.kept.version,
    );
    expect(again.status).toBe(200);
    expect(again.body.kept.status).toBe('to-plan');
    expect(again.body.moved.status).toBe('to-plan');
  });

  it('is under the order’s version, and only for an order to review of the wrong shape', async () => {
    const order = await imported(mockup(nextReference()));
    const lines = { lines: linesOf(order, 'Roues de secours') };
    const path = `/orders/${order.id}/split`;
    expect((await call('POST', path, lines)).status).toBe(428);
    expect(await call('POST', path, lines, order.version + 1)).toMatchObject({
      status: 412,
      body: { error: 'stale', version: order.version },
    });
    expect((await call('POST', path, { lines: [] }, order.version)).body).toEqual({
      error: 'invalid',
      issues: [{ field: 'lines', code: 'split-group-empty' }],
    });
    const unknown = globalThis.crypto.randomUUID();
    expect((await call('POST', path, { lines: [unknown] }, order.version)).body.issues).toEqual([
      { field: 'lines', code: 'unknown-value', params: { value: unknown } },
    ]);
    expect(
      (await call('POST', `/orders/${globalThis.crypto.randomUUID()}/split`, lines, 1)).status,
    ).toBe(404);

    const simple = await imported([row({ customer_reference: nextReference() })]);
    expect(
      await call(
        'POST',
        `/orders/${simple.id}/split`,
        { lines: [simple.lines[0].id] },
        simple.version,
      ),
    ).toMatchObject({ status: 409, body: { error: 'not-splittable' } });

    await call('POST', `/orders/${order.id}/cancel`, { reason: 'Doublon' }, order.version);
    expect((await call('POST', path, lines, order.version + 1)).body).toEqual({
      error: 'cancelled',
    });
  });
});

describe('a split family and the customer’s reference', () => {
  it('orders split from one another do not warn of a reference used; others do', async () => {
    const ref = nextReference();
    // Three pickups and three deliveries, one line each: split twice.
    const three = [
      row({ customer_reference: ref, description: 'A' }),
      row({
        customer_reference: ref,
        description: 'B',
        pickup_site: venissieux,
        delivery_site: vienne,
      }),
      row({
        customer_reference: ref,
        description: 'C',
        pickup_site: torino,
        pickup_from: '05:00',
        pickup_to: '06:00',
        delivery_site: dockC.replace('quai C', 'quai B'),
      }),
    ];
    const order = await imported(three);
    const first = await call(
      'POST',
      `/orders/${order.id}/split`,
      { lines: linesOf(order, 'C') },
      order.version,
    );
    expect(first.body.kept.status).toBe('to-review');
    const second = await call(
      'POST',
      `/orders/${order.id}/split`,
      { lines: linesOf(first.body.kept, 'B') },
      first.body.kept.version,
    );
    expect(second.status).toBe(200);
    const family = [order.id, first.body.moved.id, second.body.moved.id];
    for (const id of family) {
      const { body } = await call('GET', `/orders/${id}`);
      expect(body.warnings.filter((w: any) => w.code === 'reference-used')).toEqual([]);
    }
    for (const summary of await listed(ref)) {
      expect(summary.warnings.filter((w: any) => w.code === 'reference-used')).toEqual([]);
    }

    // An order of the same customer with that reference, entered apart, is still warned of.
    expect((await runImport([row({ customer_reference: ref, description: 'D' })])).status).toBe(
      201,
    );
    const all = await listed(ref);
    expect(all).toHaveLength(4);
    const other = all.find((o: any) => !family.includes(o.id));
    const numbers = (o: any) =>
      String(o.warnings.find((w: any) => w.code === 'reference-used')?.params.orders ?? '');
    for (const o of all.filter((x: any) => family.includes(x.id))) {
      expect(numbers(o)).toBe(other.number);
    }
    expect(numbers(other).split(', ').sort()).toEqual(
      all
        .filter((x: any) => family.includes(x.id))
        .map((x: any) => x.number)
        .sort(),
    );
    const { body: detail } = await call('GET', `/orders/${other.id}`);
    expect(numbers(detail).split(', ')).toHaveLength(3);
  });
});
