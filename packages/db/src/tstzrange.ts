import { type Period, periodOf } from '@timon/domain';
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
