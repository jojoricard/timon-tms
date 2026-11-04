import { type OpenPeriod, openPeriodOf, type Period, periodOf } from '@timon/domain';
import { customType } from 'drizzle-orm/pg-core';

/** Drizzle has no range type: a period is stored as a half-open `tstzrange '[)'`. */
export const tstzrange = customType<{ data: Period; driverData: string }>({
  dataType: () => 'tstzrange',
  toDriver: (period) => formatRange(period),
  fromDriver: (value) => parseRange(value),
});

export function formatRange(period: Period): string {
  return `[${period.start.toString()},${period.end.toString()})`;
}

const rangePattern = /^\[\s*"?([^",]+)"?\s*,\s*"?([^",]+)"?\s*\)$/;

/** Parses PostgreSQL output such as `["2026-10-07 08:00:00+00","2026-10-07 12:00:00+00")`. */
export function parseRange(value: string): Period {
  const match = rangePattern.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Expected a bounded [) tstzrange, got ${value}`);
  }
  return periodOf(toIso(match[1]), toIso(match[2]));
}

// PostgreSQL writes a space between date and time and may shorten the offset to hours.
function toIso(timestamp: string): string {
  return timestamp.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
}

/** A period that may have no end, stored as `tstzrange '[)'` with an infinite upper bound. */
export const openTstzrange = customType<{ data: OpenPeriod; driverData: string }>({
  dataType: () => 'tstzrange',
  toDriver: (period) => formatOpenRange(period),
  fromDriver: (value) => parseOpenRange(value),
});

export function formatOpenRange(period: OpenPeriod): string {
  return `[${period.start.toString()},${period.end?.toString() ?? ''})`;
}

const openRangePattern = /^\[\s*"?([^",]+)"?\s*,\s*(?:"?([^",)]+)"?)?\s*\)$/;

/** Parses `["2026-10-06 04:00:00+00",)` as well as a bounded range. */
export function parseOpenRange(value: string): OpenPeriod {
  const match = openRangePattern.exec(value);
  if (!match?.[1]) throw new Error(`Expected a [) tstzrange with a start, got ${value}`);
  return openPeriodOf(toIso(match[1]), match[2] ? toIso(match[2]) : null);
}
