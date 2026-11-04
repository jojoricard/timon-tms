import { z } from '@hono/zod-openapi';
import { documentStatuses, licenceCategories, unitRoles, vehicleKinds } from '@timon/domain';
import { Issue, instant, Problem, UnitRef } from './schemas.ts';

const day = z.iso.date().openapi({ example: '2026-10-27' });
const LicenceCategory = z.enum(licenceCategories).openapi('LicenceCategory');
const UnitRole = z.enum(unitRoles).openapi('UnitRole');

export const Member = z
  .object({
    id: z.uuid(),
    kind: UnitRole,
    name: z.string(),
    fullName: z.string(),
    archived: z.boolean(),
    vehicleKind: z.enum(vehicleKinds).nullable(),
    makeModel: z.string().nullable(),
    category: z.string().nullable(),
    gvwKg: z.number().int().nullable(),
    gcwKg: z.number().int().nullable(),
    bodyTypeId: z.uuid().nullable(),
    licences: z.array(LicenceCategory),
  })
  .openapi('UnitMember');

const MemberStatus = z.enum(['missing', ...documentStatuses]).openapi('MemberDocumentStatus');

export const UnitDocument = z
  .object({
    resourceId: z.uuid(),
    member: z.string(),
    code: z.string(),
    documentTypeId: z.uuid().nullable(),
    expiresOn: day.nullable(),
    status: MemberStatus,
  })
  .openapi('UnitDocument');

export const UnitDocuments = z
  .object({
    day,
    status: MemberStatus,
    worst: UnitDocument.nullable(),
    nextExpiry: UnitDocument.nullable(),
    documents: z.array(UnitDocument),
  })
  .openapi('UnitDocuments');

const RequiredLicence = z.union([LicenceCategory, z.literal('unsupported')]);

export const Unit = UnitRef.extend({
  customName: z.string().nullable(),
  state: z.enum(['future', 'running', 'ended']),
  powerUnit: Member,
  trailer: Member.nullable(),
  driver: Member.nullable(),
  licence: RequiredLicence,
  previousUnitId: z.uuid().nullable(),
  changed: UnitRole.nullable(),
  documents: UnitDocuments,
}).openapi('Unit');

export const UnitsAt = z
  .object({
    at: instant,
    units: z.array(Unit),
    free: z.object({
      'power-unit': z.array(Member),
      trailer: z.array(Member),
      driver: z.array(Member),
    }),
  })
  .openapi('UnitsAt');

const Candidate = z.object({ resource: Member, reason: Issue.nullable() }).openapi('Candidate');

export const UnitOptions = z
  .object({
    candidates: z.object({
      'power-unit': z.array(Candidate),
      trailer: z.array(Candidate),
      driver: z.array(Candidate),
    }),
    licence: RequiredLicence.nullable(),
    documents: UnitDocuments.nullable(),
  })
  .openapi('UnitOptions');

const optionalId = z.uuid().nullable().optional();

export const UnitInput = z
  .object({
    name: z.string().max(100).nullable().optional(),
    powerUnitId: optionalId,
    trailerId: optionalId,
    driverId: optionalId,
    start: instant,
    end: instant.nullable().optional(),
  })
  .openapi('UnitInput');

export const OptionsQuery = z.object({
  start: instant,
  end: instant.optional(),
  powerUnitId: z.uuid().optional(),
  trailerId: z.uuid().optional(),
  driverId: z.uuid().optional(),
  exceptUnitId: z.uuid().optional(),
});

export const EndInput = z.object({ end: instant }).openapi('EndInput');

export const ChangeInput = z
  .object({
    role: z.enum(['driver', 'trailer']),
    resourceId: z.uuid().nullable(),
    from: instant,
  })
  .openapi('ChangeInput');

export const Changed = z.object({ ended: Unit, unit: Unit }).openapi('UnitChanged');

export const UnitOverlap = z
  .object({
    error: z.literal('unit-overlap'),
    conflicts: z.array(
      z.object({
        unit: UnitRef,
        resource: z.object({ id: z.uuid(), kind: UnitRole, name: z.string() }),
      }),
    ),
  })
  .openapi('UnitOverlap');

export { Problem };
