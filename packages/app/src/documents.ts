import { Temporal } from '@timon/domain';
import { DocumentTypeTakenError, type NewDocument, type Ports } from './ports.ts';
import { type FieldIssue, getResource, type ResourceResult } from './resources.ts';

export type DocumentResult =
  | ResourceResult
  | { readonly ok: false; readonly reason: 'document-type-taken' };

async function checkDocument(
  ports: Ports,
  resourceId: string,
  input: NewDocument,
): Promise<FieldIssue[] | 'not-found'> {
  const [resource, lists] = await Promise.all([
    ports.resources.get(resourceId),
    ports.referenceLists.get(),
  ]);
  if (!resource) return 'not-found';
  const type = lists.documentTypes.find((t) => t.id === input.documentTypeId);
  const issues: FieldIssue[] = [];
  if (!type?.appliesTo.includes(resource.kind)) {
    issues.push({ field: 'documentTypeId', code: 'unknown-value' });
  }
  if (input.issuedOn && Temporal.PlainDate.compare(input.issuedOn, input.expiresOn) > 0) {
    issues.push({ field: 'issuedOn', code: 'issued-after-expiry' });
  }
  return issues;
}

/** Runs a document write, then answers with the resource and its new statuses. */
async function write(
  ports: Ports,
  resourceId: string,
  input: NewDocument,
  run: (document: NewDocument) => Promise<unknown>,
): Promise<DocumentResult> {
  const document = { ...input, reference: input.reference?.trim() || null };
  const issues = await checkDocument(ports, resourceId, document);
  if (issues === 'not-found') return { ok: false, reason: 'not-found' };
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  try {
    if ((await run(document)) === undefined) return { ok: false, reason: 'not-found' };
  } catch (error) {
    if (error instanceof DocumentTypeTakenError)
      return { ok: false, reason: 'document-type-taken' };
    throw error;
  }
  const resource = await getResource(ports, resourceId);
  return resource ? { ok: true, resource } : { ok: false, reason: 'not-found' };
}

/** One document per type and resource: a second one of the same type is refused. */
export function addDocument(ports: Ports, resourceId: string, input: NewDocument) {
  return write(ports, resourceId, input, (d) => ports.documents.add(resourceId, d));
}

/** A renewal: new dates, same document. */
export async function updateDocument(
  ports: Ports,
  documentId: string,
  input: NewDocument,
): Promise<DocumentResult> {
  const existing = await ports.documents.get(documentId);
  if (!existing) return { ok: false, reason: 'not-found' };
  return write(ports, existing.resourceId, input, (d) => ports.documents.update(documentId, d));
}

/** Removing a document corrects an entry; resources themselves are only archived. */
export async function removeDocument(ports: Ports, documentId: string): Promise<DocumentResult> {
  const existing = await ports.documents.get(documentId);
  if (!existing) return { ok: false, reason: 'not-found' };
  await ports.documents.remove(documentId);
  const resource = await getResource(ports, existing.resourceId);
  return resource ? { ok: true, resource } : { ok: false, reason: 'not-found' };
}
