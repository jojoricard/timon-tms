import type { ResourceKind, VehicleKind } from '@timon/domain';
import type {
  CustomerOwnerJson,
  EmployeeNumberOwnerJson,
  IssueJson,
  PlateOwnerJson,
  ReferenceListsJson,
  UnitOverlapJson,
  UnitRefJson,
} from '@timon/http';
import { ApiError } from './api.ts';
import { weekdayName } from './customers/customer-labels.ts';
import { errorText } from './data.ts';
import {
  capitalise,
  entryLabel,
  formatNumber,
  inSentence,
  joinOr,
  kindLabel,
  vehicleKindLabel,
} from './labels.ts';
import { m } from './paraglide/messages.js';
import { periodText, reasonText } from './units/unit-labels.ts';

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
  // Units
  powerUnitId: m.col_power_unit,
  trailerId: m.col_trailer,
  driverId: m.col_driver,
  start: m.field_start,
  end: m.field_end,
  from: m.field_from,
  members: m.field_members,
};

const contactFields: Record<string, () => string> = {
  name: m.field_contact_name,
  role: m.field_contact_role,
  phone: m.field_contact_phone,
  email: m.field_contact_email,
};

/** Labels of one form that differ from the shared ones: `name` is a customer's legal name. */
export type FieldLabels = Readonly<Record<string, () => string>>;

/** The label of a field, or of a document type for a `document:<code>` import column. */
export function fieldLabel(
  field: string,
  lists?: ReferenceListsJson,
  labels?: FieldLabels,
): string {
  const own = labels?.[field];
  if (own) return own();
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
export function issueText(
  issue: IssueJson,
  lists?: ReferenceListsJson,
  labels?: FieldLabels,
): string {
  const field = inSentence(fieldLabel(issue.field, lists, labels));
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
    case 'category-weight-mismatch': {
      const values = {
        category: text(params.category),
        weight: formatNumber(Number(params.gvwKg)),
        over: params.overKg === undefined ? '' : formatNumber(Number(params.overKg)),
        upTo: params.upToKg === undefined ? '' : formatNumber(Number(params.upToKg)),
      };
      if (values.over === '') return m.issue_category_weight_up_to(values);
      if (values.upTo === '') return m.issue_category_weight_over(values);
      return m.issue_category_weight_between(values);
    }
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
    case 'employee-number-taken':
      return `${field} ${m.issue_employee_number_taken({ name: (params.owner as EmployeeNumberOwnerJson).name })}`;
    case 'employee-number-duplicated':
      return m.issue_employee_number_duplicated({ line: text(params.line) });
    case 'phone-invalid':
      return m.issue_phone_invalid({ field });
    case 'code-invalid':
      return m.issue_code_invalid({ field });
    case 'siret-invalid':
      return m.issue_siret_invalid();
    case 'siret-not-french':
      return m.issue_siret_not_french();
    case 'vat-invalid':
      return m.issue_vat_invalid();
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
    case 'opening-unreadable':
      return m.issue_opening_unreadable({
        day: capitalise(weekdayName(Number(params.weekday))),
        value: text(params.value),
      });
    case 'time-invalid':
      return m.issue_time_invalid({
        day: capitalise(weekdayName(Number(params.weekday))),
        value: text(params.value),
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
    case 'licence-missing':
      return text(params.holds)
        ? m.issue_licence_missing({
            needs: text(params.needs),
            driver: text(params.driver),
            holds: text(params.holds),
          })
        : m.issue_licence_none({ needs: text(params.needs), driver: text(params.driver) });
    case 'licence-not-supported':
    case 'semi-trailer-needs-tractor':
    case 'drawbar-trailer-needs-rigid-truck':
    case 'light-van-no-trailer':
      return inSentence(reasonText(issue));
    case 'driver-or-trailer-required':
      return m.issue_driver_or_trailer_required();
    case 'resource-archived':
      return m.issue_resource_archived({ field });
    case 'subsidiary-mismatch':
      return m.issue_subsidiary_mismatch();
    case 'not-to-the-minute':
      return m.issue_not_to_the_minute({ field });
    case 'end-not-after-start':
      return m.issue_end_not_after_start();
    case 'outside-unit':
      return m.issue_outside_unit();
    case 'unchanged':
      return m.issue_unchanged({ field });
    case 'too-long':
      return m.issue_too_long({ field, max: Number(params.max) });
    case 'invalid-value':
      return m.issue_invalid_value({ field });
    default:
      return `${field}: ${issue.code}`;
  }
}

/** The same issue as a sentence on its own, for a form field. */
export function issueSentence(
  issue: IssueJson,
  lists?: ReferenceListsJson,
  labels?: FieldLabels,
): string {
  return capitalise(issueText(issue, lists, labels));
}

/** Why a write was refused, in one sentence; the issues of a form are shown by field instead. */
export function failureText(error: unknown, lists?: ReferenceListsJson): string {
  if (error instanceof ApiError) {
    const body = error.body as { owner?: PlateOwnerJson; issues?: IssueJson[] } | undefined;
    if (error.code === 'plate-taken' && body?.owner) {
      return m.plate_taken({ name: body.owner.name, kind: ownerKind(body.owner) });
    }
    if (error.code === 'document-type-taken') return m.document_type_taken();
    if (error.code === 'archived') return m.archived_read_only();
    if (error.code === 'employee-number-taken') {
      const owner = (error.body as { owner?: EmployeeNumberOwnerJson } | undefined)?.owner;
      if (owner) return employeeNumberTakenText(owner);
    }
    const unitFailure = unitFailureText(error);
    if (unitFailure) return unitFailure;
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

/** SPEC-001 rule 9: the driver who has the number, archived or not. */
export function employeeNumberTakenText(owner: EmployeeNumberOwnerJson): string {
  return owner.archived
    ? m.employee_number_taken_archived({ name: owner.name })
    : m.employee_number_taken({ name: owner.name });
}

/** The refusals of SPEC-003, in one sentence each. */
function unitFailureText(error: ApiError): string | undefined {
  if (error.code === 'in-unit') {
    const unit = (error.body as { unit?: UnitRefJson } | undefined)?.unit;
    if (unit) return m.in_unit({ unit: unit.name, period: periodText(unit.start, unit.end) });
  }
  if (error.code === 'unit-overlap') {
    const [first] = (error.body as UnitOverlapJson | undefined)?.conflicts ?? [];
    if (first) {
      return m.unit_overlap({
        resource: first.resource.name,
        unit: first.unit.name,
        period: periodText(first.unit.start, first.unit.end),
      });
    }
  }
  if (error.code === 'started') return m.unit_started();
  if (error.code === 'not-started') return m.unit_not_started();
  if (error.code === 'ended') return m.unit_ended();
  return undefined;
}
