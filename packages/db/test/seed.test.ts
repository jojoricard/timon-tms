import {
  customerSummary,
  listCustomers,
  listExpiries,
  listResources,
  listSites,
  resourceSummary,
} from '@timon/app';
import { Temporal } from '@timon/domain';
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
    const { resources } = await listResources(ports, { kind: 'driver', query: 'Moreau' });
    expect(resources[0]?.kind === 'driver' && resources[0].protectiveEquipmentIds).toHaveLength(3);
  });
});
