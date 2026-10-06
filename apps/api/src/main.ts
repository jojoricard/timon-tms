import { serve } from '@hono/node-server';
import { createRepositories } from '@timon/db';
import { createApp } from '@timon/http';
import { connect } from './database.ts';

const port = Number(process.env.PORT ?? 3000);
const { db, close } = connect();
const server = serve({ fetch: createApp(createRepositories(db)).fetch, port }, ({ port }) => {
  console.log(`Timon API on http://localhost:${port}/api (contract: /api/openapi.json)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => void close()));
}
