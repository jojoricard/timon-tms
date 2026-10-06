/// <reference lib="webworker" />
// The API of the demo: the same Hono application as the server, on PGlite stored in the
// visitor's IndexedDB, with the same migrations and the same demo haulier.
import { PGlite } from '@electric-sql/pglite';
import { createRepositories, migrate, schema, seed } from '@timon/db';
import { createApp } from '@timon/http';
import { drizzle } from 'drizzle-orm/pglite';
import { btree_gist } from './btree-gist.ts';

declare const self: ServiceWorkerGlobalScope;

let app: Promise<ReturnType<typeof createApp>> | undefined;

async function start() {
  const client = await PGlite.create('idb://timon-demo', { extensions: { btree_gist } });
  const db = drizzle({ client, schema });
  await migrate(db);
  await seed(db);
  return createApp(createRepositories(db));
}

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// Sent by the shell when a forced reload left the page uncontrolled.
self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return;
  app ??= start().catch((error: unknown) => {
    app = undefined;
    throw error;
  });
  event.respondWith(
    app.then(
      (api) => api.fetch(event.request),
      (error: unknown) => {
        console.error('Timon demo: the in-browser database did not start', error);
        return Response.json(
          { error: 'demo-unavailable', message: String(error) },
          { status: 503 },
        );
      },
    ),
  );
});
