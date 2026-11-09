export type { Database } from './database.ts';
export { migrate } from './migrate.ts';
export { createRepositories, type Repositories } from './repositories.ts';
export * as schema from './schema.ts';
export { seed } from './seed.ts';
// The parts of the demo haulier, for tests that need only some of it.
export { seedCustomers } from './seed-customers.ts';
export { seedOrders } from './seed-orders.ts';
