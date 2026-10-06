import { findOverlaps, type ResourceBooking } from '@timon/domain';
import { BookingOverlapError, type NewBooking, type Ports } from './ports.ts';

export type CreateBookingResult =
  | { readonly ok: true; readonly booking: ResourceBooking }
  | { readonly ok: false; readonly reason: 'unknown-resource' }
  | { readonly ok: false; readonly reason: 'overlap'; readonly conflicts: ResourceBooking[] };

export function listResources(ports: Ports) {
  return ports.resources.list();
}

export function listBookings(ports: Ports, resourceId: string) {
  return ports.bookings.listByResource(resourceId);
}

/**
 * Books a resource over a period. The rule is checked here first, then enforced by the
 * database: a concurrent booking that slips between the check and the insert is still refused.
 */
export async function createBooking(ports: Ports, input: NewBooking): Promise<CreateBookingResult> {
  if (!(await ports.resources.get(input.resourceId))) {
    return { ok: false, reason: 'unknown-resource' };
  }

  const overlapping = () => ports.bookings.listOverlapping(input.resourceId, input.period);
  const conflicts = findOverlaps(input.resourceId, input.period, await overlapping());
  if (conflicts.length > 0) {
    return { ok: false, reason: 'overlap', conflicts };
  }

  try {
    return { ok: true, booking: await ports.bookings.insert(input) };
  } catch (error) {
    if (error instanceof BookingOverlapError) {
      return { ok: false, reason: 'overlap', conflicts: await overlapping() };
    }
    throw error;
  }
}
