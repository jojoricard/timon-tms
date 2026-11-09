import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// The test files that create a database each run PostgreSQL in WebAssembly, on one thread, and
// most of them migrate and seed it before their first test. A dozen of them at once share the
// machine's cores with each other and with the other files, and their hooks then wait on the CPU,
// not on their own work: they ran past their timeouts on a busy machine. They run in a project of
// their own, on half the cores at most, so that their duration does not depend on the machine's
// load. TEST_DATABASE_WORKERS sets another number.
const databaseFiles = ['packages/db/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'];

export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Projects with different worker limits run one after the other: this one first.
          sequence: { groupOrder: 0 },
          include: ['{packages,apps}/*/test/**/*.test.ts'],
          exclude: databaseFiles,
        },
      },
      {
        extends: true,
        test: {
          name: 'database',
          sequence: { groupOrder: 1 },
          include: databaseFiles,
          maxWorkers: Number(
            process.env.TEST_DATABASE_WORKERS ??
              Math.max(2, Math.floor(availableParallelism() / 2)),
          ),
          // Against a PostgreSQL server, test files share one database: one at a time.
          fileParallelism: !process.env.TEST_DATABASE_URL,
        },
      },
    ],
  },
});
