import type { ResourceKind, Severity, VehicleKind } from '@timon/domain';
import type { Tone } from '@timon/ui';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';

// Everything the API sends as a code becomes text here, in the interface's language.

type Message = () => string;
type ListEntry = { code: string | null; name: string | null };

export const kindLabel: Record<ResourceKind, Message> = {
  driver: m.kind_driver,
  'power-unit': m.kind_power_unit,
  trailer: m.kind_trailer,
};

export const vehicleKindLabel: Record<VehicleKind, Message> = {
  tractor: m.vehicle_kind_tractor,
  'rigid-truck': m.vehicle_kind_rigid_truck,
  'light-van': m.vehicle_kind_light_van,
  'semi-trailer': m.vehicle_kind_semi_trailer,
  'drawbar-trailer': m.vehicle_kind_drawbar_trailer,
};

const codeLabels: Record<string, Message> = {
  curtainsider: m.body_type_curtainsider,
  box: m.body_type_box,
  refrigerated: m.body_type_refrigerated,
  flatbed: m.body_type_flatbed,
  tipper: m.body_type_tipper,
  tanker: m.body_type_tanker,
  'tail-lift': m.capability_tail_lift,
  crane: m.capability_crane,
  'side-loading': m.capability_side_loading,
  'temperature-control': m.capability_temperature_control,
  'licence-b': m.document_licence_b,
  'licence-c1': m.document_licence_c1,
  'licence-c': m.document_licence_c,
  'licence-ce': m.document_licence_ce,
  'licence-c1e': m.document_licence_c1e,
  cpc: m.document_cpc,
  'driver-card': m.document_driver_card,
  'adr-certificate': m.document_adr_certificate,
  'health-check': m.document_health_check,
  roadworthiness: m.document_roadworthiness,
  tachograph: m.document_tachograph,
  atp: m.document_atp,
  'adr-approval': m.document_adr_approval,
};

/** An entry Timon provides is translated; an entry the haulier added is shown as typed. */
export function entryLabel(entry: ListEntry | undefined): string {
  if (!entry) return '';
  const translated = entry.code ? codeLabels[entry.code] : undefined;
  return translated?.() ?? entry.name ?? entry.code ?? '';
}

export const severityLabel: Record<Severity, Message> = {
  'expired-blocking': m.severity_expired_blocking,
  'expired-not-blocking': m.severity_expired_not_blocking,
  expiring: m.status_expiring,
  valid: m.status_valid,
};

/** Blocking and expired is red; expired but not blocking and expiring are orange. */
export const severityTone: Record<Severity, Tone> = {
  'expired-blocking': 'conflict',
  'expired-not-blocking': 'warning',
  expiring: 'warning',
  valid: 'ok',
};

export const textTone = (severity: Severity): 'warning' | 'conflict' | undefined => {
  const tone = severityTone[severity];
  return tone === 'ok' || tone === 'neutral' ? undefined : tone;
};

/** French and English both read dates day first: 06/10/2026. */
const dateLocale = () => (getLocale() === 'fr' ? 'fr-FR' : 'en-GB');

function utc(isoDate: string): Date {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  return new Intl.DateTimeFormat(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(isoDate));
}

export function formatMonth(isoDate: string): string {
  return new Intl.DateTimeFormat(dateLocale(), {
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(isoDate));
}

export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(isoDate));
}

/** "in 12 days", "4 days ago", "tomorrow": plurals come from the browser. */
export function formatDays(days: number): string {
  return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(days, 'day');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale()).format(value);
}

/** "Last name" → "last name", "A van" → "a van", but "GVW" and "SR-4480" stay. */
export function inSentence(label: string): string {
  return /^\p{Lu}(?![\p{Lu}\d])/u.test(label)
    ? label.charAt(0).toLocaleLowerCase() + label.slice(1)
    : label;
}

export function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function joinOr(values: readonly string[]): string {
  return values.length <= 1
    ? (values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} ${m.or()} ${values.at(-1)}`;
}
