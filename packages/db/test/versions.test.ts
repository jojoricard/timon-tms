import {
  type CustomerInput,
  type NewUnit,
  type Ports,
  type SiteRecord,
  StaleVersionError,
} from '@timon/app';
import { type Driver, openPeriodOf, type ResourceDetails, Temporal } from '@timon/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index.ts';
import { createTestDatabase, offline, type TestDatabase } from '../src/testing.ts';

// ADR-005: every write to an existing record names the version it started from. The database
// applies it only if that version is still current, in the same statement, and adds one.

let database: TestDatabase;
let ports: Ports;

beforeAll(async () => {
  database = await createTestDatabase();
  ports = { ...createRepositories(database.db), geocoder: offline };
});

afterAll(() => database.close());

const unknownId = '00000000-0000-4000-8000-000000000000';

/** The write is refused with the current version, and nothing it carried is kept. */
async function expectStale(write: Promise<unknown>, current: number) {
  const error = await write.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StaleVersionError);
  expect((error as StaleVersionError).version).toBe(current);
}

const driver = (changes: Partial<Driver> = {}): Driver => ({
  kind: 'driver',
  lastName: 'Garnier',
  firstName: 'Paul',
  displayName: null,
  employeeNumber: null,
  phone: null,
  protectiveEquipmentIds: [],
  ...changes,
});

const vehicle = (plate: string, vehicleKind: 'tractor' | 'semi-trailer'): ResourceDetails => ({
  kind: vehicleKind === 'tractor' ? 'power-unit' : 'trailer',
  plate,
  vehicleKind,
  category: vehicleKind === 'tractor' ? 'N3' : 'O4',
  gvwKg: vehicleKind === 'tractor' ? 19_000 : 35_000,
  gcwKg: null,
  makeModel: null,
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
});

describe('resources', () => {
  it('starts at 1; a write from the current version applies and adds one', async () => {
    const created = await ports.resources.create({ details: driver(), documents: [] });
    expect(created.version).toBe(1);
    const updated = await ports.resources.update(
      created.id,
      1,
      driver({ phone: '06 12 34 56 78' }),
    );
    expect(updated).toMatchObject({ version: 2, phone: '06 12 34 56 78' });
  });

  it('T-006: refuses the second save from the same version and keeps the first', async () => {
    const { id } = await ports.resources.create({ details: driver(), documents: [] });
    await ports.resources.update(id, 1, driver({ phone: '06 12 34 56 78' }));
    await expectStale(ports.resources.update(id, 1, driver({ employeeNumber: 'GP-118' })), 2);
    expect(await ports.resources.get(id)).toMatchObject({
      version: 2,
      phone: '06 12 34 56 78',
      employeeNumber: null,
    });
  });

  it('archives and restores under the version, each adding one', async () => {
    const { id } = await ports.resources.create({ details: driver(), documents: [] });
    expect(await ports.resources.setArchived(id, 1, true)).toMatchObject({
      archived: true,
      version: 2,
    });
    await expectStale(ports.resources.setArchived(id, 1, false), 2);
    expect(await ports.resources.setArchived(id, 2, false)).toMatchObject({
      archived: false,
      version: 3,
    });
  });

  it('tells a record that does not exist from a stale version', async () => {
    expect(await ports.resources.update(unknownId, 1, driver())).toBeUndefined();
    expect(await ports.resources.setArchived(unknownId, 1, true)).toBeUndefined();
  });
});

describe('documents', () => {
  const document = (expiresOn: string) => ({
    documentTypeId: '',
    reference: null,
    issuedOn: null,
    expiresOn: Temporal.PlainDate.from(expiresOn),
  });
  const licence = async () =>
    (await ports.referenceLists.get()).documentTypes.find((t) => t.code === 'licence-ce')?.id ?? '';

  it('has its own version: adding, changing or removing one leaves the resource alone', async () => {
    const resource = await ports.resources.create({ details: driver(), documents: [] });
    const added = await ports.documents.add(resource.id, {
      ...document('2027-03-01'),
      documentTypeId: await licence(),
    });
    expect(added.version).toBe(1);
    const updated = await ports.documents.update(added.id, 1, {
      ...document('2032-03-01'),
      documentTypeId: await licence(),
    });
    expect(updated).toMatchObject({ version: 2 });
    expect((await ports.resources.get(resource.id))?.version).toBe(1);
  });

  it('refuses a stale change or removal and keeps the current document', async () => {
    const resource = await ports.resources.create({ details: driver(), documents: [] });
    const typeId = await licence();
    const added = await ports.documents.add(resource.id, {
      ...document('2027-03-01'),
      documentTypeId: typeId,
    });
    await ports.documents.update(added.id, 1, {
      ...document('2032-03-01'),
      documentTypeId: typeId,
    });
    await expectStale(
      ports.documents.update(added.id, 1, { ...document('2028-01-01'), documentTypeId: typeId }),
      2,
    );
    await expectStale(ports.documents.remove(added.id, 1), 2);
    expect((await ports.documents.get(added.id))?.expiresOn.toString()).toBe('2032-03-01');
    expect(await ports.documents.remove(added.id, 2)).toBe(true);
    expect(await ports.documents.remove(added.id, 2)).toBe(false);
    expect(
      await ports.documents.update(added.id, 2, {
        ...document('2028-01-01'),
        documentTypeId: typeId,
      }),
    ).toBeUndefined();
  });
});

const customer = (code: string, changes: Partial<CustomerInput> = {}): CustomerInput => ({
  code,
  name: 'Dupont Matériaux',
  country: 'FR',
  siret: null,
  vatNumber: null,
  billingStreet1: null,
  billingStreet2: null,
  billingPostcode: null,
  billingCity: null,
  notes: null,
  contacts: [{ name: 'Sandrine Dupont', role: null, phone: '04 78 70 21 45', email: null }],
  siteIds: [],
  ...changes,
});

describe('customers', () => {
  it('saves contacts and usual sites under the customer version', async () => {
    const created = await ports.customers.create(customer('V-CONTACTS'));
    expect(created.version).toBe(1);
    const [contact] = created.contacts;
    const updated = await ports.customers.update(
      created.id,
      1,
      customer('V-CONTACTS', {
        contacts: [
          {
            id: contact?.id,
            name: 'Sandrine Dupont',
            role: null,
            phone: '04 72 00 00 00',
            email: null,
          },
        ],
      }),
    );
    expect(updated?.version).toBe(2);
    expect(updated?.contacts).toEqual([{ ...contact, phone: '04 72 00 00 00' }]);
  });

  it('refuses a stale save as a whole: contacts are not touched either', async () => {
    const created = await ports.customers.create(customer('V-STALE'));
    await ports.customers.update(created.id, 1, customer('V-STALE', { name: 'Dupont SA' }));
    await expectStale(
      ports.customers.update(created.id, 1, customer('V-STALE', { contacts: [] })),
      2,
    );
    const current = await ports.customers.get(created.id);
    expect(current).toMatchObject({ version: 2, name: 'Dupont SA' });
    expect(current?.contacts.map((c) => c.name)).toEqual(['Sandrine Dupont']);
  });

  it('archives and restores under the version', async () => {
    const { id } = await ports.customers.create(customer('V-ARCHIVE'));
    expect(await ports.customers.setArchived(id, 1, true)).toMatchObject({ version: 2 });
    await expectStale(ports.customers.setArchived(id, 1, false), 2);
    expect(await ports.customers.setArchived(unknownId, 1, true)).toBeUndefined();
    expect(await ports.customers.update(unknownId, 1, customer('V-NONE'))).toBeUndefined();
  });
});

const site = (changes: Partial<SiteRecord> = {}): SiteRecord => ({
  name: 'Plateforme Saint-Priest',
  street1: '14 rue des Frères Lumière',
  street2: null,
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  location: { latitude: 45.6906, longitude: 4.9488 },
  locatedBy: 'by-hand',
  timeZone: 'Europe/Paris',
  openings: [{ weekday: 1, startMinute: 360, endMinute: 720 }],
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
  ...changes,
});

describe('sites', () => {
  it('refuses a stale save and keeps the current site with its openings', async () => {
    const created = await ports.sites.create(site());
    expect(created.version).toBe(1);
    expect(
      await ports.sites.update(created.id, 1, site({ gatePhone: '04 72 23 18 90' })),
    ).toMatchObject({ version: 2 });
    await expectStale(ports.sites.update(created.id, 1, site({ openings: [] })), 2);
    const current = await ports.sites.get(created.id);
    expect(current).toMatchObject({ version: 2, gatePhone: '04 72 23 18 90' });
    expect(current?.openings).toHaveLength(1);
  });

  it('a usual site added to a customer leaves the site version alone', async () => {
    const dock = await ports.sites.create(site());
    await ports.customers.create(customer('V-SITE', { siteIds: [dock.id] }));
    expect((await ports.sites.get(dock.id))?.version).toBe(1);
  });

  it('archives and restores under the version', async () => {
    const { id } = await ports.sites.create(site());
    expect(await ports.sites.setArchived(id, 1, true)).toMatchObject({ version: 2 });
    await expectStale(ports.sites.setArchived(id, 1, false), 2);
    expect(await ports.sites.setArchived(unknownId, 1, true)).toBeUndefined();
    expect(await ports.sites.update(unknownId, 1, site())).toBeUndefined();
  });
});

describe('units', () => {
  const ids: Record<string, string> = {};
  const at = (time: string) => Temporal.Instant.from(`2026-11-20T${time}:00Z`);
  const unit = (start: string, end: string | null, changes: Partial<NewUnit> = {}): NewUnit => ({
    name: null,
    powerUnitId: ids.tractor ?? '',
    trailerId: ids.trailer ?? null,
    driverId: null,
    period: openPeriodOf(at(start).toString(), end ? at(end).toString() : null),
    previousUnitId: null,
    ...changes,
  });

  beforeAll(async () => {
    for (const [key, details] of Object.entries({
      tractor: vehicle('VR-501-AA', 'tractor'),
      trailer: vehicle('VR-502-AA', 'semi-trailer'),
      other: vehicle('VR-503-AA', 'semi-trailer'),
    })) {
      ids[key] = (await ports.resources.create({ details, documents: [] })).id;
    }
  });

  it('replaces and removes under the version', async () => {
    const created = await ports.units.create(unit('06:00', '08:00'));
    expect(created.version).toBe(1);
    expect(
      await ports.units.replace(created.id, 1, unit('06:00', '08:00', { name: 'Unit 5' })),
    ).toMatchObject({ version: 2, name: 'Unit 5' });
    await expectStale(ports.units.replace(created.id, 1, unit('06:00', '09:00')), 2);
    await expectStale(ports.units.remove(created.id, 1), 2);
    const current = await ports.units.get(created.id);
    expect(current).toMatchObject({ version: 2, name: 'Unit 5', trailerId: ids.trailer });
    expect(await ports.units.remove(created.id, 2)).toBe(true);
    expect(await ports.units.remove(created.id, 2)).toBe(false);
    expect(await ports.units.replace(created.id, 2, unit('06:00', '08:00'))).toBeUndefined();
  });

  it('sets an end under the version', async () => {
    const created = await ports.units.create(unit('10:00', null));
    expect(await ports.units.setEnd(created.id, 1, at('12:00'))).toMatchObject({ version: 2 });
    await expectStale(ports.units.setEnd(created.id, 1, at('11:00')), 2);
    expect((await ports.units.get(created.id))?.period.end?.toString()).toBe(
      at('12:00').toString(),
    );
    expect(await ports.units.setEnd(unknownId, 1, at('11:00'))).toBeUndefined();
  });

  it('changes the trailer under the version of the unit it starts from', async () => {
    const created = await ports.units.create(unit('14:00', null));
    const next = unit('16:00', null, { trailerId: ids.other ?? null, previousUnitId: created.id });
    await expectStale(ports.units.change(created.id, 2, next), 1);
    expect(await ports.units.listByResource(ids.other ?? '')).toEqual([]);
    const { ended, started } = await ports.units.change(created.id, 1, next);
    expect([ended.version, started.version]).toEqual([2, 1]);
  });
});
