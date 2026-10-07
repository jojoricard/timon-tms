import { resourceKinds, vehicleCategories, vehicleKinds } from '@timon/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tstzrange } from './tstzrange.ts';

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
    check(
      'resource_driver_fields',
      sql`${t.kind} <> 'driver' or (${t.lastName} is not null and ${t.firstName} is not null and ${t.displayName} is not null and ${t.plate} is null and ${t.vehicleKind} is null)`,
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
