import {
  customerSummary,
  listCustomers,
  listExpiries,
  listResources,
  listSites,
  resourceSummary,
  unitsAt,
  unitsOfResource,
} from '@timon/app';
import { isInCountry, Temporal } from '@timon/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories, seed } from '../src/index.ts';
import { createTestDatabase, offline, type TestDatabase } from '../src/testing.ts';

let database: TestDatabase | undefined;
afterEach(() => database?.close());

async function seeded(today: string) {
  database = await createTestDatabase();
  await seed(database.db, Temporal.PlainDate.from(today));
  // Noon in Paris on that day.
  const now = Temporal.PlainDate.from(today)
    .toZonedDateTime({ timeZone: 'Europe/Paris', plainTime: '12:00' })
    .toInstant();
  return {
    db: database.db,
    ports: { ...createRepositories(database.db, { now: () => now }), geocoder: offline },
  };
}

describe('seed', () => {
  it('writes the fleet of the mockups once', async () => {
    const { db, ports } = await seeded('2026-10-06');
    expect(await seed(db)).toBe(false);
    expect((await resourceSummary(ports)).active).toEqual({
      driver: 18,
      'power-unit': 12,
      trailer: 15,
    });
  });

  it('shows the nine expiries of the mockup on 6 October 2026', async () => {
    const { ports } = await seeded('2026-10-06');
    const { expiries, summary } = await listExpiries(ports);
    expect(expiries.map((e) => [e.resource.name, e.type.code ?? e.type.name, e.daysUntil])).toEqual(
      [
        ['T. Girard', 'cpc', -8],
        ['K. Benali', 'health-check', -4],
        ['S. Moreau', 'cpc', 12],
        ['M. Laurent', 'driver-card', 15],
        ['CD-456-EF', 'tachograph', 16],
        ['SR-4480', 'roadworthiness', 23],
        ['A. Lefèvre', 'driver-card', 27],
        ['GH-012-IJ', 'atp', 49],
        ['L. Fabre', 'cpc', 67],
      ],
    );
    expect(summary).toEqual({
      expiredBlocking: 1,
      expiredNotBlocking: 1,
      withinThirtyDays: 5,
      longerLeadTime: 2,
    });
  });

  it('keeps the same deadlines relative to any other day', async () => {
    const { ports } = await seeded('2027-03-15');
    const { expiries } = await listExpiries(ports);
    expect(expiries.map((e) => e.daysUntil)).toEqual([-8, -4, 12, 15, 16, 23, 27, 49, 67]);
    const { counts } = await listResources(ports, { kind: 'driver' });
    expect(counts).toEqual({ all: 18, expiring: 4, expired: 2 });
  });

  it('writes the customers and sites of the SPEC-002 mockups, linked', async () => {
    const { ports } = await seeded('2026-10-08');
    expect(await customerSummary(ports)).toEqual({ customers: 12, sites: 12 });
    const { customers } = await listCustomers(ports, { query: 'DUPONT-MAT' });
    expect(customers[0]?.siteIds).toHaveLength(4);
    const { counts } = await listSites(ports);
    expect(counts).toEqual({ all: 12, 'not-located': 1, booking: 8, 'protective-equipment': 11 });
    // SPEC-002, Locating a site: the demo places every pin inside its country.
    const outside = (await listSites(ports)).sites
      .filter((site) => site.location && !isInCountry(site.location, site.country))
      .map((site) => site.name);
    expect(outside).toEqual([]);
    const { resources } = await listResources(ports, { kind: 'driver', query: 'Moreau' });
    expect(resources[0]?.kind === 'driver' && resources[0].protectiveEquipmentIds).toHaveLength(3);
  });

  it('writes the units of the mockup: eleven running now, one changed, one without a driver', async () => {
    const { ports } = await seeded('2026-10-27');
    const { units, free } = await unitsAt(ports);
    expect(units.map((u) => [u.name, u.powerUnit.name, u.trailer?.name ?? null])).toEqual([
      ['H. Perrin', 'CD-456-EF', 'SR-4471'],
      ['J. Roux', 'ST-234-UV', 'SR-4472'],
      ['K. Benali', 'IJ-345-KL', 'SR-4492'],
      ['L. Fabre', 'KL-678-MN', 'FR-2214'],
      ['S. Haddad', 'AB-123-CD', 'SR-4488'],
      ['S. Moreau', 'EF-789-GH', 'SR-4480'],
      ['Unit 5', 'QR-678-ST', 'SR-4483'],
      ['N. Bensaïd', 'OP-901-QR', null],
      ['P. Vidal', 'GH-012-IJ', null],
      ['Y. Morel', 'MN-345-OP', 'RQ-0912'],
      ['É. Marchand', 'FG-204-HJ', null],
    ]);
    expect(units.find((u) => u.name === 'S. Haddad')?.end).not.toBeNull();
    expect(free.driver.map((d) => d.name)).toContain('M. Laurent');
    expect(free['power-unit'].map((p) => p.name)).toEqual(['JK-318-LM']);

    const moreau = units.find((u) => u.name === 'S. Moreau');
    const history = await unitsOfResource(ports, moreau?.driver?.id ?? '');
    expect(
      history.map((u) => [u.state, u.powerUnit.name, u.trailer?.name ?? null, u.changed]),
    ).toEqual([
      ['running', 'EF-789-GH', 'SR-4480', 'trailer'],
      ['ended', 'EF-789-GH', 'FR-2210', null],
      ['ended', 'AB-123-CD', 'FR-2210', null],
      ['ended', 'AB-123-CD', null, null],
    ]);
  });

  it('keeps the units running relative to any other day', async () => {
    const { ports } = await seeded('2027-03-15');
    expect((await unitsAt(ports)).units).toHaveLength(11);
  });
});
