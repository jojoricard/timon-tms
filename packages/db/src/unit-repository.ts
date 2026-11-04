import type { NewUnit, StoredUnit, UnitRepository } from '@timon/app';
import type { Temporal, UnitRole } from '@timon/domain';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { defaultCompanyId } from './customer-repositories.ts';
import type { Database } from './database.ts';
import { translateErrors } from './errors.ts';
import { unit, unitMember } from './schema.ts';
import { formatOpenRange } from './tstzrange.ts';

type UnitRow = typeof unit.$inferSelect;
type MemberRow = typeof unitMember.$inferSelect;

function toUnit(row: UnitRow, members: readonly MemberRow[]): StoredUnit {
  const of = (role: UnitRole) =>
    members.find((m) => m.unitId === row.id && m.role === role)?.resourceId ?? null;
  const powerUnitId = of('power-unit');
  if (!powerUnitId) throw new Error(`Unit ${row.id} has no power unit`);
  return {
    id: row.id,
    name: row.name,
    period: row.period,
    previousUnitId: row.previousUnitId,
    powerUnitId,
    trailerId: of('trailer'),
    driverId: of('driver'),
  };
}

function memberRows(unitId: string, input: NewUnit) {
  const rows: (typeof unitMember.$inferInsert)[] = [
    { unitId, resourceId: input.powerUnitId, role: 'power-unit', period: input.period },
  ];
  if (input.trailerId) {
    rows.push({ unitId, resourceId: input.trailerId, role: 'trailer', period: input.period });
  }
  if (input.driverId) {
    rows.push({ unitId, resourceId: input.driverId, role: 'driver', period: input.period });
  }
  return rows;
}

const byStart = sql`lower(${unit.period})`;

export function unitRepository(db: Database): UnitRepository {
  async function load(rows: UnitRow[]): Promise<StoredUnit[]> {
    if (rows.length === 0) return [];
    const members = await db
      .select()
      .from(unitMember)
      .where(
        inArray(
          unitMember.unitId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((row) => toUnit(row, members));
  }

  async function get(id: string) {
    const rows = await db.select().from(unit).where(eq(unit.id, id));
    return (await load(rows))[0];
  }

  async function insert(tx: Database, input: NewUnit) {
    const [row] = await tx
      .insert(unit)
      .values({
        companyId: defaultCompanyId,
        name: input.name,
        period: input.period,
        previousUnitId: input.previousUnitId,
      })
      .returning({ id: unit.id });
    if (!row) throw new Error('Insert returned no row');
    await tx.insert(unitMember).values(memberRows(row.id, input));
    return row.id;
  }

  // The members' period follows through the cascading foreign key, and the exclusion
  // constraint is checked on each member row it updates.
  async function end(tx: Database, id: string, at: Temporal.Instant) {
    const rows = await tx
      .update(unit)
      .set({ period: sql`tstzrange(lower(${unit.period}), ${at.toString()}::timestamptz, '[)')` })
      .where(eq(unit.id, id))
      .returning({ id: unit.id });
    return rows.length > 0;
  }

  const found = async (id: string) => {
    const stored = await get(id);
    if (!stored) throw new Error(`Unit ${id} vanished`);
    return stored;
  };

  return {
    get,
    listAt: async (instant) =>
      load(
        await db
          .select()
          .from(unit)
          .where(sql`${unit.period} @> ${instant.toString()}::timestamptz`)
          .orderBy(byStart),
      ),
    listOverlapping: async (period, exceptId) =>
      load(
        await db
          .select()
          .from(unit)
          .where(
            and(
              sql`${unit.period} && ${formatOpenRange(period)}::tstzrange`,
              exceptId ? ne(unit.id, exceptId) : undefined,
            ),
          )
          .orderBy(byStart),
      ),
    listByResource: async (resourceId) =>
      load(
        await db
          .select()
          .from(unit)
          .where(
            inArray(
              unit.id,
              db
                .select({ id: unitMember.unitId })
                .from(unitMember)
                .where(eq(unitMember.resourceId, resourceId)),
            ),
          )
          .orderBy(desc(byStart)),
      ),
    create: async (input) => {
      const id = await translateErrors(() => db.transaction((tx) => insert(tx, input)));
      return found(id);
    },
    replace: async (id, input) => {
      const replaced = await translateErrors(() =>
        db.transaction(async (tx) => {
          await tx.delete(unitMember).where(eq(unitMember.unitId, id));
          const rows = await tx
            .update(unit)
            .set({ name: input.name, period: input.period, previousUnitId: input.previousUnitId })
            .where(eq(unit.id, id))
            .returning({ id: unit.id });
          if (rows.length === 0) return false;
          await tx.insert(unitMember).values(memberRows(id, input));
          return true;
        }),
      );
      return replaced ? get(id) : undefined;
    },
    remove: async (id) => {
      const rows = await db.delete(unit).where(eq(unit.id, id)).returning({ id: unit.id });
      return rows.length > 0;
    },
    setEnd: async (id, at) => {
      const ended = await translateErrors(() => db.transaction((tx) => end(tx, id, at)));
      return ended ? get(id) : undefined;
    },
    change: async (id, next) => {
      const startedId = await translateErrors(() =>
        db.transaction(async (tx) => {
          if (!(await end(tx, id, next.period.start))) throw new Error(`No unit ${id}`);
          return insert(tx, next);
        }),
      );
      return { ended: await found(id), started: await found(startedId) };
    },
  };
}
