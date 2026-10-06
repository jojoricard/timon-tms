import type { Period, Resource, ResourceBooking } from '@timon/domain';

export type NewBooking = Omit<ResourceBooking, 'id'>;

/** Raised by a repository when the database rejects a booking that overlaps another. */
export class BookingOverlapError extends Error {
  override readonly name = 'BookingOverlapError';
}

export interface ResourceRepository {
  list(): Promise<Resource[]>;
  get(id: string): Promise<Resource | undefined>;
}

export interface BookingRepository {
  listByResource(resourceId: string): Promise<ResourceBooking[]>;
  listOverlapping(resourceId: string, period: Period): Promise<ResourceBooking[]>;
  /** @throws BookingOverlapError when the period overlaps another booking of the resource. */
  insert(booking: NewBooking): Promise<ResourceBooking>;
}

export type Ports = {
  readonly resources: ResourceRepository;
  readonly bookings: BookingRepository;
};
