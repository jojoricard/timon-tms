import { useQuery, useQueryClient } from '@tanstack/react-query';
import { companyTimeZone, Temporal } from '@timon/domain';
import { api, ok } from '../api.ts';
import { keys } from '../data.ts';

// Units are entered and shown in the company's time zone, to the minute, whatever the
// browser's time zone; the API exchanges instants.

/** "2026-10-06T06:00" in Paris, as an `<input type="datetime-local">` holds it. */
export type LocalTime = string;

export function toLocal(instant: string | Temporal.Instant): LocalTime {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(companyTimeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

/** The instant of a local time, or undefined when the text is not one. */
export function fromLocal(local: LocalTime): string | undefined {
  try {
    return Temporal.PlainDateTime.from(local)
      .round({ smallestUnit: 'minute', roundingMode: 'floor' })
      .toZonedDateTime(companyTimeZone)
      .toInstant()
      .toString();
  } catch {
    return undefined;
  }
}

/** Now, to the minute, in Paris. */
export function nowLocal(): LocalTime {
  return toLocal(Temporal.Now.instant());
}

/** The next full hour in Paris: a sensible default for a change. */
export function nextHourLocal(): LocalTime {
  return Temporal.Now.zonedDateTimeISO(companyTimeZone)
    .round({ smallestUnit: 'hour', roundingMode: 'ceil' })
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

export function addDays(local: LocalTime, days: number): LocalTime {
  return Temporal.PlainDateTime.from(local).add({ days }).toString({ smallestUnit: 'minute' });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "26/10 06:00", or "26/10/2026 06:00" with the year; day first in both languages. */
export function formatTime(instant: string | null, options: { year?: boolean } = {}): string {
  if (!instant) return '';
  const t = Temporal.Instant.from(instant).toZonedDateTimeISO(companyTimeZone);
  const date = `${pad(t.day)}/${pad(t.month)}${options.year ? `/${t.year}` : ''}`;
  return `${date} ${pad(t.hour)}:${pad(t.minute)}`;
}

export const unitKeys = {
  all: ['resources', 'units'] as const,
  at: (at: string | undefined) => ['resources', 'units', 'at', at ?? 'now'] as const,
  one: (id: string) => ['resources', 'units', 'one', id] as const,
  options: (query: Record<string, string>) => ['resources', 'units', 'options', query] as const,
  ofResource: (id: string) => ['resources', 'units', 'resource', id] as const,
};

export function useUnitsAt(at: LocalTime | undefined) {
  const instant = at ? fromLocal(at) : undefined;
  return useQuery({
    queryKey: unitKeys.at(instant),
    queryFn: async () => ok(await api.units.$get({ query: instant ? { at: instant } : {} })),
    placeholderData: (previous) => previous,
  });
}

export function useUnit(id: string | undefined) {
  return useQuery({
    queryKey: unitKeys.one(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () => ok(await api.units[':id'].$get({ param: { id: id ?? '' } })),
  });
}

export type OptionsQuery = {
  start: string;
  end?: string;
  powerUnitId?: string;
  trailerId?: string;
  driverId?: string;
  exceptUnitId?: string;
};

export function useUnitOptions(query: OptionsQuery | undefined) {
  return useQuery({
    queryKey: unitKeys.options(query ?? {}),
    enabled: query !== undefined,
    queryFn: async () => ok(await api.units.options.$get({ query: query ?? { start: '' } })),
    placeholderData: (previous) => previous,
  });
}

export function useResourceUnits(resourceId: string | undefined) {
  return useQuery({
    queryKey: unitKeys.ofResource(resourceId ?? ''),
    enabled: resourceId !== undefined,
    queryFn: async () =>
      ok(await api.resources[':id'].units.$get({ param: { id: resourceId ?? '' } })),
  });
}

/** After a write on a unit, every unit list, free list and count may have moved. */
export function useRefreshUnits() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.all });
}
