import { resourceKinds } from '@timon/domain';
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { tstzrange } from './tstzrange.ts';

export const resource = pgTable('resource', {
  id: uuid().primaryKey().defaultRandom(),
  kind: text({ enum: resourceKinds }).notNull(),
  name: text().notNull(),
});

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
