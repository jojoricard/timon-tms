/**
 * SPEC-001 rule 10: eight digits at least; besides digits, only spaces, dots, dashes,
 * parentheses and a leading "+". Shared by drivers and the contacts of customers.
 */
export function isValidPhone(phone: string): boolean {
  const value = phone.trim();
  if (!/^\+?[\d\s.()-]+$/.test(value)) return false;
  return (value.match(/\d/g)?.length ?? 0) >= 8;
}

/** "404 833 048 00014" → "40483304800014": spaces and dots are only for reading. */
export function normaliseSiret(value: string): string {
  return value.replace(/[\s. ]/g, '');
}

// Establishments of La Poste share one SIREN and do not follow the Luhn key: the sum of the
// fourteen digits of their SIRET must be a multiple of 5 instead.
const laPosteSiren = '356000000';

const digits = (value: string) => [...value].map(Number);

function luhn(value: string): boolean {
  const sum = digits(value)
    .reverse()
    .reduce((total, digit, index) => {
      if (index % 2 === 0) return total + digit;
      const doubled = digit * 2;
      return total + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);
  return sum % 10 === 0;
}

/** Rule 2: fourteen digits and a valid check digit. */
export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  if (siret.startsWith(laPosteSiren)) {
    return digits(siret).reduce((a, b) => a + b, 0) % 5 === 0;
  }
  return luhn(siret);
}

export function sirenOf(siret: string): string {
  return siret.slice(0, 9);
}

/** The French intra-community VAT number of a SIREN: FR, a two-digit key, the SIREN. */
export function vatFromSiren(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

/**
 * SPEC-002 rule 2. For a French customer: FR, two characters, nine digits; when the two
 * characters are digits, they are the key computed from the nine. For another country: two
 * letters, then 2 to 13 letters or digits. The number is compared in capitals, without spaces.
 */
export function isValidVatNumber(vatNumber: string, country: string): boolean {
  const value = vatNumber.replace(/\s/g, '').toUpperCase();
  if (country !== 'FR') return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(value);
  const french = /^FR([A-Z0-9]{2})(\d{9})$/.exec(value);
  if (!french) return false;
  const [, key = '', siren = ''] = french;
  return /^\d{2}$/.test(key) ? vatFromSiren(siren) === value : true;
}

/** Upper case, spaces as dashes: "dupont idf" → "DUPONT-IDF". */
export function normaliseCustomerCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '-');
}

/** A letter or digit first, then letters, digits and dashes; twenty characters at most. */
export const customerCodePattern = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
