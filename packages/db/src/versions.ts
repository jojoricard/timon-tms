import { StaleVersionError } from '@timon/app';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import type { customer, document, resource, site, transportOrder, unit } from './schema.ts';

// ADR-005: a write to an existing record applies only if the version it names is still the
// current one, and moves it on by one, in the same statement:
// UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2 RETURNING version.

type Versioned =
  | typeof resource
  | typeof document
  | typeof customer
  | typeof site
  | typeof unit
  | typeof transportOrder;

/** The WHERE of a versioned write. */
export const atVersion = (table: Versioned, id: string, version: number): SQL | undefined =>
  and(eq(table.id, id), eq(table.version, version));

/** The SET of a versioned write. */
export const nextVersion = (table: Versioned) => sql`${table.version} + 1`;

/**
 * After a versioned write that matched no row, a second read tells why: no such record, which
 * resolves to undefined, or a version no longer current, which throws StaleVersionError with the
 * current one. Inside a transaction, the throw rolls back what the write had done before.
 */
export async function missingOrStale(
  db: Database,
  table: Versioned,
  id: string,
): Promise<undefined> {
  const rows: { version: number }[] = await db
    .select({ version: table.version })
    .from(table as typeof resource)
    .where(eq(table.id, id));
  const [row] = rows;
  if (row) throw new StaleVersionError(row.version);
  return undefined;
}
