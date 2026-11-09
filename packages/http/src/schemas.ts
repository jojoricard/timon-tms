import { z } from '@hono/zod-openapi';
import {
  documentStatuses,
  powerUnitKinds,
  resourceKinds,
  severityOrder,
  textLimits,
  trailerKinds,
  vehicleCategories,
  vehicleKinds,
} from '@timon/domain';

export const instant = z.iso
  .datetime({ offset: true })
  .openapi({ example: '2026-10-07T06:00:00Z' });
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

/** The driver, archived or not, that already has an employee number (SPEC-001 rule 9). */
export const EmployeeNumberOwner = z
  .object({ id: z.uuid(), name: z.string(), archived: z.boolean() })
  .openapi('EmployeeNumberOwner');

export const Issue = z
  .object({
    field: z.string(),
    code: z.string(),
    params: z
      .record(z.string(), z.union([z.string(), z.number(), PlateOwner, EmployeeNumberOwner]))
      .optional(),
  })
  .openapi('Issue');

export const Problem = z
  .object({
    error: z.enum([
      'invalid-request',
      'not-found',
      'archived',
      'unknown-resource',
      'overlap',
      'invalid',
      'plate-taken',
      'employee-number-taken',
      'document-type-taken',
      'import-too-large',
      'in-unit',
      'unit-overlap',
      'started',
      'not-started',
      'ended',
      'cancelled',
    ]),
    message: z.string().optional(),
    params: Params.optional(),
  })
  .openapi('Problem');

export const OrderRef = z.object({ id: z.uuid(), number: z.string() }).openapi('OrderRef');

/** SPEC-004 rule 8: the orders to plan or to review that keep a customer or a site active. */
export const InUse = z
  .object({ error: z.literal('in-use'), orders: z.array(OrderRef) })
  .openapi('InUse');

export const Invalid = z
  .object({ error: z.literal('invalid'), issues: z.array(Issue) })
  .openapi('Invalid');

export const PlateTaken = z
  .object({ error: z.literal('plate-taken'), owner: PlateOwner })
  .openapi('PlateTaken');

export const EmployeeNumberTaken = z
  .object({ error: z.literal('employee-number-taken'), owner: EmployeeNumberOwner })
  .openapi('EmployeeNumberTaken');

/** A unit named in a message: SPEC-003 rules 4 and 7. */
export const UnitRef = z
  .object({ id: z.uuid(), name: z.string(), start: instant, end: instant.nullable() })
  .openapi('UnitRef');

export const InUnit = z.object({ error: z.literal('in-unit'), unit: UnitRef }).openapi('InUnit');

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
    protectiveEquipment: z.array(ListItem),
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
    /** ADR-005: its own, apart from the resource's. */
    version: z.number().int(),
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
    version: z.number().int(),
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
    protectiveEquipmentIds: z.array(z.uuid()),
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
    units: z.number(),
    expiries: z.number(),
  })
  .openapi('ResourceSummary');

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const weight = z.number().int();
const limit = textLimits.resource;

export const DriverInput = z.object({
  kind: z.literal('driver'),
  lastName: z.string().max(limit.lastName),
  firstName: z.string().max(limit.firstName),
  displayName: optionalText(limit.displayName),
  employeeNumber: optionalText(limit.employeeNumber),
  phone: optionalText(limit.phone),
  protectiveEquipmentIds: z.array(z.uuid()).max(20).optional(),
});

const vehicleInput = {
  plate: z.string().max(limit.plate),
  category: z.enum(vehicleCategories),
  gvwKg: weight,
  gcwKg: weight.nullable().optional(),
  makeModel: optionalText(limit.makeModel),
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
    reference: optionalText(textLimits.document.reference),
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

/** SPEC-001, Import: each column of a file, and the values it accepts. */
export const ImportGuide = z
  .array(
    z.object({
      field: z.string(),
      header: z.string(),
      required: z.boolean(),
      accepts: z.object({
        kind: z.enum([
          'text',
          'date',
          'weight',
          'number',
          'metres',
          'yes-no',
          'country',
          'hours',
          'one-of',
          'list-of',
        ]),
        /** Each accepted value, as the ways it may be written. */
        values: z.array(z.array(z.string())).optional(),
      }),
    }),
  )
  .openapi('ImportGuide');

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
