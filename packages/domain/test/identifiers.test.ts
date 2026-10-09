import { describe, expect, it } from 'vitest';
import {
  isValidSiret,
  normaliseCustomerCode,
  normaliseSiret,
  sirenOf,
  vatFromSiren,
} from '../src/index.ts';

describe('isValidSiret', () => {
  it('criterion 1: 404 833 048 00015 is refused, 404 833 048 00014 is accepted', () => {
    expect(isValidSiret(normaliseSiret('404 833 048 00015'))).toBe(false);
    expect(isValidSiret(normaliseSiret('404 833 048 00014'))).toBe(true);
  });

  it('accepts the SIRETs of the mockups', () => {
    for (const siret of [
      '36227586900018',
      '53053041900015',
      '74900893400012',
      '35324611900013',
      '63122983800018',
      '62239003700019',
      '66520360000028',
      '48044056900014',
      '60272081500011',
      '30439547800015',
    ]) {
      expect(isValidSiret(siret), siret).toBe(true);
    }
  });

  it('applies the La Poste rule to SIREN 356000000: digits summing to a multiple of 5', () => {
    // 3+5+6+1+2+3+4+6 = 30: valid for La Poste, though the Luhn key would refuse it.
    expect(isValidSiret('35600000012346')).toBe(true);
    expect(isValidSiret('35600000012345')).toBe(false);
  });

  it('wants fourteen digits', () => {
    expect(isValidSiret('4048330480001')).toBe(false);
    expect(isValidSiret('40483304800014 ')).toBe(false);
    expect(isValidSiret('4048330480001A')).toBe(false);
  });
});

describe('vatFromSiren', () => {
  it('criterion 1: FR83404833048 for SIREN 404 833 048', () => {
    expect(vatFromSiren(sirenOf('40483304800014'))).toBe('FR83404833048');
  });

  it('writes the key on two digits', () => {
    expect(vatFromSiren('602720815')).toBe('FR07602720815');
  });
});

describe('normaliseCustomerCode', () => {
  it('criterion 3: "dupont-idf" and "DUPONT-IDF" are the same code', () => {
    expect(normaliseCustomerCode(' dupont-idf ')).toBe('DUPONT-IDF');
    expect(normaliseCustomerCode('dupont idf')).toBe('DUPONT-IDF');
  });
});
