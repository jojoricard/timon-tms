import type { Issue } from './issue.ts';

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof weekdays)[number];

/** A time range on one day, in minutes since midnight; 1440 is 24:00, the end of the day. */
export type OpeningRange = {
  readonly weekday: Weekday;
  readonly startMinute: number;
  readonly endMinute: number;
};

export const endOfDay = 24 * 60;

/** "06:00" → 360, "24:00" → 1440; anything else → undefined. */
export function parseTime(value: string): number | undefined {
  const match = /^(\d{1,2})[:h](\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= endOfDay ? minutes : undefined;
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * One day of a CSV file: "06:00-12:00/13:00-17:00", or empty for closed. Undefined when it
 * cannot be read; the ranges themselves are checked by `checkOpeningRanges`.
 */
export function parseOpeningDay(weekday: Weekday, value: string): OpeningRange[] | undefined {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'closed' || text === 'fermé' || text === 'ferme') return [];
  const ranges: OpeningRange[] = [];
  for (const part of text.split('/')) {
    const [start, end, ...rest] = part.split(/[-–]/);
    const startMinute = parseTime(start ?? '');
    const endMinute = parseTime(end ?? '');
    if (rest.length > 0 || startMinute === undefined || endMinute === undefined) return undefined;
    ranges.push({ weekday, startMinute, endMinute });
  }
  return ranges;
}

/**
 * Rule 4: each range ends after it starts, 24:00 at the latest, and the ranges of one day do
 * not overlap. A night spans two days: one range ends at 24:00, the next starts at 00:00.
 */
export function checkOpeningRanges(ranges: readonly OpeningRange[]): Issue[] {
  const issues: Issue[] = [];
  for (const range of ranges) {
    const valid =
      Number.isInteger(range.startMinute) &&
      Number.isInteger(range.endMinute) &&
      range.startMinute >= 0 &&
      range.endMinute <= endOfDay &&
      range.endMinute > range.startMinute;
    if (!valid) {
      issues.push({
        field: `openings.${range.weekday}`,
        code: 'opening-invalid',
        params: {
          weekday: range.weekday,
          start: formatMinutes(Math.max(0, range.startMinute)),
          end: formatMinutes(Math.max(0, range.endMinute)),
        },
      });
    }
  }
  for (const weekday of weekdays) {
    const day = ranges
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < day.length; i += 1) {
      const previous = day[i - 1];
      const current = day[i];
      if (previous && current && current.startMinute < previous.endMinute) {
        issues.push({
          field: `openings.${weekday}`,
          code: 'opening-overlap',
          params: {
            weekday,
            first: `${formatMinutes(previous.startMinute)}–${formatMinutes(previous.endMinute)}`,
            second: `${formatMinutes(current.startMinute)}–${formatMinutes(current.endMinute)}`,
          },
        });
      }
    }
  }
  return issues;
}

/** The ranges of one day, in order, as "06:00–12:00 · 13:00–17:30"; empty when closed. */
export function formatOpeningDay(ranges: readonly OpeningRange[], weekday: Weekday): string {
  return ranges
    .filter((r) => r.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((r) => `${formatMinutes(r.startMinute)}–${formatMinutes(r.endMinute)}`)
    .join(' · ');
}
