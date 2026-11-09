// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp, textLimits } from '@timon/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A text one character longer than its limit is refused with a 400 whose issue names the field,
// so the form shows it under that field. The schemas check it before anything else, so the other
// values only need the right shape.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ ...createRepositories(database.db), geocoder: offline });
});

afterAll(() => database.close());

async function call(method: string, path: string, body: unknown) {
  const response = await app.request(`/api${path}`, {
    method,
    // A cancelling names a version; the schemas check the body all the same.
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const id = '00000000-0000-4000-8000-000000000001';
const start = '2026-11-02T05:00:00Z';

const driver = { kind: 'driver', lastName: 'Laurent', firstName: 'Marc' };
const tractor = {
  kind: 'power-unit',
  vehicleKind: 'tractor',
  plate: 'AB-123-CD',
  category: 'N3',
  gvwKg: 19_000,
};
const customer = { code: 'C1', name: 'Dupont', country: 'FR', contacts: [], siteIds: [] };
const contact = { name: 'Sandrine Dupont', phone: '04 78 70 21 45' };
const site = {
  name: 'Quai B',
  street1: '14 rue des Frères Lumière',
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  latitude: null,
  longitude: null,
  locatedBy: 'not-located',
  openings: [],
  bookingRequired: false,
  protectiveEquipmentIds: [],
  loadingDock: false,
  semiTrailersAccepted: false,
};

const stop = { id: 'p', kind: 'pickup', siteId: id };
const goods = {
  id: 'l',
  description: 'Yaourts',
  quantity: 1,
  packaging: 'pallet',
  weightKg: 100,
  fromStopId: 'p',
  toStopId: 'd',
};
const order = { customerId: id, stops: [stop], lines: [goods] };

/** For each limited text: the request that carries it, and the field the issue names. */
const requests: Record<
  keyof typeof textLimits,
  (field: string, value: string) => { method: string; path: string; body: unknown; field: string }
> = {
  resource: (field, value) => ({
    method: 'POST',
    path: '/resources',
    body:
      field === 'plate' || field === 'makeModel'
        ? { ...tractor, [field]: value }
        : { ...driver, [field]: value },
    field,
  }),
  document: (field, value) => ({
    method: 'POST',
    path: `/resources/${id}/documents`,
    body: { documentTypeId: id, expiresOn: '2030-01-01', [field]: value },
    field,
  }),
  customer: (field, value) => ({
    method: 'POST',
    path: '/customers',
    body: { ...customer, [field]: value },
    field,
  }),
  contact: (field, value) => ({
    method: 'POST',
    path: '/customers',
    body: { ...customer, contacts: [{ ...contact, [field]: value }] },
    field: `contacts.0.${field}`,
  }),
  site: (field, value) => ({
    method: 'POST',
    path: '/sites',
    body: { ...site, [field]: value },
    field,
  }),
  unit: (field, value) => ({
    method: 'POST',
    path: '/units',
    body: { powerUnitId: id, start, [field]: value },
    field,
  }),
  order: (field, value) =>
    field === 'cancelReason'
      ? { method: 'POST', path: `/orders/${id}/cancel`, body: { reason: value }, field: 'reason' }
      : { method: 'POST', path: '/orders', body: { ...order, [field]: value }, field },
  stop: (field, value) => ({
    method: 'POST',
    path: '/orders',
    body: { ...order, stops: [{ ...stop, [field]: value }] },
    field: `stops.0.${field}`,
  }),
  goods: (field, value) => ({
    method: 'POST',
    path: '/orders',
    body: { ...order, lines: [{ ...goods, [field]: value }] },
    field: `lines.0.${field}`,
  }),
};

describe('a text over its limit', () => {
  for (const [entity, fields] of Object.entries(textLimits)) {
    for (const [field, limit] of Object.entries(fields)) {
      it(`${entity}.${field}: 400 naming the field`, async () => {
        const request = requests[entity as keyof typeof textLimits](field, 'x'.repeat(limit + 1));
        const { status, body } = await call(request.method, request.path, request.body);
        expect(status).toBe(400);
        expect(body).toMatchObject({
          error: 'invalid',
          issues: [{ field: request.field, code: 'too-long', params: { max: limit } }],
        });
      });
    }
  }

  it('a text at its limit passes the schema', async () => {
    const { status } = await call('POST', '/resources', {
      ...driver,
      firstName: 'x'.repeat(textLimits.resource.firstName),
    });
    expect(status).toBe(201);
  });
});
