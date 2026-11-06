import { afterEach, describe, expect, it } from 'vitest';
import { issueSentence } from '../src/issues.ts';
import { overwriteGetLocale } from '../src/paraglide/runtime.js';

// Refusals read as sentences in the product's language.

const inLocale = (locale: 'en' | 'fr') => overwriteGetLocale(() => locale);

afterEach(() => inLocale('en'));

describe('category and weight (SPEC-001 rule 2)', () => {
  const n3 = {
    field: 'category',
    code: 'category-weight-mismatch',
    params: { category: 'N3', gvwKg: 7_500, overKg: 12_000 },
  };
  const o3 = {
    field: 'category',
    code: 'category-weight-mismatch',
    params: { category: 'O3', gvwKg: 34_000, overKg: 3_500, upToKg: 10_000 },
  };

  it('criterion 14: says that N3 is over 12,000 kg', () => {
    inLocale('en');
    expect(issueSentence(n3)).toBe('N3 is over 12,000 kg, and this vehicle weighs 7,500 kg');
    expect(issueSentence(o3)).toBe(
      'O3 is over 3,500 kg and up to 10,000 kg, and this vehicle weighs 34,000 kg',
    );
  });

  it('says it in French', () => {
    inLocale('fr');
    expect(issueSentence(n3).replace(/\s/g, ' ')).toBe(
      'N3 est au-dessus de 12 000 kg, et ce véhicule pèse 7 500 kg',
    );
  });
});
