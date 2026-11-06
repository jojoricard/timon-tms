import { defaultDisplayName } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/index.ts';
import { seedDriverNames } from '../src/seed.ts';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

// SPEC-001 rule 8: a display name is stored only when typed. Migration 0014 empties the ones
// equal to the name built from the names, with a SQL function that must build exactly what
// the domain builds.

let database: TestDatabase | undefined;
afterEach(() => database?.close());

const subsidiary = '10000000-0000-4000-8000-000000000002';

type Row = { first_name: string; last_name: string; display_name: string | null };

async function drivers(db: TestDatabase['db']): Promise<Row[]> {
  const result = await db.execute(
    sql`select first_name, last_name, display_name from resource where kind = 'driver' order by last_name, first_name`,
  );
  return (result as unknown as { rows: Row[] }).rows;
}

const composed: [string, string][] = [
  ['Élodie', 'Marchand'],
  ['Émile', 'Zola'],
  ['Jean-Pierre', 'Lefèvre'],
  ['Xavier', "D'Artagnan"],
  ['Œdipe', 'Roi'],
  ['ïsa', 'Haddad'],
  ['àlex', 'de la Tour'],
  ['Ömer', 'Çelik'],
  ['Żaneta', 'Łukasik'],
];

describe('migration 0014: display names', () => {
  it('builds in SQL what the domain builds, for the seed drivers and composed names', async () => {
    database = await createTestDatabase();
    const names: [string, string][] = [
      ...seedDriverNames.map(({ first, last }): [string, string] => [first, last]),
      ...composed,
    ];
    expect(names.length).toBeGreaterThan(composed.length);
    for (const [first, last] of names) {
      const result = await database.db.execute(
        sql`select driver_display_name(${first}, ${last}) as name`,
      );
      const built = (result as unknown as { rows: { name: string }[] }).rows[0]?.name;
      expect([first, last, built]).toEqual([first, last, defaultDisplayName(first, last)]);
    }
  });

  it('empties a display name equal to the built one, and keeps one that was typed', async () => {
    database = await createTestDatabase({ through: '0013_units' });
    const rows: [string, string, string][] = [
      ['Xavier', "D'Artagnan", "X. D'Artagnan"],
      ['Élodie', 'Marchand', 'É. Marchand'],
      ['Karim', 'Benali', 'Kader'],
      ['Jean-Pierre', 'Lefèvre', 'JP Lefèvre'],
      ['Émile', 'Zola', 'e. zola'],
    ];
    for (const [first, last, shown] of rows) {
      await database.db.execute(
        sql`insert into resource (subsidiary_id, kind, first_name, last_name, display_name)
            values (${subsidiary}, 'driver', ${first}, ${last}, ${shown})`,
      );
    }
    await migrate(database.db);
    expect(await drivers(database.db)).toEqual([
      { first_name: 'Karim', last_name: 'Benali', display_name: 'Kader' },
      { first_name: 'Xavier', last_name: "D'Artagnan", display_name: null },
      { first_name: 'Jean-Pierre', last_name: 'Lefèvre', display_name: 'JP Lefèvre' },
      { first_name: 'Élodie', last_name: 'Marchand', display_name: null },
      { first_name: 'Émile', last_name: 'Zola', display_name: 'e. zola' },
    ]);
  });
});
