import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/test/**/*.test.ts'],
    // Against a PostgreSQL server, test files share one database: run them one at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    // A fresh in-process PostgreSQL, migrated and seeded, takes a few seconds on a cold start.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
