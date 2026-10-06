// Test support: a migrated database on PGlite, or on the PostgreSQL server named by
// TEST_DATABASE_URL (CI runs the suite both ways). Never imported by application code.
import { sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { migrate } from './migrate.ts';
import * as schema from './schema.ts';

export type TestDatabase = { db: Database; close: () => Promise<void> };

export async function createTestDatabase(): Promise<TestDatabase> {
  const url = process.env.TEST_DATABASE_URL;
  const database = url ? await onPostgres(url) : await onPglite();
  await migrate(database.db);
  return database;
}

async function onPglite(): Promise<TestDatabase> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = await PGlite.create({ extensions: { btree_gist } });
  return { db: drizzle({ client, schema }), close: () => client.close() };
}

// Test files run one at a time against a server; each starts from an empty schema.
async function onPostgres(url: string): Promise<TestDatabase> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const client = new Pool({ connectionString: url, max: 4 });
  const db = drizzle({ client, schema });
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  return { db, close: () => client.end() };
}
