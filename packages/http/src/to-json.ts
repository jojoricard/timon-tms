import type { z } from '@hono/zod-openapi';
import type {
  DocumentView,
  Expiry as ExpiryView,
  ImportCheck as ImportCheckView,
  NewDocument,
  ResourceView,
} from '@timon/app';
import { type ResourceDetails, resourceName, Temporal } from '@timon/domain';
import type {
  Document,
  DocumentInput,
  Expiry,
  ImportCheck,
  Resource,
  ResourceInput,
} from './schemas.ts';

export function toDocument(d: DocumentView): z.infer<typeof Document> {
  return {
    id: d.id,
    resourceId: d.resourceId,
    documentTypeId: d.documentTypeId,
    reference: d.reference,
    issuedOn: d.issuedOn?.toString() ?? null,
    expiresOn: d.expiresOn.toString(),
    status: d.status,
    blocking: d.blocking,
    severity: d.severity,
    daysUntil: d.daysUntil,
    warnDays: d.type.warnDays,
  };
}

export function toResource(r: ResourceView): z.infer<typeof Resource> {
  const driver = r.kind === 'driver' ? r : null;
  const vehicle = r.kind === 'driver' ? null : r;
  return {
    id: r.id,
    kind: r.kind,
    name: resourceName(r),
    archived: r.archived,
    createdAt: r.createdAt.toString(),
    updatedAt: r.updatedAt.toString(),
    lastName: driver?.lastName ?? null,
    firstName: driver?.firstName ?? null,
    displayName: driver?.displayName ?? null,
    employeeNumber: driver?.employeeNumber ?? null,
    phone: driver?.phone ?? null,
    plate: vehicle?.plate ?? null,
    vehicleKind: vehicle?.vehicleKind ?? null,
    category: vehicle?.category ?? null,
    gvwKg: vehicle?.gvwKg ?? null,
    gcwKg: vehicle?.gcwKg ?? null,
    makeModel: vehicle?.makeModel ?? null,
    bodyTypeId: vehicle?.bodyTypeId ?? null,
    tradeLabelId: vehicle?.tradeLabelId ?? null,
    capabilityIds: [...(vehicle?.capabilityIds ?? [])],
    protectiveEquipmentIds: [...(driver?.protectiveEquipmentIds ?? [])],
    documents: r.documents.map(toDocument),
    severity: r.severity,
    nextExpiry: r.nextExpiry ? toDocument(r.nextExpiry) : null,
  };
}

export function toExpiry(e: ExpiryView): z.infer<typeof Expiry> {
  return { ...toDocument(e), resource: e.resource };
}

export function toImportCheck(check: ImportCheckView): z.infer<typeof ImportCheck> {
  return {
    ...check,
    rows: check.rows.map((row) => ({ ...row, issues: [...row.issues], cells: { ...row.cells } })),
  } as z.infer<typeof ImportCheck>;
}

/** The request body as the domain's record; optional fields become null. */
export function fromInput(input: z.infer<typeof ResourceInput>): ResourceDetails {
  if (input.kind === 'driver') {
    return {
      kind: 'driver',
      lastName: input.lastName,
      firstName: input.firstName,
      displayName: input.displayName ?? '',
      employeeNumber: input.employeeNumber ?? null,
      phone: input.phone ?? null,
      protectiveEquipmentIds: input.protectiveEquipmentIds ?? [],
    };
  }
  return {
    kind: input.kind,
    plate: input.plate,
    vehicleKind: input.vehicleKind,
    category: input.category,
    gvwKg: input.gvwKg,
    gcwKg: input.gcwKg ?? null,
    makeModel: input.makeModel ?? null,
    bodyTypeId: input.bodyTypeId ?? null,
    tradeLabelId: input.tradeLabelId ?? null,
    capabilityIds: input.capabilityIds ?? [],
  };
}

export function fromDocumentInput(input: z.infer<typeof DocumentInput>): NewDocument {
  return {
    documentTypeId: input.documentTypeId,
    reference: input.reference ?? null,
    issuedOn: input.issuedOn ? Temporal.PlainDate.from(input.issuedOn) : null,
    expiresOn: Temporal.PlainDate.from(input.expiresOn),
  };
}
