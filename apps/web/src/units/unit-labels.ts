import type { IssueJson, UnitDocumentJson, UnitDocumentsJson, UnitJson } from '@timon/http';
import type { Tone } from '@timon/ui';
import { entryLabel, inSentence } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { formatTime } from './unit-data.ts';

type Message = () => string;
export type MemberStatus = UnitDocumentsJson['status'];

export const memberStatusLabel: Record<MemberStatus, Message> = {
  missing: m.status_missing,
  expired: m.status_expired,
  expiring: m.status_expiring,
  valid: m.status_valid,
};

export const memberStatusTone: Record<MemberStatus, Tone> = {
  missing: 'conflict',
  expired: 'conflict',
  expiring: 'warning',
  valid: 'ok',
};

export const unitStateLabel: Record<UnitJson['state'], Message> = {
  future: m.unit_state_future,
  running: m.unit_state_running,
  ended: m.unit_state_ended,
};

export const unitStateTone: Record<UnitJson['state'], Tone> = {
  future: 'neutral',
  running: 'petrol',
  ended: 'neutral',
};

/** A document by the code of its type: "CPC", "Roadworthiness test". */
export const documentName = (d: Pick<UnitDocumentJson, 'code'>) =>
  entryLabel({ code: d.code, name: null });

/** "Expiring · CPC 12/12", "Missing · Driver card", or "Valid". */
export function documentsText(documents: UnitDocumentsJson): string {
  const label = memberStatusLabel[documents.status]();
  const worst = documents.worst;
  if (!worst) return label;
  const date = worst.expiresOn
    ? ` ${worst.expiresOn.slice(8, 10)}/${worst.expiresOn.slice(5, 7)}`
    : '';
  return `${label} · ${documentName(worst)}${date}`;
}

/** "06/10/2026 06:00 → open-ended". */
export function periodText(start: string, end: string | null): string {
  return `${formatTime(start, { year: true })} → ${end ? formatTime(end, { year: true }) : inSentence(m.open_ended())}`;
}

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** Why a resource cannot be chosen in the unit form, short: "Holds C1, needs CE". */
export function reasonText(reason: IssueJson): string {
  const params = reason.params ?? {};
  switch (reason.code) {
    case 'busy':
      return text(params.end)
        ? m.reason_busy_until({ unit: text(params.unit), end: formatTime(text(params.end)) })
        : m.reason_busy_since({ unit: text(params.unit), start: formatTime(text(params.start)) });
    case 'licence-missing':
      return text(params.holds)
        ? m.reason_licence({ holds: text(params.holds), needs: text(params.needs) })
        : m.reason_no_licence({ needs: text(params.needs) });
    case 'licence-not-supported':
      return m.reason_be();
    case 'semi-trailer-needs-tractor':
      return m.reason_semi_trailer();
    case 'drawbar-trailer-needs-rigid-truck':
      return m.reason_drawbar_trailer();
    case 'light-van-no-trailer':
      return m.reason_light_van();
    case 'subsidiary-mismatch':
      return m.reason_subsidiary();
    case 'resource-archived':
      return m.archived();
    default:
      return reason.code;
  }
}
