import type { ResourceKind, VehicleKind } from '@timon/domain';
import type { IssueJson, PlateOwnerJson, ReferenceListsJson } from '@timon/http';
import { ApiError } from './api.ts';
import { errorText } from './data.ts';
import {
  capitalise,
  entryLabel,
  inSentence,
  joinOr,
  kindLabel,
  vehicleKindLabel,
} from './labels.ts';
import { m } from './paraglide/messages.js';

const fieldLabels: Record<string, () => string> = {
  lastName: m.field_last_name,
  firstName: m.field_first_name,
  displayName: m.field_display_name,
  employeeNumber: m.field_employee_number,
  phone: m.field_phone,
  plate: m.field_plate,
  vehicleKind: m.field_vehicle_kind,
  category: m.field_category,
  gvwKg: m.field_gvw,
  gcwKg: m.field_gcw,
  makeModel: m.field_make_model,
  bodyTypeId: m.field_body_type,
  tradeLabelId: m.field_trade_label,
  capabilityIds: m.field_capabilities,
  documentTypeId: m.field_document_type,
  reference: m.field_reference,
  issuedOn: m.field_issued,
  expiresOn: m.field_expires,
};

/** The label of a field, or of a document type for a `document:<code>` import column. */
export function fieldLabel(field: string, lists?: ReferenceListsJson): string {
  if (field.startsWith('document:')) {
    const code = field.slice('document:'.length);
    return entryLabel(lists?.documentTypes.find((t) => t.code === code) ?? { code, name: code });
  }
  return fieldLabels[field]?.() ?? field;
}

/** "an active tractor", "un tracteur en service": the kind of the resource holding a plate. */
export function ownerKind(owner: Pick<PlateOwnerJson, 'kind' | 'vehicleKind'>): string {
  const label = owner.vehicleKind
    ? vehicleKindLabel[owner.vehicleKind as VehicleKind]()
    : kindLabel[owner.kind as ResourceKind]();
  return inSentence(label);
}

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** One issue as a sentence fragment, starting lower case: "last name is required". */
export function issueText(issue: IssueJson, lists?: ReferenceListsJson): string {
  const field = inSentence(fieldLabel(issue.field, lists));
  const params = issue.params ?? {};
  switch (issue.code) {
    case 'required':
      return m.issue_required({ field });
    case 'category-not-allowed':
      return m.issue_category_not_allowed({
        kind: inSentence(
          vehicleKindLabel[text(params.kind) as VehicleKind]?.() ?? text(params.kind),
        ),
        allowed: joinOr(text(params.allowed).split(', ')),
        category: text(params.category),
      });
    case 'weight-not-positive':
      return m.issue_weight_not_positive({ field });
    case 'combination-not-above-vehicle':
      return m.issue_combination_not_above_vehicle();
    case 'combination-not-allowed':
      return m.issue_combination_not_allowed();
    case 'body-type-not-allowed':
      return m.issue_body_type_not_allowed();
    case 'kind-not-allowed':
      return m.issue_kind_not_allowed({ field });
    case 'unknown-value':
      return params.value === undefined
        ? m.issue_unknown_entry({ field })
        : m.issue_unknown_value({ field, value: text(params.value) });
    case 'invalid-date':
      return m.issue_invalid_date({ field, value: text(params.value) });
    case 'invalid-number':
      return m.issue_invalid_number({ field, value: text(params.value) });
    case 'issued-after-expiry':
      return m.issue_issued_after_expiry();
    case 'plate-taken': {
      const owner = params.owner as PlateOwnerJson;
      return m.issue_plate_taken({ name: owner.name, kind: ownerKind(owner) });
    }
    case 'plate-duplicated':
      return m.issue_plate_duplicated({ line: text(params.line) });
    default:
      return `${field}: ${issue.code}`;
  }
}

/** The same issue as a sentence on its own, for a form field. */
export function issueSentence(issue: IssueJson, lists?: ReferenceListsJson): string {
  return capitalise(issueText(issue, lists));
}

/** Why a write was refused, in one sentence; the issues of a form are shown by field instead. */
export function failureText(error: unknown, lists?: ReferenceListsJson): string {
  if (error instanceof ApiError) {
    const body = error.body as { owner?: PlateOwnerJson; issues?: IssueJson[] } | undefined;
    if (error.code === 'plate-taken' && body?.owner) {
      return m.plate_taken({ name: body.owner.name, kind: ownerKind(body.owner) });
    }
    if (error.code === 'document-type-taken') return m.document_type_taken();
    const [first] = body?.issues ?? [];
    if (error.code === 'invalid' && first) return issueSentence(first, lists);
  }
  return errorText(error);
}
