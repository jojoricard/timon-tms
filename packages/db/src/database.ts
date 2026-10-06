import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.ts';

/** A Drizzle database on node-postgres (server) or PGlite (demo, tests): the code is the same. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
