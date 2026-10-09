import type { ResourceKind, VehicleKind } from '@timon/domain';
import type { CustomerOwnerJson, IssueJson, PlateOwnerJson, ReferenceListsJson } from '@timon/http';
import { ApiError } from './api.ts';
import { weekdayName } from './customers/customer-labels.ts';
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
  protectiveEquipmentIds: m.col_protective_equipment,
  // Customers and sites
  name: m.field_contact_name,
  code: m.field_code,
  country: m.field_country,
  siret: m.field_siret,
  vatNumber: m.field_vat,
  billingStreet1: m.field_street,
  billingStreet2: m.field_street2,
  billingPostcode: m.field_postcode,
  billingCity: m.field_city,
  notes: m.section_notes,
  siteIds: m.section_usual_sites,
  street1: m.field_street,
  street2: m.field_street2,
  postcode: m.field_postcode,
  city: m.field_city,
  location: m.field_location,
  latitude: m.field_location,
  longitude: m.field_location,
  openings: m.field_openings,
  bookingMethod: m.field_booking_method,
  bookingDetail: m.field_booking_detail,
  maxLengthCm: m.field_max_length,
  maxWeightKg: m.field_max_weight,
  loadingDock: m.field_loading_dock,
  semiTrailersAccepted: m.field_semi_trailers,
  gatePhone: m.field_gate_phone,
  instructions: m.field_instructions,
};

const contactFields: Record<string, () => string> = {
  name: m.field_contact_name,
  role: m.field_contact_role,
  phone: m.field_contact_phone,
  email: m.field_contact_email,
};

/** The label of a field, or of a document type for a `document:<code>` import column. */
export function fieldLabel(field: string, lists?: ReferenceListsJson): string {
  if (field.startsWith('document:')) {
    const code = field.slice('document:'.length);
    return entryLabel(lists?.documentTypes.find((t) => t.code === code) ?? { code, name: code });
  }
  // contacts.2.email → "Contact 3, email"; openings.1 → "Monday".
  const contact = /^contacts\.(\d+)(?:\.(\w+))?$/.exec(field);
  if (contact) {
    const label = m.contact_label({ n: Number(contact[1]) + 1 });
    const part = contact[2] ? contactFields[contact[2]]?.() : undefined;
    return part ? `${label}, ${inSentence(part)}` : label;
  }
  const day = /^openings\.(\d)$/.exec(field);
  if (day) return capitalise(weekdayName(Number(day[1])));
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
    case 'code-invalid':
      return m.issue_code_invalid({ field });
    case 'siret-invalid':
      return m.issue_siret_invalid();
    case 'siret-not-french':
      return m.issue_siret_not_french();
    case 'country-unknown':
      return m.issue_country_unknown({ field });
    case 'contact-unreachable':
      return m.issue_contact_unreachable();
    case 'email-invalid':
      return m.issue_email_invalid({ field });
    case 'postcode-invalid':
      return m.issue_postcode_invalid({ field });
    case 'value-not-positive':
      return m.issue_value_not_positive({ field });
    case 'booking-method-required':
      return m.issue_booking_method_required();
    case 'location-invalid':
      return m.issue_location_invalid();
    case 'opening-invalid':
      return m.issue_opening_invalid({
        day: capitalise(weekdayName(Number(params.weekday))),
        start: text(params.start),
        end: text(params.end),
      });
    case 'opening-overlap':
      return params.weekday === undefined
        ? m.issue_openings_overlap()
        : m.issue_opening_overlap({
            day: capitalise(weekdayName(Number(params.weekday))),
            first: text(params.first),
            second: text(params.second),
          });
    case 'code-taken':
    case 'siret-taken': {
      const owner = params.owner as unknown as CustomerOwnerJson;
      return issue.code === 'code-taken'
        ? m.issue_code_taken({ code: owner.code, name: owner.name })
        : m.issue_siret_taken({ name: owner.name });
    }
    case 'code-duplicated':
      return m.issue_code_duplicated({ line: text(params.line) });
    case 'siret-duplicated':
      return m.issue_siret_duplicated({ line: text(params.line) });
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
    const customer = (error.body as { owner?: CustomerOwnerJson } | undefined)?.owner;
    if (error.code === 'code-taken' && customer) {
      return customer.archived
        ? m.code_taken_archived({ code: customer.code, name: customer.name })
        : m.code_taken({ code: customer.code, name: customer.name });
    }
    if (error.code === 'siret-taken' && customer) {
      return m.siret_taken({ name: customer.name, code: customer.code });
    }
    const [first] = body?.issues ?? [];
    if (error.code === 'invalid' && first) return issueSentence(first, lists);
  }
  return errorText(error);
}
