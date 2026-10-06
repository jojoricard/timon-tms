import {
  BookingOverlapError,
  type BookingRepository,
  type Ports,
  type ResourceRepository,
} from '@timon/app';
import type { Period, ResourceBooking } from '@timon/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { resource, resourceBooking } from './schema.ts';
import { formatRange } from './tstzrange.ts';

const exclusionViolation = '23P01';
const noOverlapConstraint = 'resource_booking_no_overlap';

export function createRepositories(db: Database): Ports {
  return { resources: resourceRepository(db), bookings: bookingRepository(db) };
}

function resourceRepository(db: Database): ResourceRepository {
  return {
    list: () => db.select().from(resource).orderBy(asc(resource.kind), asc(resource.name)),
    get: async (id) => {
      const [row] = await db.select().from(resource).where(eq(resource.id, id));
      return row;
    },
  };
}

function bookingRepository(db: Database): BookingRepository {
  const byStart = sql`lower(${resourceBooking.period})`;
  return {
    listByResource: (resourceId) =>
      db
        .select()
        .from(resourceBooking)
        .where(eq(resourceBooking.resourceId, resourceId))
        .orderBy(byStart),
    listOverlapping: (resourceId: string, period: Period) =>
      db
        .select()
        .from(resourceBooking)
        .where(
          and(
            eq(resourceBooking.resourceId, resourceId),
            sql`${resourceBooking.period} && ${formatRange(period)}::tstzrange`,
          ),
        )
        .orderBy(byStart),
    insert: async (booking): Promise<ResourceBooking> => {
      try {
        const [created] = await db.insert(resourceBooking).values(booking).returning();
        if (!created) throw new Error('Insert returned no row');
        return created;
      } catch (error) {
        if (isNoOverlapViolation(error))
          throw new BookingOverlapError('Overlapping booking', { cause: error });
        throw error;
      }
    },
  };
}

// node-postgres and PGlite both expose the SQLSTATE as `code`; Drizzle may wrap it in `cause`.
function isNoOverlapViolation(error: unknown): boolean {
  for (let e = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === exclusionViolation)
      return constraint === undefined || constraint === noOverlapConstraint;
  }
  return false;
}
