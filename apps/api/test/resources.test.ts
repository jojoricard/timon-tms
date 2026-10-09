// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// SPEC-001 through the HTTP API, on PGlite in-process, and on PostgreSQL 18 when
// TEST_DATABASE_URL is set (CI). The clock is fixed by each test.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
let now = Temporal.Instant.from('2026-10-06T10:00:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ ...createRepositories(database.db, { now: () => now }), geocoder: offline });
});

afterAll(() => database.close());

const at = (iso: string) => {
  now = Temporal.Instant.from(iso);
};

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

type Lists = {
  documentTypes: { id: string; code: string | null }[];
  bodyTypes: { id: string; code: string | null }[];
};
let lists: Lists;
const typeId = (code: string) => lists.documentTypes.find((t) => t.code === code)?.id;

beforeAll(async () => {
  lists = (await call('GET', '/reference-lists')).body;
});

const tractor = (plate: string) => ({
  kind: 'power-unit',
  vehicleKind: 'tractor',
  plate,
  category: 'N3',
  gvwKg: 19_000,
  gcwKg: 44_000,
});

async function driver(lastName: string, firstName: string) {
  const { status, body } = await call('POST', '/resources', {
    kind: 'driver',
    lastName,
    firstName,
  });
  expect(status).toBe(201);
  return body as { id: string; displayName: string };
}

async function document(resourceId: string, code: string, expiresOn: string) {
  const { status, body } = await call('POST', `/resources/${resourceId}/documents`, {
    documentTypeId: typeId(code),
    expiresOn,
  });
  expect(status).toBe(201);
  return body;
}

describe('documents and status', () => {
  it('criteria 1 to 3: a CE licence expiring on 2026-11-20', async () => {
    const benali = await driver('Benali', 'Karim');
    expect(benali.displayName).toBe('K. Benali');
    await document(benali.id, 'licence-ce', '2026-11-20');

    const status = async () => {
      const { body } = await call('GET', `/resources/${benali.id}`);
      return [body.documents[0].status, body.severity];
    };
    at('2026-10-25T10:00:00Z');
    expect(await status()).toEqual(['expiring', 'expiring']);
    at('2026-11-20T22:30:00Z'); // 23:30 in Paris
    expect(await status()).toEqual(['expiring', 'expiring']);
    at('2026-11-21T08:00:00Z');
    expect(await status()).toEqual(['expired', 'expired-blocking']);
  });

  it('criterion 4: a health check that expired yesterday warns but does not block', async () => {
    at('2026-10-06T10:00:00Z');
    const haddad = await driver('Haddad', 'Sofiane');
    const { documents, severity } = await document(haddad.id, 'health-check', '2026-10-05');
    expect(documents[0]).toMatchObject({ status: 'expired', blocking: false });
    expect(severity).toBe('expired-not-blocking');
  });

  it('refuses a second document of the same type', async () => {
    const vidal = await driver('Vidal', 'Pierre');
    await document(vidal.id, 'cpc', '2031-01-15');
    const { status, body } = await call('POST', `/resources/${vidal.id}/documents`, {
      documentTypeId: typeId('cpc'),
      expiresOn: '2032-01-15',
    });
    expect([status, body.error]).toEqual([409, 'document-type-taken']);
  });
});

describe('rules on vehicles', () => {
  it('criterion 5: "ab 123 cd" is refused while "AB-123-CD" is active, naming it', async () => {
    const first = await call('POST', '/resources', tractor('AB-123-CD'));
    expect(first.status).toBe(201);
    const second = await call('POST', '/resources', tractor('ab 123 cd'));
    expect(second).toEqual({
      status: 409,
      body: {
        error: 'plate-taken',
        owner: { id: first.body.id, name: 'AB-123-CD', kind: 'power-unit', vehicleKind: 'tractor' },
      },
    });
  });

  it('criterion 6: a light van in N3 is refused, with the allowed categories', async () => {
    const { status, body } = await call('POST', '/resources', {
      ...tractor('FG-204-HJ'),
      vehicleKind: 'light-van',
      gvwKg: 3_500,
      gcwKg: null,
    });
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'invalid',
      issues: [
        {
          field: 'category',
          code: 'category-not-allowed',
          params: { kind: 'light-van', category: 'N3', allowed: 'N1' },
        },
      ],
    });
  });

  it('criterion 7: a tractor takes no body type', async () => {
    const { status, body } = await call('POST', '/resources', {
      ...tractor('KL-678-MN'),
      bodyTypeId: lists.bodyTypes[0]?.id,
    });
    expect(status).toBe(400);
    expect(body.issues).toEqual([{ field: 'bodyTypeId', code: 'body-type-not-allowed' }]);
  });
});

describe('GET /api/expiries', () => {
  it('criteria 8 and 12: expired first, then by date, each type at its own lead time', async () => {
    at('2026-10-06T10:00:00Z');
    const day = Temporal.PlainDate.from('2026-10-06');
    for (const [plate, days] of [
      ['SR-4501', 45],
      ['SR-4502', 20],
      ['SR-4503', -3],
      ['SR-4504', 5],
    ] as const) {
      const { body } = await call('POST', '/resources', {
        kind: 'trailer',
        vehicleKind: 'semi-trailer',
        plate,
        category: 'O4',
        gvwKg: 35_000,
      });
      await document(body.id, 'roadworthiness', day.add({ days }).toString());
    }
    const lefevre = await driver('Lefèvre', 'Antoine');
    await document(lefevre.id, 'cpc', day.add({ days: 75 }).toString());

    const { body } = await call('GET', '/expiries?kind=trailer');
    expect(body.expiries.map((e: any) => [e.resource.name, e.status, e.daysUntil])).toEqual([
      ['SR-4503', 'expired', -3],
      ['SR-4504', 'expiring', 5],
      ['SR-4502', 'expiring', 20],
    ]);

    const drivers = (await call('GET', '/expiries?kind=driver')).body.expiries;
    expect(drivers.find((e: any) => e.resource.id === lefevre.id)).toMatchObject({
      status: 'expiring',
      daysUntil: 75,
      warnDays: 90,
    });
  });
});

describe('archiving', () => {
  it('criterion 11: an archived driver is hidden unless asked for, and can be restored', async () => {
    const girard = await driver('Girard', 'Thomas');
    const ids = async (query: string) =>
      (await call('GET', `/resources?kind=driver${query}`)).body.resources.map((r: any) => r.id);

    expect((await call('POST', `/resources/${girard.id}/archive`)).body.archived).toBe(true);
    expect(await ids('')).not.toContain(girard.id);
    expect(await ids('&archived=true')).toContain(girard.id);
    expect((await call('POST', `/resources/${girard.id}/restore`)).body.archived).toBe(false);
    expect(await ids('')).toContain(girard.id);
  });

  it('never deletes a resource', async () => {
    const roux = await driver('Roux', 'Julien');
    const response = await app.request(`/api/resources/${roux.id}`, { method: 'DELETE' });
    expect(response.status).toBe(404);
  });
});

describe('imports', () => {
  const drivers = (count: number, missingLastNameOn?: number) =>
    [
      'nom;prenom;permis_ce',
      ...Array.from({ length: count }, (_, i) =>
        i + 2 === missingLastNameOn ? ';Paul;15/03/2030' : `Import${i};Paul;15/03/2030`,
      ),
    ].join('\n');

  it('criterion 9: one line without a last name, nothing imported', async () => {
    const before = (await call('GET', '/resources?kind=driver')).body.counts.all;
    const check = await call('POST', '/imports/driver/check', { csv: drivers(40, 17) });
    expect(check.body.rows.filter((r: any) => r.issues.length > 0)).toMatchObject([
      { line: 17, issues: [{ field: 'lastName', code: 'required' }] },
    ]);
    const refused = await call('POST', '/imports/driver', { csv: drivers(40, 17) });
    expect([refused.status, refused.body.error]).toEqual([422, 'import-invalid']);
    expect((await call('GET', '/resources?kind=driver')).body.counts.all).toBe(before);
  });

  it('criterion 10: 40 valid trailers are imported and listed', async () => {
    const csv = [
      'plate;kind;category;gvw_kg;body_type;roadworthiness',
      ...Array.from(
        { length: 40 },
        (_, i) => `TR-${100 + i};semi-trailer;O4;35000;curtainsider;15/04/2027`,
      ),
    ].join('\n');
    expect(await call('POST', '/imports/trailer', { csv })).toEqual({
      status: 201,
      body: { imported: 40 },
    });
    const { body } = await call('GET', '/resources?kind=trailer&q=TR-');
    expect(body.resources).toHaveLength(40);
  });

  it('refuses a file over 1 MB with a code the interface translates', async () => {
    const big = `nom;prenom\n${'x'.repeat(1_000_001)}`;
    const check = await call('POST', '/imports/driver/check', { csv: big });
    expect(check.body.problem).toEqual({ code: 'too-large', params: { maxBytes: 1_000_000 } });
    const huge = await call('POST', '/imports/driver', { csv: 'x'.repeat(2_000_000) });
    expect(huge).toEqual({
      status: 413,
      body: { error: 'import-too-large', params: { maxBytes: 1_000_000 } },
    });
  });

  it('gives the template in French', async () => {
    const response = await app.request('/api/imports/trailer/template?lang=fr');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(await response.text()).toMatch(/^immatriculation;type;categorie;ptac_kg;/);
  });
});

describe('GET /api/resources/summary', () => {
  it('counts active resources per kind and the expiries', async () => {
    const { body } = await call('GET', '/resources/summary');
    expect(Object.keys(body.active)).toEqual(['driver', 'power-unit', 'trailer']);
    expect(body.expiries).toBeGreaterThan(0);
  });
});
