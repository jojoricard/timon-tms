import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addDocument,
  checkImport,
  createBooking,
  createResource,
  type DocumentResult,
  getReferenceLists,
  getResource,
  importResources,
  importTemplate,
  listBookings,
  listExpiries,
  listResources,
  type Ports,
  removeDocument,
  resourceSummary,
  setArchived,
  statusFilters,
  updateDocument,
  updateResource,
} from '@timon/app';
import { periodOf, type ResourceBooking } from '@timon/domain';
import { bodyLimit } from 'hono/body-limit';
import {
  Booking,
  DocumentInput,
  ExpiryList,
  ImportCheck,
  ImportInput,
  ImportRefused,
  Invalid,
  NewBooking,
  Overlap,
  PlateTaken,
  Problem,
  ReferenceLists,
  Resource,
  ResourceInput,
  ResourceKind,
  ResourceList,
  ResourceSummary,
} from './schemas.ts';
import { fromDocumentInput, fromInput, toExpiry, toImportCheck, toResource } from './to-json.ts';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { ...json(schema, 'Request body'), required: true },
});

const toBooking = ({ period, ...booking }: ResourceBooking): z.infer<typeof Booking> => ({
  ...booking,
  start: period.start.toString(),
  end: period.end.toString(),
});

const id = z.object({ id: z.uuid() });
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

// What a write on a resource can answer.
const resourceAnswers = {
  200: json(Resource, 'The resource, with its documents and statuses'),
  400: json(z.union([Invalid, Problem]), 'A rule is broken; each issue names its field'),
  404: json(Problem, 'No such resource'),
  409: json(z.union([PlateTaken, Problem]), 'Plate used by another active resource (rule 1)'),
};

const routes = {
  summary: createRoute({
    method: 'get',
    path: '/resources/summary',
    responses: { 200: json(ResourceSummary, 'Active resources per kind, expiries') },
  }),
  list: createRoute({
    method: 'get',
    path: '/resources',
    request: {
      query: z.object({
        kind: ResourceKind,
        q: z.string().max(100).optional(),
        status: z.enum(statusFilters).optional(),
        archived: flag,
      }),
    },
    responses: { 200: json(ResourceList, 'Resources of one kind, with their status today') },
  }),
  get: createRoute({
    method: 'get',
    path: '/resources/{id}',
    request: { params: id },
    responses: {
      200: json(Resource, 'The resource'),
      404: json(Problem, 'No such resource'),
    },
  }),
  create: createRoute({
    method: 'post',
    path: '/resources',
    request: body(ResourceInput),
    responses: { ...resourceAnswers, 201: json(Resource, 'Resource created') },
  }),
  update: createRoute({
    method: 'put',
    path: '/resources/{id}',
    request: { params: id, ...body(ResourceInput) },
    responses: resourceAnswers,
  }),
  archive: createRoute({
    method: 'post',
    path: '/resources/{id}/archive',
    request: { params: id },
    responses: resourceAnswers,
  }),
  restore: createRoute({
    method: 'post',
    path: '/resources/{id}/restore',
    request: { params: id },
    responses: resourceAnswers,
  }),
  addDocument: createRoute({
    method: 'post',
    path: '/resources/{id}/documents',
    request: { params: id, ...body(DocumentInput) },
    responses: { ...resourceAnswers, 201: json(Resource, 'Document added') },
  }),
  updateDocument: createRoute({
    method: 'put',
    path: '/documents/{id}',
    request: { params: id, ...body(DocumentInput) },
    responses: resourceAnswers,
  }),
  removeDocument: createRoute({
    method: 'delete',
    path: '/documents/{id}',
    request: { params: id },
    responses: resourceAnswers,
  }),
  expiries: createRoute({
    method: 'get',
    path: '/expiries',
    request: {
      query: z.object({ kind: ResourceKind.optional(), blocking: flag }),
    },
    responses: { 200: json(ExpiryList, 'Documents expired or within their warning period') },
  }),
  referenceLists: createRoute({
    method: 'get',
    path: '/reference-lists',
    responses: { 200: json(ReferenceLists, 'Document types, body types, labels, capabilities') },
  }),
  template: createRoute({
    method: 'get',
    path: '/imports/{kind}/template',
    request: {
      params: z.object({ kind: ResourceKind }),
      query: z.object({ lang: z.enum(['en', 'fr']).optional() }),
    },
    responses: {
      200: { content: { 'text/csv': { schema: z.string() } }, description: 'CSV header line' },
    },
  }),
  checkImport: createRoute({
    method: 'post',
    path: '/imports/{kind}/check',
    request: { params: z.object({ kind: ResourceKind }), ...body(ImportInput) },
    responses: {
      200: json(ImportCheck, 'Every line with its issues; nothing is written'),
      413: json(Problem, 'File over 1 MB'),
    },
  }),
  import: createRoute({
    method: 'post',
    path: '/imports/{kind}',
    request: { params: z.object({ kind: ResourceKind }), ...body(ImportInput) },
    responses: {
      201: json(z.object({ imported: z.number().int() }), 'Every line imported'),
      413: json(Problem, 'File over 1 MB'),
      422: json(ImportRefused, 'At least one line is invalid: nothing imported (rule 6)'),
    },
  }),
  listBookings: createRoute({
    method: 'get',
    path: '/resources/{resourceId}/bookings',
    request: { params: z.object({ resourceId: z.uuid() }) },
    responses: { 200: json(z.array(Booking), 'Bookings of the resource, by start') },
  }),
  createBooking: createRoute({
    method: 'post',
    path: '/bookings',
    request: body(NewBooking),
    responses: {
      201: json(Booking, 'Booking created'),
      400: json(Problem, 'Invalid request'),
      404: json(Problem, 'Unknown resource'),
      409: json(Overlap, 'The resource is already booked over part of the period'),
    },
  }),
};

/** A failed write, as a status and a body the interface can translate. */
function failure(result: Exclude<DocumentResult, { ok: true }>) {
  switch (result.reason) {
    case 'not-found':
      return { status: 404, body: { error: 'not-found' } } as const;
    case 'invalid':
      return {
        status: 400,
        body: { error: 'invalid', issues: result.issues.map((i) => ({ ...i })) },
      } as const;
    case 'plate-taken':
      return { status: 409, body: { error: 'plate-taken', owner: result.owner } } as const;
    case 'document-type-taken':
      return { status: 409, body: { error: 'document-type-taken' } } as const;
  }
}

// The CSV travels as JSON; the use case refuses a file over 1 MB with a precise message, this
// limit only keeps much larger bodies from being read at all.
const importBodyLimit = bodyLimit({
  maxSize: 1_500_000,
  onError: (c) => c.json({ error: 'import-too-large', params: { maxBytes: 1_000_000 } }, 413),
});

/**
 * The HTTP API, independent of where it runs: Node with PostgreSQL, or the demo's service
 * worker with PGlite.
 */
export function createApp(ports: Ports) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: 'invalid-request' as const, message: z.prettifyError(result.error) },
          400,
        );
      }
    },
  }).basePath('/api');

  app.use('/imports/*', importBodyLimit);

  const api = app
    .openapi(routes.summary, async (c) => {
      const { day, active, expiries } = await resourceSummary(ports);
      return c.json({ day: day.toString(), active, expiries }, 200);
    })
    .openapi(routes.list, async (c) => {
      const { kind, q, status, archived } = c.req.valid('query');
      const list = await listResources(ports, {
        kind,
        includeArchived: archived,
        ...(q ? { query: q } : {}),
        ...(status ? { status } : {}),
      });
      return c.json(
        {
          day: list.day.toString(),
          counts: list.counts,
          resources: list.resources.map(toResource),
        },
        200,
      );
    })
    .openapi(routes.get, async (c) => {
      const resource = await getResource(ports, c.req.valid('param').id);
      return resource
        ? c.json(toResource(resource), 200)
        : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.create, async (c) => {
      const result = await createResource(ports, fromInput(c.req.valid('json')));
      if (result.ok) return c.json(toResource(result.resource), 201);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.update, async (c) => {
      const result = await updateResource(
        ports,
        c.req.valid('param').id,
        fromInput(c.req.valid('json')),
      );
      if (result.ok) return c.json(toResource(result.resource), 200);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.archive, async (c) => {
      const result = await setArchived(ports, c.req.valid('param').id, true);
      if (result.ok) return c.json(toResource(result.resource), 200);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.restore, async (c) => {
      const result = await setArchived(ports, c.req.valid('param').id, false);
      if (result.ok) return c.json(toResource(result.resource), 200);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.addDocument, async (c) => {
      const document = fromDocumentInput(c.req.valid('json'));
      const result = await addDocument(ports, c.req.valid('param').id, document);
      if (result.ok) return c.json(toResource(result.resource), 201);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.updateDocument, async (c) => {
      const document = fromDocumentInput(c.req.valid('json'));
      const result = await updateDocument(ports, c.req.valid('param').id, document);
      if (result.ok) return c.json(toResource(result.resource), 200);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.removeDocument, async (c) => {
      const result = await removeDocument(ports, c.req.valid('param').id);
      if (result.ok) return c.json(toResource(result.resource), 200);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.expiries, async (c) => {
      const { kind, blocking } = c.req.valid('query');
      const list = await listExpiries(ports, { ...(kind ? { kind } : {}), blockingOnly: blocking });
      return c.json(
        {
          day: list.day.toString(),
          summary: list.summary,
          expiries: list.expiries.map(toExpiry),
        },
        200,
      );
    })
    .openapi(routes.referenceLists, async (c) => {
      const lists = await getReferenceLists(ports);
      return c.json(
        {
          documentTypes: lists.documentTypes.map((t) => ({ ...t, appliesTo: [...t.appliesTo] })),
          bodyTypes: [...lists.bodyTypes],
          tradeLabels: [...lists.tradeLabels],
          capabilities: [...lists.capabilities],
        },
        200,
      );
    })
    .openapi(routes.template, (c) => {
      const { kind } = c.req.valid('param');
      const language = c.req.valid('query').lang ?? 'en';
      c.header('Content-Disposition', `attachment; filename="timon-${kind}-${language}.csv"`);
      return c.body(importTemplate(kind, language), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
      });
    })
    .openapi(routes.checkImport, async (c) => {
      const check = await checkImport(ports, c.req.valid('param').kind, c.req.valid('json').csv);
      return c.json(toImportCheck(check), 200);
    })
    .openapi(routes.import, async (c) => {
      const result = await importResources(
        ports,
        c.req.valid('param').kind,
        c.req.valid('json').csv,
      );
      if (result.ok) return c.json({ imported: result.imported }, 201);
      return c.json({ error: 'import-invalid' as const, check: toImportCheck(result.check) }, 422);
    })
    .openapi(routes.listBookings, async (c) => {
      const bookings = await listBookings(ports, c.req.valid('param').resourceId);
      return c.json(bookings.map(toBooking), 200);
    })
    .openapi(routes.createBooking, async (c) => {
      const { resourceId, start, end, label } = c.req.valid('json');
      const result = await createBooking(ports, {
        resourceId,
        label,
        period: periodOf(start, end),
      });
      if (result.ok) return c.json(toBooking(result.booking), 201);
      if (result.reason === 'unknown-resource') {
        return c.json({ error: 'unknown-resource' as const, message: 'Unknown resource' }, 404);
      }
      return c.json(
        {
          error: 'overlap' as const,
          message: 'The resource is already booked over part of this period',
          conflicts: result.conflicts.map(toBooking),
        },
        409,
      );
    });

  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Timon API', version: '0.0.0' },
  });

  return api;
}

export type AppType = ReturnType<typeof createApp>;
