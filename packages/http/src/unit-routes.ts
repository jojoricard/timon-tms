import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  type ChangeResult,
  changeUnit,
  createUnit,
  deleteUnit,
  endUnit,
  getUnit,
  type MemberView,
  type Ports,
  type Stale,
  type UnitConflict,
  type UnitDocuments as UnitDocumentsView,
  type UnitDocument as UnitDocumentView,
  type UnitRef as UnitRefView,
  type UnitResult,
  type UnitView,
  unitOptions,
  unitsAt,
  unitsOfResource,
  updateUnit,
} from '@timon/app';
import { Temporal } from '@timon/domain';
import { Invalid, Problem, type UnitRef } from './schemas.ts';
import {
  Changed,
  ChangeInput,
  EndInput,
  type Member,
  OptionsQuery,
  Unit,
  type UnitDocument,
  type UnitDocuments,
  UnitInput,
  UnitOptions,
  UnitOverlap,
  UnitsAt,
} from './unit-schemas.ts';
import { validationHook } from './validation.ts';
import { guardedAnswers, ifMatch, staleBody, versionOf } from './versions.ts';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { ...json(schema, 'Request body'), required: true },
});
const id = z.object({ id: z.uuid() });

export function toUnitRef(ref: UnitRefView): z.infer<typeof UnitRef> {
  return {
    id: ref.id,
    name: ref.name,
    start: ref.start.toString(),
    end: ref.end?.toString() ?? null,
  };
}

const toMember = (m: MemberView): z.infer<typeof Member> => ({ ...m, licences: [...m.licences] });

const toDocument = (d: UnitDocumentView): z.infer<typeof UnitDocument> => ({
  ...d,
  expiresOn: d.expiresOn?.toString() ?? null,
});

const toDocuments = (d: UnitDocumentsView): z.infer<typeof UnitDocuments> => ({
  day: d.day.toString(),
  status: d.status,
  worst: d.worst ? toDocument(d.worst) : null,
  nextExpiry: d.nextExpiry ? toDocument(d.nextExpiry) : null,
  documents: d.documents.map(toDocument),
});

export function toUnit(u: UnitView): z.infer<typeof Unit> {
  return {
    ...toUnitRef(u),
    customName: u.customName,
    version: u.version,
    state: u.state,
    powerUnit: toMember(u.powerUnit),
    trailer: u.trailer ? toMember(u.trailer) : null,
    driver: u.driver ? toMember(u.driver) : null,
    licence: u.licence,
    previousUnitId: u.previousUnitId,
    changed: u.changed,
    documents: toDocuments(u.documents),
  };
}

const toConflict = (c: UnitConflict) => ({ unit: toUnitRef(c.unit), resource: { ...c.resource } });

/** A refused write on a unit, as a status and a body the interface can translate. */
function failure(result: Exclude<UnitResult | ChangeResult, { ok: true } | Stale>) {
  switch (result.reason) {
    case 'not-found':
      return { status: 404, body: { error: 'not-found' } } as const;
    case 'invalid':
      return {
        status: 400,
        body: { error: 'invalid', issues: result.issues.map((i) => ({ ...i })) },
      } as const;
    case 'overlap':
      return {
        status: 409,
        body: { error: 'unit-overlap', conflicts: result.conflicts.map(toConflict) },
      } as const;
    case 'started':
    case 'not-started':
    case 'ended':
      return { status: 409, body: { error: result.reason } } as const;
  }
}

const instantOf = (iso: string) => Temporal.Instant.from(iso);

const writeAnswers = {
  200: json(Unit, 'The unit'),
  400: json(z.union([Invalid, Problem]), 'A rule is broken; each issue names its field'),
  404: json(Problem, 'No such unit'),
  409: json(
    z.union([UnitOverlap, Problem]),
    'A resource is in another unit over part of the period (rule 4), or the unit has started',
  ),
};

const routes = {
  at: createRoute({
    method: 'get',
    path: '/units',
    request: { query: z.object({ at: UnitInput.shape.start.optional() }) },
    responses: {
      200: json(UnitsAt, 'Units valid at the instant, now by default, and free resources'),
    },
  }),
  options: createRoute({
    method: 'get',
    path: '/units/options',
    request: { query: OptionsQuery },
    responses: {
      200: json(UnitOptions, 'Every active resource, with why it cannot be chosen over the period'),
    },
  }),
  get: createRoute({
    method: 'get',
    path: '/units/{id}',
    request: { params: id },
    responses: { 200: json(Unit, 'The unit'), 404: json(Problem, 'No such unit') },
  }),
  create: createRoute({
    method: 'post',
    path: '/units',
    request: body(UnitInput),
    responses: { ...writeAnswers, 201: json(Unit, 'Unit created') },
  }),
  update: createRoute({
    method: 'put',
    path: '/units/{id}',
    request: { params: id, headers: ifMatch, ...body(UnitInput) },
    responses: { ...writeAnswers, ...guardedAnswers },
  }),
  remove: createRoute({
    method: 'delete',
    path: '/units/{id}',
    request: { params: id, headers: ifMatch },
    responses: {
      204: { description: 'Unit deleted' },
      404: json(Problem, 'No such unit'),
      409: json(Problem, 'The unit has started: it can only be given an end'),
      ...guardedAnswers,
    },
  }),
  end: createRoute({
    method: 'post',
    path: '/units/{id}/end',
    request: { params: id, headers: ifMatch, ...body(EndInput) },
    responses: { ...writeAnswers, ...guardedAnswers },
  }),
  change: createRoute({
    method: 'post',
    path: '/units/{id}/change',
    request: { params: id, headers: ifMatch, ...body(ChangeInput) },
    responses: {
      ...writeAnswers,
      ...guardedAnswers,
      200: json(Changed, 'The unit ended at that minute, and the one that starts then'),
    },
  }),
  ofResource: createRoute({
    method: 'get',
    path: '/resources/{id}/units',
    request: { params: id },
    responses: { 200: json(z.array(Unit), 'Units of the resource, latest first') },
  }),
};

const fromInput = (input: z.infer<typeof UnitInput>) => ({
  name: input.name ?? null,
  powerUnitId: input.powerUnitId ?? null,
  trailerId: input.trailerId ?? null,
  driverId: input.driverId ?? null,
  start: instantOf(input.start),
  end: input.end ? instantOf(input.end) : null,
});

/** SPEC-003: units over a period, one unit per resource at a time. */
export function unitApi(ports: Ports) {
  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(routes.at, async (c) => {
      const { at } = c.req.valid('query');
      const result = await unitsAt(ports, at ? instantOf(at) : undefined);
      return c.json(
        {
          at: result.at.toString(),
          units: result.units.map(toUnit),
          free: {
            'power-unit': result.free['power-unit'].map(toMember),
            trailer: result.free.trailer.map(toMember),
            driver: result.free.driver.map(toMember),
          },
        },
        200,
      );
    })
    .openapi(routes.options, async (c) => {
      const q = c.req.valid('query');
      const options = await unitOptions(ports, {
        start: instantOf(q.start),
        end: q.end ? instantOf(q.end) : null,
        powerUnitId: q.powerUnitId ?? null,
        trailerId: q.trailerId ?? null,
        driverId: q.driverId ?? null,
        ...(q.exceptUnitId ? { exceptUnitId: q.exceptUnitId } : {}),
      });
      const list = (role: keyof typeof options.candidates) =>
        options.candidates[role].map((candidate) => ({
          resource: toMember(candidate.resource),
          reason: candidate.reason
            ? {
                field: candidate.reason.field,
                code: candidate.reason.code,
                ...(candidate.reason.params ? { params: { ...candidate.reason.params } } : {}),
              }
            : null,
        }));
      return c.json(
        {
          candidates: {
            'power-unit': list('power-unit'),
            trailer: list('trailer'),
            driver: list('driver'),
          },
          licence: options.licence,
          documents: options.documents ? toDocuments(options.documents) : null,
        },
        200,
      );
    })
    .openapi(routes.get, async (c) => {
      const unit = await getUnit(ports, c.req.valid('param').id);
      return unit ? c.json(toUnit(unit), 200) : c.json({ error: 'not-found' as const }, 404);
    })
    .openapi(routes.create, async (c) => {
      const result = await createUnit(ports, fromInput(c.req.valid('json')));
      if (result.ok) return c.json(toUnit(result.unit), 201);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.update, async (c) => {
      const result = await updateUnit(
        ports,
        c.req.valid('param').id,
        versionOf(c.req.valid('header')),
        fromInput(c.req.valid('json')),
      );
      if (result.ok) return c.json(toUnit(result.unit), 200);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.remove, async (c) => {
      const version = versionOf(c.req.valid('header'));
      const result = await deleteUnit(ports, c.req.valid('param').id, version);
      if (result.ok) return c.body(null, 204);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.end, async (c) => {
      const result = await endUnit(
        ports,
        c.req.valid('param').id,
        versionOf(c.req.valid('header')),
        instantOf(c.req.valid('json').end),
      );
      if (result.ok) return c.json(toUnit(result.unit), 200);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.change, async (c) => {
      const { role, resourceId, from } = c.req.valid('json');
      const version = versionOf(c.req.valid('header'));
      const result = await changeUnit(ports, c.req.valid('param').id, version, {
        role,
        resourceId,
        from: instantOf(from),
      });
      if (result.ok) return c.json({ ended: toUnit(result.ended), unit: toUnit(result.unit) }, 200);
      if (result.reason === 'stale') return c.json(staleBody(result.version), 412);
      const { status, body } = failure(result);
      return c.json(body, status);
    })
    .openapi(routes.ofResource, async (c) => {
      const units = await unitsOfResource(ports, c.req.valid('param').id);
      return c.json(units.map(toUnit), 200);
    });
}
