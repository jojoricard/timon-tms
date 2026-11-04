// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.
import { createRepositories } from '@timon/db';
import { createTestDatabase, offline, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// SPEC-003 through the HTTP API, on PGlite in-process, and on PostgreSQL 18 when
// TEST_DATABASE_URL is set (CI). Now is Tuesday 27 October 2026, 09:40 in Paris, as on the
// mockups; times are written in Paris time and sent as instants.

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
const now = Temporal.Instant.from('2026-10-27T08:40:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({ ...createRepositories(database.db, { now: () => now }), geocoder: offline });
});

afterAll(() => database.close());

/** "2026-10-06 06:00" in Paris, as an instant. */
const paris = (local: string) =>
  Temporal.PlainDateTime.from(local.replace(' ', 'T'))
    .toZonedDateTime('Europe/Paris')
    .toInstant()
    .toString();

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as any };
}

let typeIds: Record<string, string>;
beforeAll(async () => {
  const lists = (await call('GET', '/reference-lists')).body;
  typeIds = Object.fromEntries(
    lists.documentTypes.map((t: { code: string; id: string }) => [t.code, t.id]),
  );
});

async function create(details: Record<string, unknown>, documents: Record<string, string> = {}) {
  const { status, body } = await call('POST', '/resources', details);
  expect(status).toBe(201);
  for (const [code, expiresOn] of Object.entries(documents)) {
    const added = await call('POST', `/resources/${body.id}/documents`, {
      documentTypeId: typeIds[code],
      expiresOn,
    });
    expect(added.status).toBe(201);
  }
  return body.id as string;
}

const driver = (firstName: string, lastName: string, documents: Record<string, string>) =>
  create({ kind: 'driver', firstName, lastName }, documents);
const valid = { cpc: '2029-05-15', 'driver-card': '2029-05-15' };
const vehicle = (
  plate: string,
  vehicleKind: string,
  category: string,
  gvwKg: number,
  extra: Record<string, unknown> = {},
) =>
  create(
    {
      kind: ['semi-trailer', 'drawbar-trailer'].includes(vehicleKind) ? 'trailer' : 'power-unit',
      plate,
      vehicleKind,
      category,
      gvwKg,
      ...extra,
    },
    {
      roadworthiness: '2027-04-14',
      ...(vehicleKind === 'tractor' ? { tachograph: '2027-02-15' } : {}),
    },
  );

const unit = (members: Record<string, unknown>) => call('POST', '/units', members);
const names = (units: any[]) => units.map((u) => u.name);

let fleet: Record<string, string>;
beforeAll(async () => {
  fleet = {
    laurent: await driver('Marc', 'Laurent', {
      'licence-c': '2031-03-15',
      'licence-ce': '2031-03-15',
      ...valid,
    }),
    marchand: await driver('Élodie', 'Marchand', { 'licence-c1': '2029-07-15', ...valid }),
    perrin: await driver('Hugo', 'Perrin', {
      'licence-c': '2030-06-15',
      'licence-ce': '2030-06-15',
      ...valid,
    }),
    cd: await vehicle('CD-456-EF', 'tractor', 'N3', 19_000, { gcwKg: 44_000 }),
    sr4471: await vehicle('SR-4471', 'semi-trailer', 'O4', 35_000),
    rigid: await vehicle('UV-234-WX', 'rigid-truck', 'N2', 7_490),
    rq: await vehicle('RQ-0915', 'drawbar-trailer', 'O2', 3_500),
    van: await vehicle('YZ-890-AB', 'light-van', 'N1', 3_500),
  };
});

describe('creating units', () => {
  it('criterion 1: CD-456-EF, SR-4471 and Marc Laurent from 06/10 06:00, shown today', async () => {
    const { status, body } = await unit({
      powerUnitId: fleet.cd,
      trailerId: fleet.sr4471,
      driverId: fleet.laurent,
      start: paris('2026-10-06 06:00'),
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      name: 'M. Laurent',
      start: '2026-10-06T04:00:00Z',
      end: null,
      state: 'running',
      licence: 'CE',
    });
    const today = (await call('GET', '/units')).body;
    expect(today.at).toBe(now.toString());
    expect(names(today.units)).toContain('M. Laurent');
  });

  it('criterion 2: Élodie Marchand, who holds C1, is refused on CD-456-EF', async () => {
    const { status, body } = await unit({
      powerUnitId: fleet.cd,
      driverId: fleet.marchand,
      start: paris('2026-11-02 06:00'),
    });
    expect(status).toBe(400);
    expect(body.issues).toEqual([
      {
        field: 'driverId',
        code: 'licence-missing',
        params: { needs: 'C', holds: 'C1', driver: 'Élodie Marchand' },
      },
    ]);
    const withTrailer = await unit({
      powerUnitId: fleet.cd,
      trailerId: fleet.sr4471,
      driverId: fleet.marchand,
      start: paris('2026-11-02 06:00'),
    });
    expect(withTrailer.body.issues[0].params).toMatchObject({ needs: 'CE', holds: 'C1' });
  });

  it('criterion 3: C1 drives a rigid truck of 7,490 kg alone, not with a 3,500 kg trailer', async () => {
    const withTrailer = await unit({
      powerUnitId: fleet.rigid,
      trailerId: fleet.rq,
      driverId: fleet.marchand,
      start: paris('2026-10-26 06:00'),
    });
    expect(withTrailer.status).toBe(400);
    expect(withTrailer.body.issues[0]).toMatchObject({
      code: 'licence-missing',
      params: { needs: 'C1E', holds: 'C1' },
    });
    const alone = await unit({
      powerUnitId: fleet.rigid,
      driverId: fleet.marchand,
      start: paris('2026-10-26 06:00'),
      end: paris('2026-10-26 18:00'),
    });
    expect(alone.status).toBe(201);
    expect(alone.body.licence).toBe('C1');
  });

  it('criterion 4: no semi-trailer behind a rigid truck, no trailer behind a light van', async () => {
    const semi = await unit({
      powerUnitId: fleet.rigid,
      trailerId: fleet.sr4471,
      start: paris('2026-12-01 06:00'),
    });
    expect(semi.status).toBe(400);
    expect(semi.body.issues).toEqual([{ field: 'trailerId', code: 'semi-trailer-needs-tractor' }]);

    const options = await call(
      'GET',
      `/units/options?start=${paris('2026-12-01 06:00')}&powerUnitId=${fleet.van}`,
    );
    expect(options.status).toBe(200);
    const reasons = options.body.candidates.trailer.map((c: any) => c.reason?.code);
    expect(new Set(reasons)).toEqual(new Set(['light-van-no-trailer']));
  });

  it('criterion 5: a power unit alone is refused', async () => {
    const { status, body } = await unit({
      powerUnitId: fleet.van,
      start: paris('2026-12-01 06:00'),
    });
    expect(status).toBe(400);
    expect(body.issues).toEqual([{ field: 'members', code: 'driver-or-trailer-required' }]);
  });

  it('criterion 6: SR-4471 already in an open-ended unit is refused, naming that unit', async () => {
    const other = await vehicle('AB-123-CD', 'tractor', 'N3', 19_000);
    const { status, body } = await unit({
      powerUnitId: other,
      trailerId: fleet.sr4471,
      start: paris('2026-10-20 08:00'),
    });
    expect(status).toBe(409);
    expect(body.conflicts).toEqual([
      {
        unit: expect.objectContaining({
          name: 'M. Laurent',
          start: '2026-10-06T04:00:00Z',
          end: null,
        }),
        resource: { id: fleet.sr4471, kind: 'trailer', name: 'SR-4471' },
      },
    ]);
  });

  it('criterion 7: a unit ending at 20:00 and another starting at 20:00 do not overlap', async () => {
    const trailer = await vehicle('SR-4478', 'semi-trailer', 'O4', 35_000);
    const first = await vehicle('ST-901-UV', 'tractor', 'N3', 19_000);
    const second = await vehicle('QR-678-ST', 'tractor', 'N3', 19_000);
    expect(
      (
        await unit({
          powerUnitId: first,
          trailerId: trailer,
          start: paris('2026-10-20 08:00'),
          end: paris('2026-10-20 20:00'),
        })
      ).status,
    ).toBe(201);
    const overlapping = await unit({
      powerUnitId: second,
      trailerId: trailer,
      start: paris('2026-10-20 18:00'),
      end: paris('2026-10-20 22:00'),
    });
    expect(overlapping.status).toBe(409);
    const touching = await unit({
      powerUnitId: second,
      trailerId: trailer,
      start: paris('2026-10-20 20:00'),
      end: paris('2026-10-20 22:00'),
    });
    expect(touching.status).toBe(201);
  });

  it('refuses times that are not to the minute, and an end before the start', async () => {
    const { body } = await unit({
      powerUnitId: fleet.van,
      driverId: fleet.marchand,
      start: '2026-12-01T05:00:30Z',
      end: '2026-12-01T05:00:00Z',
    });
    expect(body.issues).toEqual([
      { field: 'start', code: 'not-to-the-minute' },
      { field: 'end', code: 'end-not-after-start' },
    ]);
  });
});

describe('changing, ending and deleting units', () => {
  it('criterion 8: the driver changes to Hugo Perrin from 26/10 06:00', async () => {
    const running = (await call('GET', '/units')).body.units.find(
      (u: any) => u.name === 'M. Laurent',
    );
    const { status, body } = await call('POST', `/units/${running.id}/change`, {
      role: 'driver',
      resourceId: fleet.perrin,
      from: paris('2026-10-26 06:00'),
    });
    expect(status).toBe(200);
    expect(body.ended).toMatchObject({ name: 'M. Laurent', end: '2026-10-26T05:00:00Z' });
    expect(body.unit).toMatchObject({
      name: 'H. Perrin',
      start: '2026-10-26T05:00:00Z',
      end: null,
      changed: 'driver',
      previousUnitId: running.id,
    });

    const at = async (local: string) =>
      (await call('GET', `/units?at=${encodeURIComponent(paris(local))}`)).body;
    const before = await at('2026-10-25 18:00');
    const tractorUnit = (units: any[]) => units.find((u) => u.powerUnit.id === fleet.cd);
    expect(tractorUnit(before.units).driver.name).toBe('M. Laurent');
    const after = await at('2026-10-26 08:00');
    expect(tractorUnit(after.units)).toMatchObject({
      driver: { name: 'H. Perrin' },
      trailer: { id: fleet.sr4471 },
    });
    expect(after.free.driver.map((d: any) => d.name)).toContain('M. Laurent');
  });

  it('criterion 10: a future unit is deleted; a running one is only given an end', async () => {
    const future = await unit({
      powerUnitId: fleet.van,
      driverId: fleet.marchand,
      start: paris('2026-11-02 07:00'),
    });
    expect(future.status).toBe(201);
    expect((await call('DELETE', `/units/${future.body.id}`)).status).toBe(204);
    expect((await call('GET', `/units/${future.body.id}`)).status).toBe(404);

    const running = (await call('GET', '/units')).body.units.find(
      (u: any) => u.name === 'H. Perrin',
    );
    expect(await call('DELETE', `/units/${running.id}`)).toMatchObject({
      status: 409,
      body: { error: 'started' },
    });
    const ended = await call('POST', `/units/${running.id}/end`, {
      end: paris('2026-10-30 18:00'),
    });
    expect(ended).toMatchObject({ status: 200, body: { end: '2026-10-30T17:00:00Z' } });
  });

  it('edits a unit that has not started, not one that has', async () => {
    const future = await unit({
      powerUnitId: fleet.van,
      driverId: fleet.marchand,
      start: paris('2026-11-09 07:00'),
    });
    const edited = await call('PUT', `/units/${future.body.id}`, {
      name: 'Van',
      powerUnitId: fleet.van,
      driverId: fleet.marchand,
      start: paris('2026-11-09 08:00'),
    });
    expect(edited).toMatchObject({ status: 200, body: { name: 'Van', customName: 'Van' } });
    const history = (await call('GET', `/resources/${fleet.cd}/units`)).body;
    expect(
      (
        await call('PUT', `/units/${history[0].id}`, {
          powerUnitId: fleet.cd,
          start: paris('2026-11-09 08:00'),
        })
      ).body,
    ).toEqual({ error: 'started' });
  });
});

describe('documents and archiving', () => {
  it('criterion 9: an FCO expired last week is reported, the unit is saved', async () => {
    const girard = await driver('Thomas', 'Girard', {
      'licence-ce': '2030-02-15',
      cpc: '2026-10-20',
      'driver-card': '2027-03-15',
    });
    const tractor = await vehicle('KL-345-MN', 'tractor', 'N3', 19_000);
    const { status, body } = await unit({
      powerUnitId: tractor,
      driverId: girard,
      start: paris('2026-10-27 06:00'),
    });
    expect(status).toBe(201);
    expect(body.documents).toMatchObject({
      day: '2026-10-27',
      status: 'expired',
      worst: { code: 'cpc', member: 'T. Girard', expiresOn: '2026-10-20', status: 'expired' },
    });
  });

  it('criterion 11: a trailer in a running unit cannot be archived; the unit is named', async () => {
    const { status, body } = await call('POST', `/resources/${fleet.sr4471}/archive`);
    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: 'in-unit',
      unit: { name: 'H. Perrin', end: '2026-10-30T17:00:00Z' },
    });
  });

  it('keeps the kind of a vehicle that belongs to a running or future unit', async () => {
    const { status, body } = await call('PUT', `/resources/${fleet.cd}`, {
      kind: 'power-unit',
      vehicleKind: 'rigid-truck',
      plate: 'CD-456-EF',
      category: 'N3',
      gvwKg: 19_000,
    });
    expect(status).toBe(409);
    expect(body.error).toBe('in-unit');
  });

  it('lists the units of a resource, latest first', async () => {
    const history = (await call('GET', `/resources/${fleet.sr4471}/units`)).body;
    expect(history.map((u: any) => [u.name, u.changed])).toEqual([
      ['H. Perrin', 'driver'],
      ['M. Laurent', null],
    ]);
  });
});
