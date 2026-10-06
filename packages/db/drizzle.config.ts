import { defineConfig } from 'drizzle-kit';

// Generation only: migrations are applied by `migrate()`, the same way on PostgreSQL and PGlite.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
