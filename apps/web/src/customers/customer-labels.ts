import type { LocatedBy } from '@timon/domain';
import type { ListItemJson, OpeningJson, SiteJson } from '@timon/http';
import type { Tone } from '@timon/ui';
import { formatNumber, inSentence } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';

type Message = () => string;

export const locatedByLabel: Record<LocatedBy, Message> = {
  address: m.located_address,
  street: m.located_street,
  city: m.located_city,
  'by-hand': m.located_by_hand,
  'not-located': m.located_not,
};

/** Exact is green, approximate is orange, by hand is petrol, missing is grey. */
export const locatedByTone: Record<LocatedBy, Tone | 'petrol'> = {
  address: 'ok',
  street: 'warning',
  city: 'warning',
  'by-hand': 'petrol',
  'not-located': 'neutral',
};

export const bookingMethodLabel: Record<string, Message> = {
  phone: m.booking_method_phone,
  email: m.booking_method_email,
  portal: m.booking_method_portal,
};

const equipmentLabels: Record<string, [Message, Message]> = {
  'safety-shoes': [m.pe_safety_shoes, m.pe_short_safety_shoes],
  'high-visibility-vest': [m.pe_high_visibility_vest, m.pe_short_high_visibility_vest],
  'hard-hat': [m.pe_hard_hat, m.pe_short_hard_hat],
  'safety-glasses': [m.pe_safety_glasses, m.pe_short_safety_glasses],
  gloves: [m.pe_gloves, m.pe_short_gloves],
};

/** Full name for a form, short name for a tag in a table; a company's own entry as typed. */
export function equipmentLabel(item: ListItemJson | undefined, short = false): string {
  if (!item) return '';
  const labels = item.code ? equipmentLabels[item.code] : undefined;
  return labels?.[short ? 1 : 0]() ?? item.name ?? item.code ?? '';
}

/** Monday is 1, as in ISO and in the API. */
export function weekdayName(weekday: number, width: 'long' | 'short' = 'long'): string {
  // 5 January 2026 is a Monday.
  const date = new Date(Date.UTC(2026, 0, 4 + weekday));
  return new Intl.DateTimeFormat(getLocale(), { weekday: width, timeZone: 'UTC' }).format(date);
}

export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatRange(range: Pick<OpeningJson, 'startMinute' | 'endMinute'>): string {
  return `${formatTime(range.startMinute)}–${formatTime(range.endMinute)}`;
}

/** "06:00–12:00 · 13:00–17:30", or "Closed". */
export function formatDay(openings: readonly OpeningJson[]): string {
  if (openings.length === 0) return m.closed();
  return [...openings]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map(formatRange)
    .join(' · ');
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "≤ 12 m · no semi", "≤ 19 t · no dock", "Dock". */
export function accessSummary(site: SiteJson): string {
  const parts: string[] = [];
  if (site.maxLengthCm)
    parts.push(m.access_max_length({ value: formatNumber(site.maxLengthCm / 100) }));
  if (site.maxWeightKg)
    parts.push(m.access_max_weight({ value: formatNumber(site.maxWeightKg / 1000) }));
  if (!site.semiTrailersAccepted) parts.push(m.access_no_semi());
  if (!site.loadingDock) parts.push(m.access_no_dock());
  // "≤ 10 m · no dock": only the first part keeps its capital.
  return parts.length > 0
    ? parts.map((part, i) => (i === 0 ? part : inSentence(part))).join(' · ')
    : m.access_dock();
}

/** "Booking · portal", or the access summary alone. */
export function accessAndBooking(site: SiteJson): string {
  const booking = site.bookingRequired
    ? `${m.col_booking()} · ${bookingMethodLabel[site.bookingMethod ?? '']?.().toLocaleLowerCase(getLocale()) ?? ''}`
    : null;
  return [booking, accessSummary(site)].filter(Boolean).join(' · ');
}
