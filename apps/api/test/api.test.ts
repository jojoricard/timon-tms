import { createRepositories, schema } from '@timon/db';
import { createTestDatabase, type TestDatabase } from '@timon/db/testing';
import { createApp } from '@timon/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs in-process on PGlite, and on PostgreSQL 18 when TEST_DATABASE_URL is set (CI).
let database: TestDatabase;
let app: ReturnType<typeof createApp>;
let resourceId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp(createRepositories(database.db));
  const [driver] = await database.db
    .insert(schema.resource)
    .values({ kind: 'driver', name: 'S. Moreau' })
    .returning();
  resourceId = driver?.id ?? '';
});

afterAll(() => database.close());

const book = (body: Record<string, unknown>) =>
  app.request('/api/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resourceId, label: 'CMD-2053', ...body }),
  });

describe('POST /api/bookings', () => {
  it('creates a booking', async () => {
    const response = await book({ start: '2026-10-07T13:00:00Z', end: '2026-10-07T17:30:00Z' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      resourceId,
      start: '2026-10-07T13:00:00Z',
      end: '2026-10-07T17:30:00Z',
    });
  });

  it('answers 409 with the conflicting booking on overlap', async () => {
    const response = await book({ start: '2026-10-07T17:00:00Z', end: '2026-10-07T19:00:00Z' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'overlap',
      conflicts: [{ start: '2026-10-07T13:00:00Z', end: '2026-10-07T17:30:00Z' }],
    });
  });

  it('accepts a booking starting when the previous one ends', async () => {
    const response = await book({ start: '2026-10-07T17:30:00Z', end: '2026-10-07T19:00:00Z' });
    expect(response.status).toBe(201);
  });

  it('answers 400 when the period ends before it starts', async () => {
    const response = await book({ start: '2026-10-07T12:00:00Z', end: '2026-10-07T10:00:00Z' });
    expect(response.status).toBe(400);
  });

  it('answers 404 for an unknown resource', async () => {
    const response = await book({
      resourceId: '00000000-0000-4000-8000-000000000999',
      start: '2026-10-08T08:00:00Z',
      end: '2026-10-08T10:00:00Z',
    });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/resources/{id}/bookings', () => {
  it('lists the bookings of a resource by start', async () => {
    const response = await app.request(`/api/resources/${resourceId}/bookings`);
    const bookings = (await response.json()) as { start: string }[];
    expect(bookings.map((b) => b.start)).toEqual(['2026-10-07T13:00:00Z', '2026-10-07T17:30:00Z']);
  });
});

describe('GET /api/openapi.json', () => {
  it('publishes the contract', async () => {
    const response = await app.request('/api/openapi.json');
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain('/api/bookings');
  });
});
