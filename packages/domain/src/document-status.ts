import type { Temporal } from './temporal.ts';

export const documentStatuses = ['valid', 'expiring', 'expired'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

/** The company's time zone (rule 4). There is one company for now. */
export const companyTimeZone = 'Europe/Paris';

/** The calendar day it is at `now` in the company's time zone. */
export function companyDay(now: Temporal.Instant, timeZone = companyTimeZone): Temporal.PlainDate {
  return now.toZonedDateTimeISO(timeZone).toPlainDate();
}

/** Days from `day` to `expiresOn`; negative once expired. */
export function daysUntil(expiresOn: Temporal.PlainDate, day: Temporal.PlainDate): number {
  return day.until(expiresOn, { largestUnit: 'day' }).days;
}

/**
 * Status of a document on a day. A document expires at the end of its expiry day (rule 4), so
 * it is still *expiring* on that day; it is *expiring* from `warnDays` days before.
 */
export function documentStatus(
  expiresOn: Temporal.PlainDate,
  warnDays: number,
  day: Temporal.PlainDate,
): DocumentStatus {
  const remaining = daysUntil(expiresOn, day);
  if (remaining < 0) return 'expired';
  return remaining <= warnDays ? 'expiring' : 'valid';
}

export type DocumentState = { readonly status: DocumentStatus; readonly blocking: boolean };

/**
 * From worst to best. An expired blocking document makes the resource unavailable; an expired
 * non-blocking one only warns, so it ranks below it but above a document about to expire.
 */
export const severityOrder = [
  'expired-blocking',
  'expired-not-blocking',
  'expiring',
  'valid',
] as const;
export type Severity = (typeof severityOrder)[number];

export function severity({ status, blocking }: DocumentState): Severity {
  if (status === 'expired') return blocking ? 'expired-blocking' : 'expired-not-blocking';
  return status;
}

/** Sorts worst first. */
export function compareSeverity(a: Severity, b: Severity): number {
  return severityOrder.indexOf(a) - severityOrder.indexOf(b);
}

/** The status of a resource: the worst of its documents; valid when it has none. */
export function resourceSeverity(documents: readonly DocumentState[]): Severity {
  return documents
    .map(severity)
    .reduce<Severity>(
      (worst, current) => (compareSeverity(current, worst) < 0 ? current : worst),
      'valid',
    );
}
