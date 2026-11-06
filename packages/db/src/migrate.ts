import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Database } from './database.ts';
import { migrations } from './migrations.gen.ts';

const migrationLog = pgTable('timon_migration', {
  name: text().primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

// Drizzle's own migrators read the migration folder from disk, which a service worker cannot do.
// This one applies the same SQL files, embedded at build time, in one transaction. `through`
// stops after the named migration, so that a test can write rows a later one transforms.
export async function migrate(db: Database, options: { through?: string } = {}): Promise<string[]> {
  const last = options.through
    ? migrations.findIndex((m) => m.name === options.through)
    : migrations.length - 1;
  if (last < 0) throw new Error(`Unknown migration ${options.through}`);
  await db.execute(
    sql`create table if not exists timon_migration (name text primary key, applied_at timestamptz not null default now())`,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('timon_migration'))`);
    const applied = new Set((await tx.select().from(migrationLog)).map((row) => row.name));
    const pending = migrations
      .slice(0, last + 1)
      .filter((migration) => !applied.has(migration.name));
    for (const migration of pending) {
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.insert(migrationLog).values({ name: migration.name });
    }
    return pending.map((migration) => migration.name);
  });
}
