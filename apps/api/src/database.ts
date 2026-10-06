import { type Database, schema } from '@timon/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export function connect(): { db: Database; close: () => Promise<void> } {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}
