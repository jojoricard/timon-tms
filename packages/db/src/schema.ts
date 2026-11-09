import {
  adrClasses,
  bookingMethods,
  locatedByValues,
  orderStatuses,
  packagings,
  resourceKinds,
  stopKinds,
  unitRoles,
  vehicleCategories,
  vehicleKinds,
} from '@timon/domain';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { openTstzrange, tstzrange } from './tstzrange.ts';

export const company = pgTable('company', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  timeZone: text('time_zone').notNull().default('Europe/Paris'),
});

// Rule 7: every resource belongs to a subsidiary. One for now, created by migration 0004.
export const subsidiary = pgTable('subsidiary', {
  id: uuid().primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => company.id),
  name: text().notNull(),
});

// Company lists. An entry Timon provides has a code the interface translates; an entry the
// haulier adds has a name instead.
const listColumns = {
  id: uuid().primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => company.id),
  code: text(),
  name: text(),
  sortOrder: integer('sort_order').notNull().default(0),
};
const listChecks = (table: string) => [
  check(`${table}_code_or_name`, sql.raw('code is not null or name is not null')),
];

export const documentType = pgTable(
  'document_type',
  {
    ...listColumns,
    appliesTo: text('applies_to', { enum: resourceKinds }).array().notNull(),
    blocking: boolean().notNull(),
    warnDays: integer('warn_days').notNull().default(30),
  },
  (t) => [
    ...listChecks('document_type'),
    unique('document_type_company_code').on(t.companyId, t.code),
    check('document_type_warn_days', sql`${t.warnDays} >= 0`),
  ],
);

export const bodyType = pgTable('body_type', listColumns, (t) => [
  ...listChecks('body_type'),
  unique('body_type_company_code').on(t.companyId, t.code),
]);

export const tradeLabel = pgTable('trade_label', listColumns, (t) => [
  ...listChecks('trade_label'),
  unique('trade_label_company_code').on(t.companyId, t.code),
]);

export const capability = pgTable('capability', listColumns, (t) => [
  ...listChecks('capability'),
  unique('capability_company_code').on(t.companyId, t.code),
]);

// One table for the three kinds, so that plate uniqueness among active resources is a
// partial unique index. The checks repeat the rules of the domain (rules 1 to 3) as a net.
export const resource = pgTable(
  'resource',
  {
    id: uuid().primaryKey().defaultRandom(),
    subsidiaryId: uuid('subsidiary_id')
      .notNull()
      .references(() => subsidiary.id),
    kind: text({ enum: resourceKinds }).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Driver
    lastName: text('last_name'),
    firstName: text('first_name'),
    displayName: text('display_name'),
    employeeNumber: text('employee_number'),
    phone: text(),
    // Power unit or trailer
    plate: text(),
    plateKey: text('plate_key'),
    vehicleKind: text('vehicle_kind', { enum: vehicleKinds }),
    category: text({ enum: vehicleCategories }),
    gvwKg: integer('gvw_kg'),
    gcwKg: integer('gcw_kg'),
    makeModel: text('make_model'),
    bodyTypeId: uuid('body_type_id').references(() => bodyType.id),
    tradeLabelId: uuid('trade_label_id').references(() => tradeLabel.id),
  },
  (t) => [
    uniqueIndex('resource_active_plate').on(t.plateKey).where(sql`${t.archivedAt} is null`),
    // SPEC-001 rule 9: unique among drivers, archived ones included, without case.
    uniqueIndex('resource_driver_employee_number')
      .on(sql`lower(${t.employeeNumber})`)
      .where(sql`${t.kind} = 'driver'`),
    // The display name is null unless typed (rule 8): it is built from the names when read.
    check(
      'resource_driver_fields',
      sql`${t.kind} <> 'driver' or (${t.lastName} is not null and ${t.firstName} is not null and ${t.plate} is null and ${t.vehicleKind} is null)`,
    ),
    check(
      'resource_vehicle_fields',
      sql`${t.kind} = 'driver' or (${t.plate} is not null and ${t.plateKey} is not null and ${t.vehicleKind} is not null and ${t.category} is not null and ${t.gvwKg} is not null and ${t.lastName} is null)`,
    ),
    check(
      'resource_kind_category',
      sql`${t.vehicleKind} is null or (${t.kind} = 'power-unit' and (
        (${t.vehicleKind} = 'light-van' and ${t.category} = 'N1') or
        (${t.vehicleKind} in ('rigid-truck', 'tractor') and ${t.category} in ('N2', 'N3'))
      )) or (${t.kind} = 'trailer' and (
        (${t.vehicleKind} = 'semi-trailer' and ${t.category} in ('O3', 'O4')) or
        (${t.vehicleKind} = 'drawbar-trailer' and ${t.category} in ('O1', 'O2', 'O3', 'O4'))
      ))`,
    ),
    check(
      'resource_weights',
      sql`(${t.gvwKg} is null or ${t.gvwKg} > 0) and (${t.gcwKg} is null or (${t.kind} = 'power-unit' and ${t.gcwKg} > ${t.gvwKg}))`,
    ),
    check(
      'resource_tractor_body_type',
      sql`${t.vehicleKind} is distinct from 'tractor' or ${t.bodyTypeId} is null`,
    ),
    // Target of the unit members' foreign key: a member's role is its resource's kind.
    unique('resource_id_kind').on(t.id, t.kind),
  ],
);

export const resourceCapability = pgTable(
  'resource_capability',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => capability.id),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.capabilityId] })],
);

// One document per type and resource: a renewal replaces the dates.
export const document = pgTable(
  'document',
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => documentType.id),
    reference: text(),
    issuedOn: date('issued_on', { mode: 'string' }),
    expiresOn: date('expires_on', { mode: 'string' }).notNull(),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('document_resource_type').on(t.resourceId, t.documentTypeId),
    check(
      'document_issued_before_expiry',
      sql`${t.issuedOn} is null or ${t.issuedOn} <= ${t.expiresOn}`,
    ),
  ],
);

// The exclusion constraint that forbids two overlapping bookings of the same resource is not
// expressible in Drizzle: it lives in the hand-written migration 0001_resource_booking_no_overlap.
// Its GiST index, which starts with resource_id, also serves lookups by resource.
export const resourceBooking = pgTable(
  'resource_booking',
  {
    id: uuid().primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    period: tstzrange().notNull(),
    label: text().notNull(),
  },
  (t) => [
    check(
      'resource_booking_period_bounded',
      sql`not isempty(${t.period}) and lower_inc(${t.period}) and not upper_inc(${t.period}) and not lower_inf(${t.period}) and not upper_inf(${t.period})`,
    ),
  ],
);

// SPEC-002. Customers and sites belong to the company, not to a subsidiary: a chartered order
// keeps its customer, and sites are one address book for every customer.

export const customer = pgTable(
  'customer',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    // Stored in capitals: unique without case, archived customers included (rule 1).
    code: text().notNull(),
    name: text().notNull(),
    country: text().notNull().default('FR'),
    siret: text(),
    vatNumber: text('vat_number'),
    billingStreet1: text('billing_street1'),
    billingStreet2: text('billing_street2'),
    billingPostcode: text('billing_postcode'),
    billingCity: text('billing_city'),
    notes: text(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('customer_company_code').on(t.companyId, t.code),
    uniqueIndex('customer_active_siret')
      .on(t.companyId, t.siret)
      .where(sql`${t.archivedAt} is null`),
    check('customer_code_upper', sql`${t.code} = upper(${t.code})`),
    check(
      'customer_siret_french',
      sql`${t.siret} is null or (${t.siret} ~ '^[0-9]{14}$' and ${t.country} = 'FR')`,
    ),
  ],
);

// Rule 3: a removed contact is deleted, not archived; personal data is not kept.
export const contact = pgTable(
  'contact',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    name: text().notNull(),
    role: text(),
    phone: text(),
    email: text(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('contact_customer_idx').on(t.customerId),
    check('contact_reachable', sql`${t.phone} is not null or ${t.email} is not null`),
  ],
);

export const site = pgTable(
  'site',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    name: text().notNull(),
    street1: text().notNull(),
    street2: text(),
    postcode: text().notNull(),
    city: text().notNull(),
    country: text().notNull().default('FR'),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    locatedBy: text('located_by', { enum: locatedByValues }).notNull(),
    timeZone: text('time_zone').notNull().default('Europe/Paris'),
    bookingRequired: boolean('booking_required').notNull().default(false),
    bookingMethod: text('booking_method', { enum: bookingMethods }),
    bookingDetail: text('booking_detail'),
    maxLengthCm: integer('max_length_cm'),
    maxWeightKg: integer('max_weight_kg'),
    loadingDock: boolean('loading_dock').notNull().default(true),
    semiTrailersAccepted: boolean('semi_trailers_accepted').notNull().default(true),
    gatePhone: text('gate_phone'),
    instructions: text(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'site_location',
      sql`(${t.locatedBy} = 'not-located') = (${t.latitude} is null) and (${t.latitude} is null) = (${t.longitude} is null)`,
    ),
    check(
      'site_coordinates',
      sql`${t.latitude} is null or (${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`,
    ),
    check('site_french_postcode', sql`${t.country} <> 'FR' or ${t.postcode} ~ '^[0-9]{5}$'`),
    check('site_booking', sql`not ${t.bookingRequired} or ${t.bookingMethod} is not null`),
    check(
      'site_limits',
      sql`(${t.maxLengthCm} is null or ${t.maxLengthCm} > 0) and (${t.maxWeightKg} is null or ${t.maxWeightKg} > 0)`,
    ),
  ],
);

// The sites a customer usually uses. A site may be used by several customers (rule 6).
export const customerSite = pgTable(
  'customer_site',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.siteId] }),
    index('customer_site_site_idx').on(t.siteId),
  ],
);

// Opening hours in the site's time zone, in minutes since midnight; 1440 is 24:00. Two ranges
// of one day may not overlap (rule 4): the exclusion constraint is in migration 0009.
export const siteOpening = pgTable(
  'site_opening',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    weekday: smallint().notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.weekday, t.startMinute] }),
    check('site_opening_weekday', sql`${t.weekday} between 1 and 7`),
    check(
      'site_opening_range',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.endMinute} > ${t.startMinute}`,
    ),
  ],
);

export const protectiveEquipment = pgTable('protective_equipment', listColumns, (t) => [
  ...listChecks('protective_equipment'),
  unique('protective_equipment_company_code').on(t.companyId, t.code),
]);

// What everyone entering a site must wear.
export const siteProtectiveEquipment = pgTable(
  'site_protective_equipment',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    protectiveEquipmentId: uuid('protective_equipment_id')
      .notNull()
      .references(() => protectiveEquipment.id),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.protectiveEquipmentId] })],
);

// What a driver holds: held or not, no dates. The application only links drivers.
export const resourceProtectiveEquipment = pgTable(
  'resource_protective_equipment',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id),
    protectiveEquipmentId: uuid('protective_equipment_id')
      .notNull()
      .references(() => protectiveEquipment.id),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.protectiveEquipmentId] })],
);

// SPEC-003. A unit groups a power unit with a driver, a trailer or both over a half-open period,
// open-ended when `upper(period)` is infinite. The period lives on the unit; each member row
// carries a copy, kept equal by a foreign key that cascades updates, so that ending a unit ends
// its members. The exclusion constraint on the members, written by hand in migration 0013,
// keeps a resource in one unit at a time (rule 4).
export const unit = pgTable(
  'unit',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    name: text(),
    period: openTstzrange().notNull(),
    previousUnitId: uuid('previous_unit_id').references((): AnyPgColumn => unit.id, {
      onDelete: 'set null',
    }),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('unit_id_period').on(t.id, t.period),
    check(
      'unit_period_from_start',
      sql`not isempty(${t.period}) and lower_inc(${t.period}) and not upper_inc(${t.period}) and not lower_inf(${t.period})`,
    ),
  ],
);

export const unitMember = pgTable(
  'unit_member',
  {
    unitId: uuid('unit_id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    role: text({ enum: unitRoles }).notNull(),
    period: openTstzrange().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.role] }),
    foreignKey({
      name: 'unit_member_unit_period_fk',
      columns: [t.unitId, t.period],
      foreignColumns: [unit.id, unit.period],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'unit_member_resource_role_fk',
      columns: [t.resourceId, t.role],
      foreignColumns: [resource.id, resource.kind],
    }),
  ],
);

// SPEC-004. Numbers are CMD-<year>-<sequence>, a sequence per company and year. Taking one
// updates the counter row, which locks it until the order is written: two creations at once get
// two numbers, in turn, and a number is never given twice.
export const orderCounter = pgTable(
  'order_counter',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    year: integer().notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.year] }),
    check('order_counter_positive', sql`${t.lastValue} > 0`),
  ],
);

// `order` is a reserved word in SQL.
export const transportOrder = pgTable(
  'transport_order',
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    number: text().notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    customerReference: text('customer_reference'),
    notes: text(),
    bodyTypeId: uuid('body_type_id').references(() => bodyType.id),
    sideLoading: boolean('side_loading').notNull().default(false),
    tailLift: boolean('tail_lift').notNull().default(false),
    status: text({ enum: orderStatuses }).notNull(),
    cancelReason: text('cancel_reason'),
    // ADR-005: 1 at creation, plus one at every write; a write names the version it read.
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('transport_order_company_number').on(t.companyId, t.number),
    index('transport_order_customer_reference_idx').on(t.customerId, t.customerReference),
    check('transport_order_status', sql`${t.status} in ('to-plan', 'to-review', 'cancelled')`),
    // Rule 6: a cancelled order keeps its reason.
    check(
      'transport_order_cancel_reason',
      sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
  ],
);

// The stops of an order: stored again whole at every change, under the order's version. The
// slot is a half-open period; the form reads it in the site's time zone.
export const orderStop = pgTable(
  'order_stop',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => transportOrder.id),
    kind: text({ enum: stopKinds }).notNull(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    slot: tstzrange().notNull(),
    bookingMade: boolean('booking_made').notNull().default(false),
    bookingReference: text('booking_reference'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    // The target of the goods lines' foreign keys, which name the kind of stop they expect.
    unique('order_stop_order_id_kind').on(t.orderId, t.id, t.kind),
    index('order_stop_site_idx').on(t.siteId),
    check('order_stop_kind', sql`${t.kind} in ('pickup', 'delivery')`),
    check(
      'order_stop_slot_bounded',
      sql`not isempty(${t.slot}) and lower_inc(${t.slot}) and not upper_inc(${t.slot}) and not lower_inf(${t.slot}) and not upper_inf(${t.slot})`,
    ),
    check('order_stop_booking', sql`${t.bookingReference} is null or ${t.bookingMade}`),
  ],
);

// Rule 2: a goods line leaves from a pickup of its order and goes to a delivery of its order.
// The kinds are columns fixed by a check, so that the foreign keys refuse a line leaving from a
// delivery or going to a pickup.
export const orderGoods = pgTable(
  'order_goods',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => transportOrder.id),
    sortOrder: integer('sort_order').notNull().default(0),
    description: text().notNull(),
    quantity: integer().notNull(),
    packaging: text({ enum: packagings }).notNull(),
    weightKg: integer('weight_kg').notNull(),
    floorDm: integer('floor_dm'),
    unNumber: text('un_number'),
    adrClass: text('adr_class', { enum: adrClasses }),
    temperatureMin: smallint('temperature_min'),
    temperatureMax: smallint('temperature_max'),
    fromStopId: uuid('from_stop_id').notNull(),
    fromKind: text('from_kind', { enum: stopKinds }).notNull().default('pickup'),
    toStopId: uuid('to_stop_id').notNull(),
    toKind: text('to_kind', { enum: stopKinds }).notNull().default('delivery'),
  },
  (t) => [
    index('order_goods_order_idx').on(t.orderId),
    foreignKey({
      name: 'order_goods_from_pickup_fk',
      columns: [t.orderId, t.fromStopId, t.fromKind],
      foreignColumns: [orderStop.orderId, orderStop.id, orderStop.kind],
    }),
    foreignKey({
      name: 'order_goods_to_delivery_fk',
      columns: [t.orderId, t.toStopId, t.toKind],
      foreignColumns: [orderStop.orderId, orderStop.id, orderStop.kind],
    }),
    check('order_goods_from_pickup', sql`${t.fromKind} = 'pickup'`),
    check('order_goods_to_delivery', sql`${t.toKind} = 'delivery'`),
    check(
      'order_goods_quantities',
      sql`${t.quantity} > 0 and ${t.weightKg} > 0 and (${t.floorDm} is null or ${t.floorDm} > 0)`,
    ),
    check('order_goods_un_number', sql`${t.unNumber} is null or ${t.unNumber} ~ '^[0-9]{4}$'`),
    check('order_goods_adr', sql`(${t.unNumber} is null) = (${t.adrClass} is null)`),
    check(
      'order_goods_temperature',
      sql`(${t.temperatureMin} is null) = (${t.temperatureMax} is null) and (${t.temperatureMin} is null or (${t.temperatureMin} between -30 and 30 and ${t.temperatureMax} between -30 and 30 and ${t.temperatureMin} <= ${t.temperatureMax}))`,
    ),
  ],
);

// The history of an order. `details` holds what the entry says, as the application wrote it;
// the author stays empty until people sign in. `sequence` keeps the order in which entries were
// written, for two entries of the same instant.
export const orderEvent = pgTable(
  'order_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    sequence: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => transportOrder.id),
    at: timestamp({ withTimezone: true }).notNull(),
    kind: text({ enum: ['created', 'changed', 'status'] }).notNull(),
    authorId: uuid('author_id'),
    details: jsonb().notNull(),
  },
  (t) => [index('order_event_order_idx').on(t.orderId, t.sequence)],
);
