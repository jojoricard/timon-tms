// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ADR-005 through the HTTP API, on PGlite in-process, and on PostgreSQL 18 when
// TEST_DATABASE_URL is set (CI): reads carry the version, every write to an existing record
// sends it in If-Match, a stale one answers 412 with the current version, a missing one 428.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
const now = Temporal.Instant.from('2026-10-27T08:00:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ ...createRepositories(database.db, { now: () => now }), geocoder: offline });
});

afterAll(() => database.close());

/** `version` undefined sends no If-Match; a number sends it as a strong entity tag. */
async function call(method: string, path: string, version?: number | string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== undefined) {
    headers['if-match'] = typeof version === 'number' ? `"${version}"` : version;
  }
  const response = await app.request(`/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as any };
}

async function created(path: string, body: unknown) {
  const answer = await call('POST', path, undefined, body);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body;
}

/**
 * The rule on one write: refused without If-Match (428), refused from a stale version (412,
 * with the current version), applied from the current one, which it moves on by one.
 */
async function expectGuarded(
  write: (version?: number | string) => ReturnType<typeof call>,
  read: () => Promise<any>,
  current: number,
) {
  const missing = await write();
  expect(missing.status).toBe(428);
  expect(missing.body).toMatchObject({ error: 'precondition-required' });
  expect((await write('*')).status).toBe(428);
  const stale = await write(current - 1);
  expect(stale.status).toBe(412);
  expect(stale.body).toEqual({ error: 'stale', version: current });
  expect((await read()).version).toBe(current);
  const applied = await write(current);
  expect(applied.status, JSON.stringify(applied.body)).toBeLessThan(300);
  return applied.body;
}

const driver = { kind: 'driver', lastName: 'Garnier', firstName: 'Paul' };

describe('resources', () => {
  it('T-006: the second save is refused with 412 and the first one is kept', async () => {
    const { id, version } = await created('/resources', driver);
    expect(version).toBe(1);
    const b = await call('PUT', `/resources/${id}`, 1, { ...driver, phone: '06 12 34 56 78' });
    expect([b.status, b.body.version]).toEqual([200, 2]);
    const a = await call('PUT', `/resources/${id}`, 1, { ...driver, employeeNumber: 'GP-118' });
    expect([a.status, a.body]).toEqual([412, { error: 'stale', version: 2 }]);
    const { body } = await call('GET', `/resources/${id}`);
    expect(body).toMatchObject({ version: 2, phone: '06 12 34 56 78', employeeNumber: null });
  });

  it('every write to a resource is guarded; lists carry the version', async () => {
    const { id } = await created('/resources', { ...driver, lastName: 'Rey' });
    await call('PUT', `/resources/${id}`, 1, {
      ...driver,
      lastName: 'Rey',
      phone: '06 01 02 03 04',
    });
    const read = async () => (await call('GET', `/resources/${id}`)).body;
    await expectGuarded(
      (v) => call('PUT', `/resources/${id}`, v, { ...driver, lastName: 'Rey' }),
      read,
      2,
    );
    await expectGuarded((v) => call('POST', `/resources/${id}/archive`, v), read, 3);
    const archived = (await call('GET', '/resources?kind=driver&archived=true')).body;
    expect(archived.resources.find((r: any) => r.id === id)?.version).toBe(4);
    await expectGuarded((v) => call('POST', `/resources/${id}/restore`, v), read, 4);
  });

  it('a write to a resource that does not exist answers 404, whatever the version', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await call('PUT', `/resources/${missing}`, 1, driver)).status).toBe(404);
    expect((await call('POST', `/resources/${missing}/archive`, 1)).status).toBe(404);
  });

  it('a malformed If-Match is a bad request', async () => {
    const { id } = await created('/resources', { ...driver, lastName: 'Morel' });
    expect((await call('PUT', `/resources/${id}`, 'W/"1"', driver)).status).toBe(400);
    expect((await call('PUT', `/resources/${id}`, 'one', driver)).status).toBe(400);
  });
});

describe('documents', () => {
  it('a document is changed and removed under its own version', async () => {
    const lists = (await call('GET', '/reference-lists')).body;
    const cpc = lists.documentTypes.find((t: any) => t.code === 'cpc').id;
    const { id } = await created('/resources', { ...driver, lastName: 'Perrin' });
    const added = await created(`/resources/${id}/documents`, {
      documentTypeId: cpc,
      expiresOn: '2027-05-15',
    });
    expect(added.version).toBe(1);
    const documentId = added.documents[0].id;
    expect(added.documents[0].version).toBe(1);
    const read = async () => (await call('GET', `/resources/${id}`)).body.documents[0];
    await call('PUT', `/documents/${documentId}`, 1, {
      documentTypeId: cpc,
      expiresOn: '2031-05-15',
    });
    const changed = await expectGuarded(
      (v) =>
        call('PUT', `/documents/${documentId}`, v, {
          documentTypeId: cpc,
          expiresOn: '2032-05-15',
        }),
      read,
      2,
    );
    expect(changed.version).toBe(1);
    await expectGuarded((v) => call('DELETE', `/documents/${documentId}`, v), read, 3);
  });
});

const customer = (code: string) => ({
  code,
  name: 'Dupont Matériaux',
  country: 'FR',
  contacts: [{ name: 'Sandrine Dupont', phone: '04 78 70 21 45' }],
  siteIds: [],
});

const site = {
  name: 'Plateforme Saint-Priest',
  street1: '14 rue des Frères Lumière',
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  latitude: 45.6906,
  longitude: 4.9488,
  locatedBy: 'by-hand',
  openings: [],
  bookingRequired: false,
  protectiveEquipmentIds: [],
  loadingDock: true,
  semiTrailersAccepted: true,
};

describe('customers and sites', () => {
  it('every write to a customer is guarded, contacts included', async () => {
    const { id, version } = await created('/customers', customer('V-API'));
    expect(version).toBe(1);
    const read = async () => (await call('GET', `/customers/${id}`)).body;
    await call('PUT', `/customers/${id}`, 1, { ...customer('V-API'), name: 'Dupont SA' });
    await expectGuarded(
      (v) => call('PUT', `/customers/${id}`, v, { ...customer('V-API'), contacts: [] }),
      read,
      2,
    );
    expect((await read()).contacts).toEqual([]);
    await expectGuarded((v) => call('POST', `/customers/${id}/archive`, v), read, 3);
    await expectGuarded((v) => call('POST', `/customers/${id}/restore`, v), read, 4);
  });

  it('every write to a site is guarded', async () => {
    const answer = await created('/sites', site);
    const id = answer.site.id;
    expect(answer.site.version).toBe(1);
    const read = async () => (await call('GET', `/sites/${id}`)).body.site;
    await call('PUT', `/sites/${id}`, 1, { ...site, gatePhone: '04 72 23 18 90' });
    await expectGuarded((v) => call('PUT', `/sites/${id}`, v, site), read, 2);
    await expectGuarded((v) => call('POST', `/sites/${id}/archive`, v), read, 3);
    await expectGuarded((v) => call('POST', `/sites/${id}/restore`, v), read, 4);
  });
});

describe('units', () => {
  let tractor: string;
  let trailers: string[];
  beforeAll(async () => {
    const vehicle = async (plate: string, vehicleKind: string) =>
      (
        await created('/resources', {
          kind: vehicleKind === 'tractor' ? 'power-unit' : 'trailer',
          plate,
          vehicleKind,
          category: vehicleKind === 'tractor' ? 'N3' : 'O4',
          gvwKg: vehicleKind === 'tractor' ? 19_000 : 35_000,
        })
      ).id as string;
    tractor = await vehicle('VA-101-AA', 'tractor');
    trailers = [await vehicle('VA-102', 'semi-trailer'), await vehicle('VA-103', 'semi-trailer')];
  });

  it('a unit not started yet is edited and deleted under its version', async () => {
    const planned = { powerUnitId: tractor, trailerId: trailers[0], start: '2026-11-02T05:00:00Z' };
    const { id, version } = await created('/units', planned);
    expect(version).toBe(1);
    const read = async () => (await call('GET', `/units/${id}`)).body;
    await call('PUT', `/units/${id}`, 1, { ...planned, name: 'Unit 5' });
    await expectGuarded((v) => call('PUT', `/units/${id}`, v, planned), read, 2);
    await expectGuarded((v) => call('DELETE', `/units/${id}`, v), read, 3);
    expect((await call('GET', `/units/${id}`)).status).toBe(404);
  });

  it('setting an end and changing the trailer start from the running unit version', async () => {
    const running = { powerUnitId: tractor, trailerId: trailers[0], start: '2026-10-26T05:00:00Z' };
    const { id } = await created('/units', running);
    const read = async () => (await call('GET', `/units/${id}`)).body;
    await call('POST', `/units/${id}/end`, 1, { end: '2026-10-29T05:00:00Z' });
    const ended = await expectGuarded(
      (v) => call('POST', `/units/${id}/end`, v, { end: '2026-10-30T05:00:00Z' }),
      read,
      2,
    );
    expect(ended.version).toBe(3);
    const changed = await expectGuarded(
      (v) =>
        call('POST', `/units/${id}/change`, v, {
          role: 'trailer',
          resourceId: trailers[1],
          from: '2026-10-27T12:00:00Z',
        }),
      read,
      3,
    );
    expect([changed.ended.version, changed.unit.version]).toEqual([4, 1]);
  });
});

describe('the OpenAPI document', () => {
  // Writes under a record's path that create another record rather than change this one.
  const creations = ['post /api/resources/{id}/documents'];

  it('declares If-Match on every write to an existing record', async () => {
    const { body } = await call('GET', '/openapi.json');
    const writes = Object.entries(body.paths as Record<string, Record<string, any>>).flatMap(
      ([path, operations]) =>
        Object.entries(operations)
          .filter(([method]) => ['put', 'post', 'patch', 'delete'].includes(method))
          .filter(() => path.includes('{id}'))
          .map(([method, operation]) => ({ route: `${method} ${path}`, operation })),
    );
    expect(writes.length).toBeGreaterThan(10);
    for (const creation of creations) {
      expect(writes.map((w) => w.route)).toContain(creation);
    }
    const unguarded = writes
      .filter(({ route }) => !creations.includes(route))
      .filter(
        ({ operation }) =>
          !(operation.parameters ?? []).some(
            (p: any) => p.in === 'header' && p.name.toLowerCase() === 'if-match' && p.required,
          ),
      )
      .map(({ route }) => route);
    expect(unguarded).toEqual([]);
  });
});
