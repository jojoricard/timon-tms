import {
  CustomerCodeTakenError,
  type CustomerInput,
  OpeningOverlapError,
  type Ports,
  SiretTakenError,
  type SiteRecord,
} from '@timon/app';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index.ts';
import { createTestDatabase, offline, type TestDatabase } from '../src/testing.ts';

// The repositories on a real database, and the constraints that hold even when the
// application's own checks are bypassed.

let database: TestDatabase;
let ports: Ports;

beforeAll(async () => {
  database = await createTestDatabase();
  ports = { ...createRepositories(database.db), geocoder: offline };
});

afterAll(() => database.close());

const customer = (changes: Partial<CustomerInput> = {}): CustomerInput => ({
  code: 'DUPONT-MAT',
  name: 'Dupont Matériaux',
  country: 'FR',
  siret: '74900893400012',
  vatNumber: 'FR86749008934',
  billingStreet1: '8 rue du Lyonnais',
  billingStreet2: null,
  billingPostcode: '69200',
  billingCity: 'Vénissieux',
  notes: null,
  contacts: [
    { name: 'Sandrine Dupont', role: null, phone: '04 78 70 21 45', email: null },
    { name: 'Accounts payable', role: null, phone: null, email: 'factures@dupont.fr' },
  ],
  siteIds: [],
  ...changes,
});

const site = (changes: Partial<SiteRecord> = {}): SiteRecord => ({
  name: 'Plateforme Saint-Priest — quai B',
  street1: '14 rue des Frères Lumière',
  street2: null,
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  location: { latitude: 45.6906, longitude: 4.9488 },
  locatedBy: 'by-hand',
  timeZone: 'Europe/Paris',
  openings: [
    { weekday: 1, startMinute: 1320, endMinute: 1440 },
    { weekday: 2, startMinute: 0, endMinute: 300 },
  ],
  bookingRequired: true,
  bookingMethod: 'portal',
  bookingDetail: 'rdv.plateforme-stpriest.fr',
  protectiveEquipmentIds: ['60000000-0000-4000-8000-000000000001'],
  maxLengthCm: 1650,
  maxWeightKg: 44_000,
  loadingDock: true,
  semiTrailersAccepted: true,
  gatePhone: '04 72 23 18 90',
  instructions: null,
  ...changes,
});

describe('customers', () => {
  it('stores a customer with its contacts and usual sites', async () => {
    const dock = await ports.sites.create(site());
    const created = await ports.customers.create(customer({ siteIds: [dock.id] }));
    expect(created).toMatchObject({ code: 'DUPONT-MAT', siteIds: [dock.id] });
    expect(created.contacts.map((c) => c.name)).toEqual(['Sandrine Dupont', 'Accounts payable']);
    expect((await ports.sites.get(dock.id))?.customerIds).toEqual([created.id]);
  });

  it('criterion 11: a removed contact is deleted from the database, the other keeps its id', async () => {
    const created = await ports.customers.create(customer({ code: 'C11', siret: null }));
    const [kept] = created.contacts;
    const updated = await ports.customers.update(
      created.id,
      customer({ code: 'C11', siret: null, contacts: kept ? [kept] : [] }),
    );
    expect(updated?.contacts).toEqual([kept]);
    const rows = await database.db.execute(
      sql`select name from contact where customer_id = ${created.id}`,
    );
    expect((rows as unknown as { rows: unknown[] }).rows).toEqual([{ name: 'Sandrine Dupont' }]);
  });

  it('criterion 3: a code is unique, archived customers included, even without the check', async () => {
    const first = await ports.customers.create(customer({ code: 'DUPONT-IDF', siret: null }));
    await ports.customers.setArchived(first.id, true);
    await expect(
      ports.customers.create(customer({ code: 'DUPONT-IDF', siret: null })),
    ).rejects.toBeInstanceOf(CustomerCodeTakenError);
    expect(await ports.customers.findByCode('DUPONT-IDF')).toMatchObject({ archived: true });
  });

  it('criterion 2: a SIRET is unique among active customers only', async () => {
    const siret = '40483304800014';
    const first = await ports.customers.create(customer({ code: 'FIRST', siret }));
    await expect(
      ports.customers.create(customer({ code: 'SECOND', siret })),
    ).rejects.toBeInstanceOf(SiretTakenError);
    await ports.customers.setArchived(first.id, true);
    await ports.customers.create(customer({ code: 'SECOND', siret }));
    await expect(ports.customers.setArchived(first.id, false)).rejects.toBeInstanceOf(
      SiretTakenError,
    );
  });

  it('refuses a contact without phone or email, and a code in lower case', async () => {
    const created = await ports.customers.create(customer({ code: 'RAW', siret: null }));
    await expect(
      database.db.execute(
        sql`insert into contact (customer_id, name) values (${created.id}, 'Nobody')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`insert into customer (company_id, code, name) values ('10000000-0000-4000-8000-000000000001', 'lower', 'x')`,
      ),
    ).rejects.toThrow();
  });
});

describe('sites', () => {
  it('stores a site with a night over two days, its equipment and its location', async () => {
    const created = await ports.sites.create(site({ name: 'Night' }));
    expect(created).toMatchObject({
      locatedBy: 'by-hand',
      location: { latitude: 45.6906, longitude: 4.9488 },
      openings: [
        { weekday: 1, startMinute: 1320, endMinute: 1440 },
        { weekday: 2, startMinute: 0, endMinute: 300 },
      ],
      protectiveEquipmentIds: ['60000000-0000-4000-8000-000000000001'],
    });
  });

  it('criterion 9: the database refuses overlapping ranges of one day', async () => {
    const overlapping = site({
      name: 'Overlap',
      openings: [
        { weekday: 1, startMinute: 360, endMinute: 720 },
        { weekday: 1, startMinute: 660, endMinute: 1080 },
      ],
    });
    await expect(ports.sites.create(overlapping)).rejects.toBeInstanceOf(OpeningOverlapError);
  });

  it('keeps a site not located without coordinates, and refuses half a location', async () => {
    const created = await ports.sites.create(
      site({ name: 'Nowhere', location: null, locatedBy: 'not-located' }),
    );
    expect(created.location).toBeNull();
    await expect(
      database.db.execute(sql`update site set latitude = 45 where id = ${created.id}`),
    ).rejects.toThrow();
  });

  it('criterion 10: archiving a customer leaves its sites active', async () => {
    const dock = await ports.sites.create(site({ name: 'Shared' }));
    const a = await ports.customers.create(
      customer({ code: 'A10', siret: null, siteIds: [dock.id] }),
    );
    await ports.customers.create(customer({ code: 'B10', siret: null, siteIds: [dock.id] }));
    await ports.customers.setArchived(a.id, true);
    const shared = await ports.sites.get(dock.id);
    expect(shared?.archived).toBe(false);
    expect(shared?.customerIds).toHaveLength(2);
  });
});

describe('driver protective equipment', () => {
  it('criterion 14: stores the equipment a driver holds', async () => {
    const shoes = '60000000-0000-4000-8000-000000000001';
    const vest = '60000000-0000-4000-8000-000000000002';
    const driver = await ports.resources.create({
      details: {
        kind: 'driver',
        lastName: 'Moreau',
        firstName: 'Samuel',
        displayName: 'S. Moreau',
        employeeNumber: null,
        phone: null,
        protectiveEquipmentIds: [shoes, vest],
      },
      documents: [],
    });
    expect(driver).toMatchObject({ protectiveEquipmentIds: [shoes, vest] });
    const lists = await ports.referenceLists.get();
    expect(lists.protectiveEquipment.map((p) => p.code)).toEqual([
      'safety-shoes',
      'high-visibility-vest',
      'hard-hat',
      'safety-glasses',
      'gloves',
    ]);
  });
});
