import { Temporal } from './temporal.ts';

/**
 * A half-open time interval [start, end): a booking ending at 10:00 and another
 * starting at 10:00 do not overlap. Same semantics as a PostgreSQL `tstzrange '[)'`.
 */
export type Period = {
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant;
};

export class InvalidPeriodError extends Error {
  override readonly name = 'InvalidPeriodError';
}

export function periodOf(start: Temporal.Instant | string, end: Temporal.Instant | string): Period {
  const period = { start: Temporal.Instant.from(start), end: Temporal.Instant.from(end) };
  if (Temporal.Instant.compare(period.start, period.end) >= 0) {
    throw new InvalidPeriodError('A period must end after it starts.');
  }
  return period;
}

export function overlaps(a: Period, b: Period): boolean {
  return (
    Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0
  );
}
