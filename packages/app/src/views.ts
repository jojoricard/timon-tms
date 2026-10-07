import {
  companyDay,
  type DocumentStatus,
  daysUntil,
  documentStatus,
  resourceSeverity,
  type Severity,
  severity,
  Temporal,
} from '@timon/domain';
import type { DocumentType, ReferenceLists, StoredDocument, StoredResource } from './ports.ts';

export type DocumentView = StoredDocument & {
  readonly type: DocumentType;
  readonly status: DocumentStatus;
  readonly blocking: boolean;
  readonly severity: Severity;
  readonly daysUntil: number;
};

/** Omit that keeps a discriminated union a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ResourceView = DistributiveOmit<StoredResource, 'documents'> & {
  readonly documents: readonly DocumentView[];
  readonly severity: Severity;
  /** The document with the earliest expiry date, expired or not. */
  readonly nextExpiry: DocumentView | null;
};

/** Statuses are computed for a calendar day in the company's time zone (rule 4). */
export function statusDay(now: Temporal.Instant): Temporal.PlainDate {
  return companyDay(now);
}

export function documentView(
  document: StoredDocument,
  types: ReferenceLists['documentTypes'],
  day: Temporal.PlainDate,
): DocumentView {
  const type = types.find((t) => t.id === document.documentTypeId);
  if (!type) throw new Error(`Unknown document type ${document.documentTypeId}`);
  const status = documentStatus(document.expiresOn, type.warnDays, day);
  return {
    ...document,
    type,
    status,
    blocking: type.blocking,
    severity: severity({ status, blocking: type.blocking }),
    daysUntil: daysUntil(document.expiresOn, day),
  };
}

const byExpiry = (a: DocumentView, b: DocumentView) =>
  Temporal.PlainDate.compare(a.expiresOn, b.expiresOn);

export function resourceView(
  resource: StoredResource,
  types: ReferenceLists['documentTypes'],
  day: Temporal.PlainDate,
): ResourceView {
  const documents = resource.documents
    .map((d) => documentView(d, types, day))
    .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
  const [nextExpiry = null] = [...documents].sort(byExpiry);
  return {
    ...resource,
    documents,
    severity: resourceSeverity(documents),
    nextExpiry,
  };
}

/** Expired documents first, then by expiry date. */
export function compareExpiries(a: DocumentView, b: DocumentView): number {
  const expired = Number(b.status === 'expired') - Number(a.status === 'expired');
  return expired || byExpiry(a, b);
}
