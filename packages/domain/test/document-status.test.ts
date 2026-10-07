import { describe, expect, it } from 'vitest';
import {
  companyDay,
  documentStatus,
  resourceSeverity,
  severity,
  severityOrder,
  Temporal,
} from '../src/index.ts';

const date = (iso: string) => Temporal.PlainDate.from(iso);
const licenceCE = { expiresOn: date('2026-11-20'), warnDays: 60, blocking: true };

describe('documentStatus', () => {
  it('criterion 1: a CE licence expiring on 2026-11-20 is expiring on 2026-10-25', () => {
    const status = documentStatus(licenceCE.expiresOn, licenceCE.warnDays, date('2026-10-25'));
    expect(status).toBe('expiring');
    expect(resourceSeverity([{ status, blocking: true }])).toBe('expiring');
  });

  it('criterion 2: the same licence is expired on 2026-11-21', () => {
    const status = documentStatus(licenceCE.expiresOn, licenceCE.warnDays, date('2026-11-21'));
    expect(status).toBe('expired');
    expect(resourceSeverity([{ status, blocking: true }])).toBe('expired-blocking');
  });

  it('criterion 3: at 23:30 Paris time on the expiry day, the document is still expiring', () => {
    // 23:30 in Paris is 22:30 UTC in November (CET, UTC+1).
    const late = Temporal.Instant.from('2026-11-20T22:30:00Z');
    expect(companyDay(late).toString()).toBe('2026-11-20');
    expect(documentStatus(licenceCE.expiresOn, 60, companyDay(late))).toBe('expiring');
    // Half an hour later it is the 21st in Paris, though still the 20th in UTC.
    const midnight = Temporal.Instant.from('2026-11-20T23:00:00Z');
    expect(documentStatus(licenceCE.expiresOn, 60, companyDay(midnight))).toBe('expired');
  });

  it('criterion 8: with a 30-day warning, 5 and 20 days are expiring, 45 days is valid', () => {
    const today = date('2026-10-06');
    const status = (days: number) => documentStatus(today.add({ days }), 30, today);
    expect([status(-3), status(5), status(20), status(45)]).toEqual([
      'expired',
      'expiring',
      'expiring',
      'valid',
    ]);
  });

  it('criterion 12: an FCO expiring in 75 days is expiring, because the CPC warns 90 days ahead', () => {
    const today = date('2026-10-06');
    expect(documentStatus(today.add({ days: 75 }), 90, today)).toBe('expiring');
    expect(documentStatus(today.add({ days: 75 }), 30, today)).toBe('valid');
  });

  it('counts the warning period inclusively', () => {
    const today = date('2026-10-06');
    expect(documentStatus(today.add({ days: 30 }), 30, today)).toBe('expiring');
    expect(documentStatus(today.add({ days: 31 }), 30, today)).toBe('valid');
  });
});

describe('resource status', () => {
  it('orders expired blocking, expired not blocking, expiring, valid', () => {
    expect(severityOrder).toEqual([
      'expired-blocking',
      'expired-not-blocking',
      'expiring',
      'valid',
    ]);
  });

  it('criterion 4: an expired health check is expired but not blocking', () => {
    const healthCheck = { status: 'expired', blocking: false } as const;
    expect(severity(healthCheck)).toBe('expired-not-blocking');
    expect(resourceSeverity([{ status: 'valid', blocking: true }, healthCheck])).toBe(
      'expired-not-blocking',
    );
  });

  it('takes the worst document, whatever the order', () => {
    const expiring = { status: 'expiring', blocking: true } as const;
    const expiredWarning = { status: 'expired', blocking: false } as const;
    const expiredBlocking = { status: 'expired', blocking: true } as const;
    expect(resourceSeverity([expiring, expiredWarning])).toBe('expired-not-blocking');
    expect(resourceSeverity([expiredWarning, expiredBlocking, expiring])).toBe('expired-blocking');
    expect(resourceSeverity([expiring, { status: 'valid', blocking: false }])).toBe('expiring');
  });

  it('is valid without documents', () => {
    expect(resourceSeverity([])).toBe('valid');
  });
});
