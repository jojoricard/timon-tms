import { type NewUnit, UnitOverlapError } from '@timon/app';
import { openPeriodOf, type ResourceDetails, Temporal } from '@timon/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories } from '../src/index.ts';
import { unitMember } from '../src/schema.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';
import { parseOpenRange } from '../src/tstzrange.ts';

// The rules the database keeps on its own, whatever the application checks first: one unit per
// resource at a time (SPEC-003 rule 4), a member's role matching its resource's kind.

let database: TestDatabase;
const ids: Record<string, string> = {};

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

beforeAll(async () => {
  database = await createTestDatabase();
  const { resources } = createRepositories(database.db);
  for (const [key, details] of Object.entries({
    first: vehicle('ST-901-UV', 'tractor'),
    second: vehicle('QR-678-ST', 'tractor'),
    trailer: vehicle('SR-4478', 'semi-trailer'),
  })) {
    ids[key] = (await resources.create({ details, documents: [] })).id;
  }
});

afterAll(() => database.close());

const at = (time: string) => `2026-10-20T${time}:00Z`;
const unit = (powerUnit: string, start: string, end: string | null): NewUnit => ({
  name: null,
  powerUnitId: ids[powerUnit] ?? '',
  trailerId: ids.trailer ?? '',
  driverId: null,
  period: openPeriodOf(at(start), end ? at(end) : null),
  previousUnitId: null,
});

describe('unit_member', () => {
  it('stores an open-ended period and reads it back', async () => {
    const { units } = createRepositories(database.db);
    const created = await units.create(unit('first', '22:00', null));
    expect(created.period.start.toString()).toBe(at('22:00'));
    expect(created.period.end).toBeNull();
    expect(await units.remove(created.id, created.version)).toBe(true);
  });

  it('refuses a resource in two units over overlapping periods, without any check', async () => {
    const { units } = createRepositories(database.db);
    await units.create(unit('first', '08:00', '20:00'));
    await expect(units.create(unit('second', '18:00', '22:00'))).rejects.toThrow(UnitOverlapError);
    const touching = await units.create(unit('second', '20:00', '22:00'));
    expect(touching.period.start.toString()).toBe(at('20:00'));
  });

  it('checks the members again when a unit is given a later end', async () => {
    const { units } = createRepositories(database.db);
    const [morning] = await units.listAt(Temporal.Instant.from(at('09:00')));
    if (!morning) throw new Error('No unit at 09:00');
    await expect(
      units.setEnd(morning.id, morning.version, Temporal.Instant.from(at('21:00'))),
    ).rejects.toThrow(UnitOverlapError);
    const shorter = await units.setEnd(
      morning.id,
      morning.version,
      Temporal.Instant.from(at('19:00')),
    );
    expect(shorter?.period.end?.toString()).toBe(at('19:00'));
    const members = await database.db
      .select({ period: unitMember.period })
      .from(unitMember)
      .where(eq(unitMember.unitId, morning.id));
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.period.end?.toString()).toBe(at('19:00'));
    }
  });

  it('ends a unit and starts the next in one transaction', async () => {
    const { units } = createRepositories(database.db);
    const open = await units.create({
      ...unit('first', '23:00', null),
      trailerId: null,
      driverId: null,
    });
    const { ended, started } = await units.change(open.id, open.version, {
      ...unit('first', '23:30', null),
      previousUnitId: open.id,
    });
    expect(ended.period.end?.toString()).toBe(at('23:30'));
    expect(started).toMatchObject({ previousUnitId: open.id, trailerId: ids.trailer });
  });

  it('refuses a resource in a place that is not its kind', async () => {
    const { units } = createRepositories(database.db);
    await expect(
      units.create({
        ...unit('first', '00:00', '01:00'),
        powerUnitId: ids.trailer ?? '',
        trailerId: ids.first ?? '',
      }),
    ).rejects.toThrow();
  });
});

describe('parseOpenRange', () => {
  it('reads a range with and without an upper bound', () => {
    expect(parseOpenRange('["2026-10-06 04:00:00+00",)').end).toBeNull();
    const bounded = parseOpenRange('["2026-10-06 06:00:00+02","2026-10-06 20:00:00+02")');
    expect(bounded.end?.toString()).toBe('2026-10-06T18:00:00Z');
    expect(() => parseOpenRange('(,)')).toThrow();
  });
});
