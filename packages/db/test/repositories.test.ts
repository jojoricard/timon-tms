import { BookingOverlapError } from '@timon/app';
import { periodOf } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories, migrate, schema, seed } from '../src/index.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

let database: TestDatabase;
let driverId: string;
let otherDriverId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  const rows = await database.db
    .insert(schema.resource)
    .values([
      { kind: 'driver', name: 'L. Fabre' },
      { kind: 'driver', name: 'K. Benali' },
    ])
    .returning();
  driverId = rows[0]?.id ?? '';
  otherDriverId = rows[1]?.id ?? '';
});

afterAll(() => database.close());

const at = (hour: number) => `2026-10-07T${String(hour).padStart(2, '0')}:00:00Z`;

describe('migrate', () => {
  it('applies nothing twice', async () => {
    expect(await migrate(database.db)).toEqual([]);
  });
});

describe('resource_booking', () => {
  it('stores and reads back a period', async () => {
    const { bookings } = createRepositories(database.db);
    const created = await bookings.insert({
      resourceId: driverId,
      period: periodOf(at(8), at(12)),
      label: 'CMD-2053',
    });
    expect(created.period.start.toString()).toBe(at(8));
    expect(created.period.end.toString()).toBe(at(12));
  });

  it('is protected by the database: an overlapping insert is refused without any check', async () => {
    const { bookings } = createRepositories(database.db);
    await expect(
      bookings.insert({
        resourceId: driverId,
        period: periodOf(at(11), at(13)),
        label: 'CMD-2054',
      }),
    ).rejects.toBeInstanceOf(BookingOverlapError);
  });

  it('accepts a booking that starts when the previous one ends', async () => {
    const { bookings } = createRepositories(database.db);
    await bookings.insert({
      resourceId: driverId,
      period: periodOf(at(12), at(14)),
      label: 'CMD-2055',
    });
    expect(await bookings.listOverlapping(driverId, periodOf(at(11), at(13)))).toHaveLength(2);
  });

  it('accepts the same period on another resource', async () => {
    const { bookings } = createRepositories(database.db);
    await bookings.insert({
      resourceId: otherDriverId,
      period: periodOf(at(8), at(12)),
      label: 'CMD-2056',
    });
    expect(await bookings.listByResource(otherDriverId)).toHaveLength(1);
  });

  it('refuses an unbounded period', async () => {
    await expect(
      database.db.execute(
        sql`insert into resource_booking (resource_id, period, label) values (${otherDriverId}, tstzrange(now(), null), 'open')`,
      ),
    ).rejects.toThrow();
  });
});

describe('seed', () => {
  it('writes the demo haulier once', async () => {
    const fresh = await createTestDatabase();
    try {
      expect(await seed(fresh.db)).toBe(true);
      expect(await seed(fresh.db)).toBe(false);
      const { resources } = createRepositories(fresh.db);
      expect((await resources.list()).length).toBeGreaterThan(0);
    } finally {
      await fresh.close();
    }
  });
});
