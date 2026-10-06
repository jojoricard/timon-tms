import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/test/**/*.test.ts'],
    // Against a PostgreSQL server, test files share one database: run them one at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
