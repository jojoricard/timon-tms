import { textLimits } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing.ts';

// Every text the API limits fits its column, read from the migrated database: a column without a
// length takes any text, a column with one has the limit of the API. A value too long is then
// refused with an issue on its field, never by the database with a 500.

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(() => database.close());

const snake = (name: string) => name.replace(/[A-Z]+/g, (part) => `_${part.toLowerCase()}`);

type Column = { data_type: string; character_maximum_length: number | null };

describe('text limits', () => {
  for (const [table, fields] of Object.entries(textLimits)) {
    for (const [field, limit] of Object.entries(fields)) {
      it(`${table}.${field} holds ${limit} characters`, async () => {
        const result = (await database.db.execute(sql`
          select data_type, character_maximum_length from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${snake(field)}`)) as {
          rows: Column[];
        };
        const [column] = result.rows;
        expect(column, `${table}.${snake(field)} exists`).toBeDefined();
        if (column?.character_maximum_length === null) {
          expect(column.data_type).toBe('text');
        } else {
          expect(column?.character_maximum_length).toBe(limit);
        }
      });
    }
  }
});
