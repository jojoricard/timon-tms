import { overlaps, type Period } from './period.ts';

/** A resource blocked over a period, by an order or an activity. */
export type ResourceBooking = {
  readonly id: string;
  readonly resourceId: string;
  readonly period: Period;
  readonly label: string;
};

/** The bookings of the same resource that a new booking over `period` would overlap. */
export function findOverlaps<T extends Pick<ResourceBooking, 'resourceId' | 'period'>>(
  resourceId: string,
  period: Period,
  bookings: readonly T[],
): T[] {
  return bookings.filter((b) => b.resourceId === resourceId && overlaps(b.period, period));
}
