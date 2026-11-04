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

/**
 * A half-open period that may have no end: `end` null lasts until changed. Same semantics as a
 * PostgreSQL `tstzrange '[)'` with an infinite upper bound.
 */
export type OpenPeriod = {
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant | null;
};

export function openPeriodOf(
  start: Temporal.Instant | string,
  end: Temporal.Instant | string | null,
): OpenPeriod {
  if (end === null) return { start: Temporal.Instant.from(start), end: null };
  return periodOf(start, end);
}

export function overlapsOpen(a: OpenPeriod, b: OpenPeriod): boolean {
  const startsBeforeEnd = (p: OpenPeriod, q: OpenPeriod) =>
    q.end === null || Temporal.Instant.compare(p.start, q.end) < 0;
  return startsBeforeEnd(a, b) && startsBeforeEnd(b, a);
}

/** Whether `instant` falls within the period: from its start included to its end excluded. */
export function contains(period: OpenPeriod, instant: Temporal.Instant): boolean {
  return (
    Temporal.Instant.compare(period.start, instant) <= 0 &&
    (period.end === null || Temporal.Instant.compare(instant, period.end) < 0)
  );
}
