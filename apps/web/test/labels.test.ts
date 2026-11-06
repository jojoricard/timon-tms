import { afterEach, describe, expect, it } from 'vitest';
import { weekdayName } from '../src/customers/customer-labels.ts';
import { formatDate, formatLongDate, formatMonth } from '../src/labels.ts';
import { m } from '../src/paraglide/messages.js';
import { overwriteGetLocale } from '../src/paraglide/runtime.js';
import { formatTime } from '../src/units/unit-data.ts';

// The day of a status reads in full, and counts agree with their number, in each language.

const inLocale = (locale: 'en' | 'fr') => overwriteGetLocale(() => locale);

afterEach(() => inLocale('en'));

describe('the long date', () => {
  it('names the day and the month in full in French', () => {
    inLocale('fr');
    expect(formatLongDate('2026-11-05')).toBe('jeudi 5 novembre 2026');
    expect(m.list_footer({ shown: 3, total: 9, date: formatLongDate('2026-11-05') })).toContain(
      'statut au jeudi 5 novembre 2026',
    );
  });

  it('names the day and the month in full in English, day first', () => {
    inLocale('en');
    expect(formatLongDate('2026-11-05')).toBe('Thursday 5 November 2026');
    expect(m.list_footer({ shown: 3, total: 9, date: formatLongDate('2026-11-05') })).toContain(
      'status on Thursday 5 November 2026',
    );
  });
});

describe('counts', () => {
  const footers = [m.list_footer, m.customers_footer, m.sites_footer];

  it('agree with one in French', () => {
    inLocale('fr');
    for (const footer of footers) {
      expect(footer({ shown: 1, total: 1, date: '' })).toMatch(/^1 sur 1 affiché /);
      expect(footer({ shown: 2, total: 5, date: '' })).toMatch(/^2 sur 5 affichés /);
    }
    expect(m.pe_held({ held: 1, total: 5 })).toBe('1 sur 5 détenu');
    expect(m.units_subtitle({ count: 1 })).toMatch(/^1 valide /);
    expect(m.rule_warns({ days: 1 })).toBe('alerte 1 jour avant');
    expect(m.rule_warns({ days: 30 })).toBe('alerte 30 jours avant');
    expect(m.imported({ count: 1 })).toBe('Importé : 1. Il figure maintenant dans la liste.');
  });

  it('agree with one in English', () => {
    inLocale('en');
    expect(m.rule_warns({ days: 1 })).toBe('warns 1 day ahead');
    expect(m.note_warns({ days: 1 })).toBe('Warns 1 day ahead');
    expect(m.document_rule({ type: 'Licence', rule: 'blocking', days: 1 })).toBe(
      'Licence: blocking, warns 1 day ahead.',
    );
    expect(m.imported({ count: 1 })).toBe('Imported: 1. It is now in the list.');
    expect(m.imported({ count: 2 })).toBe('Imported: 2. They are now in the list.');
  });
});

describe('British dates in English (SPEC-001, Screens)', () => {
  it('writes the day before the month, never the American way', () => {
    inLocale('en');
    expect(formatDate('2026-11-05')).toBe('05/11/2026');
    expect(formatMonth('2026-11-05')).toBe('11/2026');
    expect(formatLongDate('2026-11-05')).toBe('Thursday 5 November 2026');
    expect(formatTime('2026-11-05T05:00:00Z', { year: true })).toBe('05/11/2026 06:00');
    expect(weekdayName(4)).toBe('Thursday');
  });
});
