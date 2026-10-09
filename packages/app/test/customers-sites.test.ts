import type { SiteDetails } from '@timon/domain';
import { describe, expect, it } from 'vitest';
import {
  type CustomerInput,
  createCustomer,
  createSite,
  getCustomer,
  listCustomers,
  listSites,
  setCustomerArchived,
  suggestAddresses,
  updateCustomer,
  updateSite,
} from '../src/index.ts';
import { createFakeGeocoder, velizy } from './fake-geocoder.ts';
import { memoryPorts } from './memory.ts';

const customer = (changes: Partial<CustomerInput> = {}): CustomerInput => ({
  name: 'Dupont Matériaux SAS',
  code: 'DUPONT-MAT',
  country: 'FR',
  siret: '749 008 934 00012',
  vatNumber: 'FR86749008934',
  billingStreet1: '8 rue du Lyonnais',
  billingStreet2: null,
  billingPostcode: '69200',
  billingCity: 'Vénissieux',
  notes: null,
  contacts: [
    { name: 'Sandrine Dupont', role: 'Transport manager', phone: '04 78 70 21 45', email: null },
    { name: 'Accounts payable', role: 'Invoices', phone: null, email: 'factures@dupont.fr' },
  ],
  siteIds: [],
  ...changes,
});

const site = (changes: Partial<SiteDetails> = {}): SiteDetails => ({
  name: 'Saint-Priest platform — dock B',
  street1: '14 rue des Frères Lumière',
  street2: null,
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  location: { latitude: 45.7124, longitude: 4.95815 },
  locatedBy: 'by-hand',
  openings: [{ weekday: 1, startMinute: 300, endMinute: 1260 }],
  bookingRequired: false,
  bookingMethod: null,
  bookingDetail: null,
  protectiveEquipmentIds: ['pe-safety-shoes'],
  maxLengthCm: null,
  maxWeightKg: null,
  loadingDock: true,
  semiTrailersAccepted: true,
  gatePhone: null,
  instructions: null,
  ...changes,
});

async function ok<T extends { ok: boolean }>(result: Promise<T>) {
  const value = await result;
  expect(value.ok, JSON.stringify(value)).toBe(true);
  return value as Extract<T, { ok: true }>;
}

describe('customers', () => {
  it('stores the SIRET without spaces and the code in capitals', async () => {
    const { ports } = memoryPorts();
    const { customer: saved } = await ok(createCustomer(ports, customer({ code: 'dupont-mat' })));
    expect(saved).toMatchObject({ code: 'DUPONT-MAT', siret: '74900893400012' });
  });

  it('criterion 2: refuses a SIRET an active customer has, naming it', async () => {
    const { ports } = memoryPorts();
    const { customer: first } = await ok(
      createCustomer(ports, customer({ siret: '40483304800014' })),
    );
    expect(
      await createCustomer(ports, customer({ code: 'OTHER', siret: '404 833 048 00014' })),
    ).toEqual({
      ok: false,
      reason: 'siret-taken',
      owner: { id: first.id, code: 'DUPONT-MAT', name: 'Dupont Matériaux SAS', archived: false },
    });
  });

  it('criterion 3: refuses the code of an archived customer, whatever its case', async () => {
    const { ports } = memoryPorts();
    const { customer: first } = await ok(
      createCustomer(ports, customer({ code: 'DUPONT-IDF', siret: null })),
    );
    await setCustomerArchived(ports, first.id, true);
    expect(
      await createCustomer(ports, customer({ code: 'dupont-idf', siret: null })),
    ).toMatchObject({
      ok: false,
      reason: 'code-taken',
      owner: { code: 'DUPONT-IDF', archived: true },
    });
  });

  it('criterion 4: a contact with a name only is refused', async () => {
    const { ports } = memoryPorts();
    const contacts = [{ name: 'Yanis Mercier', role: 'Yard', phone: '', email: ' ' }];
    expect(await createCustomer(ports, customer({ contacts }))).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [{ field: 'contacts.0', code: 'contact-unreachable' }],
    });
  });

  it('criterion 11: a removed contact no longer exists, archived lists included', async () => {
    const { ports } = memoryPorts();
    const { customer: saved } = await ok(createCustomer(ports, customer()));
    const [kept] = saved.contacts;
    await ok(updateCustomer(ports, saved.id, customer({ contacts: kept ? [kept] : [] })));
    const all = await listCustomers(ports, { includeArchived: true });
    const contacts = all.customers.flatMap((c) => c.contacts.map((x) => x.name));
    expect(contacts).toEqual(['Sandrine Dupont']);
  });

  it('criterion 10: archiving a customer leaves its usual sites active and linked to others', async () => {
    const { ports } = memoryPorts();
    const { site: shared } = await ok(createSite(ports, site()));
    const { customer: dupont } = await ok(
      createCustomer(ports, customer({ siteIds: [shared.id] })),
    );
    const { customer: lumiere } = await ok(
      createCustomer(ports, customer({ code: 'LUMIERE-EM', siret: null, siteIds: [shared.id] })),
    );
    await ok(setCustomerArchived(ports, dupont.id, true));
    const { sites } = await listSites(ports);
    expect(sites.map((s) => [s.name, s.archived])).toEqual([[shared.name, false]]);
    expect((await getCustomer(ports, lumiere.id))?.sites.map((s) => s.id)).toEqual([shared.id]);
  });

  it('lists customers in France and abroad, searched by SIRET', async () => {
    const { ports } = memoryPorts();
    await ok(createCustomer(ports, customer()));
    await ok(
      createCustomer(
        ports,
        customer({
          code: 'TRANSALP-IT',
          name: 'Transalpina',
          country: 'IT',
          siret: null,
          billingPostcode: '10156',
        }),
      ),
    );
    const list = await listCustomers(ports, { country: 'abroad' });
    expect(list.counts).toEqual({ all: 2, france: 1, abroad: 1 });
    expect(list.customers.map((c) => c.code)).toEqual(['TRANSALP-IT']);
    expect((await listCustomers(ports, { query: '749 008 934' })).customers).toHaveLength(1);
  });
});

describe('sites', () => {
  it('criterion 5: a suggestion fills the address and locates by address', async () => {
    const geocoder = createFakeGeocoder((q) => (q.includes('avenue de l') ? [velizy] : []));
    const { ports } = memoryPorts(undefined, geocoder);
    const { candidates } = await suggestAddresses(geocoder, "2 avenue de l'Europe 78140 Vélizy", {
      country: 'FR',
      limit: 5,
    });
    const [chosen] = candidates;
    expect(chosen?.precision).toBe('address');
    const { site: saved } = await ok(
      createSite(
        ports,
        site({
          street1: chosen?.street ?? '',
          postcode: chosen?.postcode ?? '',
          city: chosen?.city ?? '',
          location: { latitude: chosen?.latitude ?? 0, longitude: chosen?.longitude ?? 0 },
          locatedBy: chosen?.precision ?? 'not-located',
        }),
      ),
    );
    expect(saved).toMatchObject({
      postcode: '78140',
      city: 'Vélizy-Villacoublay',
      locatedBy: 'address',
    });
  });

  it('criterion 6: a site in Germany placed by hand is in Europe/Berlin', async () => {
    const { ports } = memoryPorts();
    const { site: saved } = await ok(
      createSite(
        ports,
        site({
          country: 'DE',
          postcode: '80331',
          city: 'München',
          location: { latitude: 48.137, longitude: 11.575 },
        }),
      ),
    );
    expect(saved).toMatchObject({ locatedBy: 'by-hand', timeZone: 'Europe/Berlin' });
  });

  it('criterion 7: the geocoder cannot be reached, the site is saved as not located', async () => {
    const geocoder = createFakeGeocoder(() => [], { unavailable: true });
    const { ports } = memoryPorts(undefined, geocoder);
    const { site: saved } = await ok(
      createSite(ports, site({ location: null, locatedBy: 'not-located' })),
    );
    expect(saved.locatedBy).toBe('not-located');
    expect(geocoder.queries).toHaveLength(1);
    const { sites, counts } = await listSites(ports, { filter: 'not-located' });
    expect(sites.map((s) => s.id)).toEqual([saved.id]);
    expect(counts['not-located']).toBe(1);
  });

  it('locates a French site saved without coordinates', async () => {
    const geocoder = createFakeGeocoder(() => [{ ...velizy, precision: 'street' }]);
    const { ports } = memoryPorts(undefined, geocoder);
    const { site: saved } = await ok(
      createSite(ports, site({ location: null, locatedBy: 'not-located' })),
    );
    expect(saved).toMatchObject({ locatedBy: 'street', location: { latitude: velizy.latitude } });
  });

  it('criterion 8: a site 30 metres away is named as a warning, and saved', async () => {
    const { ports } = memoryPorts();
    const { site: dockB } = await ok(createSite(ports, site()));
    const result = await ok(
      createSite(
        ports,
        site({
          name: 'Saint-Priest platform — dock C',
          street1: '16 rue des Frères Lumière',
          location: { latitude: 45.7124 + 30 / 111_195, longitude: 4.95815 },
        }),
      ),
    );
    expect(result.nearby).toEqual([
      { id: dockB.id, name: dockB.name, distanceMetres: 30, sameStreet: false },
    ]);
    // Editing dock B does not warn about dock B itself.
    const again = await ok(updateSite(ports, dockB.id, site({ instructions: 'Gate 3' })));
    expect(again.nearby.map((n) => n.name)).toEqual(['Saint-Priest platform — dock C']);
  });

  it('criterion 9: overlapping ranges are refused; a night over two days is saved', async () => {
    const { ports } = memoryPorts();
    const overlap = await createSite(
      ports,
      site({
        openings: [
          { weekday: 1, startMinute: 360, endMinute: 720 },
          { weekday: 1, startMinute: 660, endMinute: 1080 },
        ],
      }),
    );
    expect(overlap).toMatchObject({
      ok: false,
      reason: 'invalid',
      issues: [{ code: 'opening-overlap' }],
    });
    await ok(
      createSite(
        ports,
        site({
          openings: [
            { weekday: 1, startMinute: 1320, endMinute: 1440 },
            { weekday: 2, startMinute: 0, endMinute: 300 },
          ],
        }),
      ),
    );
  });

  it("gives today's hours in the site's own time zone", async () => {
    // Monday 5 October 2026, 23:30 in Paris: already Tuesday in Bucharest.
    const { ports } = memoryPorts('2026-10-05T21:30:00Z');
    await ok(createSite(ports, site({ country: 'RO', postcode: '010011', city: 'București' })));
    const [listed] = (await listSites(ports)).sites;
    expect(listed?.today.weekday).toBe(2);
  });
});

describe('suggestAddresses', () => {
  it('asks nothing for less than three characters or outside France', async () => {
    const geocoder = createFakeGeocoder(() => [velizy]);
    expect(
      (await suggestAddresses(geocoder, ' 2 ', { country: 'FR', limit: 5 })).candidates,
    ).toEqual([]);
    expect(
      (await suggestAddresses(geocoder, '2 avenue', { country: 'DE', limit: 5 })).candidates,
    ).toEqual([]);
    expect(geocoder.queries).toEqual([]);
  });

  it('answers an empty list when the service cannot be reached', async () => {
    const geocoder = createFakeGeocoder(() => [], { unavailable: true });
    expect(await suggestAddresses(geocoder, '2 avenue', { country: 'FR', limit: 5 })).toEqual({
      available: false,
      candidates: [],
    });
  });
});
