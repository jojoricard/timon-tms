import { z } from '@hono/zod-openapi';
import {
  documentStatuses,
  powerUnitKinds,
  resourceKinds,
  severityOrder,
  trailerKinds,
  vehicleCategories,
  vehicleKinds,
} from '@timon/domain';

const instant = z.iso.datetime({ offset: true }).openapi({ example: '2026-10-07T06:00:00Z' });
const day = z.iso.date().openapi({ example: '2026-11-20' });

export const ResourceKind = z.enum(resourceKinds).openapi('ResourceKind');
export const Severity = z.enum(severityOrder).openapi('Severity');

// Every error names a code the interface translates; `params` fills the message.
const Params = z.record(z.string(), z.union([z.string(), z.number()]));

export const PlateOwner = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: ResourceKind,
    vehicleKind: z.enum(vehicleKinds).nullable(),
  })
  .openapi('PlateOwner');

export const Issue = z
  .object({
    field: z.string(),
    code: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), PlateOwner])).optional(),
  })
  .openapi('Issue');

export const Problem = z
  .object({
    error: z.enum([
      'invalid-request',
      'not-found',
      'unknown-resource',
      'overlap',
      'invalid',
      'plate-taken',
      'document-type-taken',
      'import-too-large',
    ]),
    message: z.string().optional(),
    params: Params.optional(),
  })
  .openapi('Problem');

export const Invalid = z
  .object({ error: z.literal('invalid'), issues: z.array(Issue) })
  .openapi('Invalid');

export const PlateTaken = z
  .object({ error: z.literal('plate-taken'), owner: PlateOwner })
  .openapi('PlateTaken');

// Reference lists. `code` is translated by the interface; `name` is shown as typed.
export const ListItem = z
  .object({ id: z.uuid(), code: z.string().nullable(), name: z.string().nullable() })
  .openapi('ListItem');

export const DocumentType = ListItem.extend({
  appliesTo: z.array(ResourceKind),
  blocking: z.boolean(),
  warnDays: z.number().int(),
}).openapi('DocumentType');

export const ReferenceLists = z
  .object({
    documentTypes: z.array(DocumentType),
    bodyTypes: z.array(ListItem),
    tradeLabels: z.array(ListItem),
    capabilities: z.array(ListItem),
  })
  .openapi('ReferenceLists');

export const Document = z
  .object({
    id: z.uuid(),
    resourceId: z.uuid(),
    documentTypeId: z.uuid(),
    reference: z.string().nullable(),
    issuedOn: day.nullable(),
    expiresOn: day,
    status: z.enum(documentStatuses),
    blocking: z.boolean(),
    severity: Severity,
    daysUntil: z.number().int(),
    warnDays: z.number().int(),
  })
  .openapi('Document');

/** Every kind in one shape; the fields of the other kinds are null. */
export const Resource = z
  .object({
    id: z.uuid(),
    kind: ResourceKind,
    name: z.string(),
    archived: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
    lastName: z.string().nullable(),
    firstName: z.string().nullable(),
    displayName: z.string().nullable(),
    employeeNumber: z.string().nullable(),
    phone: z.string().nullable(),
    plate: z.string().nullable(),
    vehicleKind: z.enum(vehicleKinds).nullable(),
    category: z.enum(vehicleCategories).nullable(),
    gvwKg: z.number().int().nullable(),
    gcwKg: z.number().int().nullable(),
    makeModel: z.string().nullable(),
    bodyTypeId: z.uuid().nullable(),
    tradeLabelId: z.uuid().nullable(),
    capabilityIds: z.array(z.uuid()),
    documents: z.array(Document),
    severity: Severity,
    nextExpiry: Document.nullable(),
  })
  .openapi('Resource');

export const ResourceList = z
  .object({
    day,
    counts: z.object({ all: z.number(), expiring: z.number(), expired: z.number() }),
    resources: z.array(Resource),
  })
  .openapi('ResourceList');

export const ResourceSummary = z
  .object({
    day,
    active: z.object({ driver: z.number(), 'power-unit': z.number(), trailer: z.number() }),
    expiries: z.number(),
  })
  .openapi('ResourceSummary');

const optionalText = z.string().max(200).nullable().optional();
const weight = z.number().int();

export const DriverInput = z.object({
  kind: z.literal('driver'),
  lastName: z.string().max(200),
  firstName: z.string().max(200),
  displayName: optionalText,
  employeeNumber: optionalText,
  phone: optionalText,
});

const vehicleInput = {
  plate: z.string().max(20),
  category: z.enum(vehicleCategories),
  gvwKg: weight,
  gcwKg: weight.nullable().optional(),
  makeModel: optionalText,
  bodyTypeId: z.uuid().nullable().optional(),
  tradeLabelId: z.uuid().nullable().optional(),
  capabilityIds: z.array(z.uuid()).max(20).optional(),
};

export const ResourceInput = z
  .discriminatedUnion('kind', [
    DriverInput,
    z.object({
      kind: z.literal('power-unit'),
      vehicleKind: z.enum(powerUnitKinds),
      ...vehicleInput,
    }),
    z.object({ kind: z.literal('trailer'), vehicleKind: z.enum(trailerKinds), ...vehicleInput }),
  ])
  .openapi('ResourceInput');

export const DocumentInput = z
  .object({
    documentTypeId: z.uuid(),
    reference: optionalText,
    issuedOn: day.nullable().optional(),
    expiresOn: day,
  })
  .openapi('DocumentInput');

export const Expiry = Document.extend({ resource: PlateOwner }).openapi('Expiry');

export const ExpiryList = z
  .object({
    day,
    summary: z.object({
      expiredBlocking: z.number(),
      expiredNotBlocking: z.number(),
      withinThirtyDays: z.number(),
      longerLeadTime: z.number(),
    }),
    expiries: z.array(Expiry),
  })
  .openapi('ExpiryList');

export const ImportInput = z.object({ csv: z.string() }).openapi('ImportInput');

export const ImportCheck = z
  .object({
    kind: ResourceKind,
    problem: z
      .object({ code: z.string(), params: z.record(z.string(), z.unknown()).optional() })
      .nullable(),
    rows: z.array(
      z.object({
        line: z.number().int(),
        cells: z.record(z.string(), z.string()),
        issues: z.array(Issue),
        documents: z.number().int(),
      }),
    ),
    summary: z.object({
      lines: z.number(),
      valid: z.number(),
      invalid: z.number(),
      alreadyInTimon: z.number(),
      documents: z.number(),
    }),
    ready: z.boolean(),
  })
  .openapi('ImportCheck');

export const ImportRefused = z
  .object({ error: z.literal('import-invalid'), check: ImportCheck })
  .openapi('ImportRefused');

export const Booking = z
  .object({
    id: z.uuid(),
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    label: z.string(),
  })
  .openapi('Booking');

export const NewBooking = z
  .object({
    resourceId: z.uuid(),
    start: instant,
    end: instant,
    label: z.string().trim().min(1).max(200),
  })
  .refine((b) => Date.parse(b.end) > Date.parse(b.start), {
    message: 'end must be after start',
    path: ['end'],
  })
  .openapi('NewBooking');

export const Overlap = Problem.extend({ conflicts: z.array(Booking) }).openapi('Overlap');
