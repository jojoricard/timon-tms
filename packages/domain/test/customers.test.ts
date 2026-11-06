import { describe, expect, it } from 'vitest';
import { type CustomerDetails, checkCustomer, isValidVatNumber } from '../src/index.ts';

const customer: CustomerDetails = {
  name: 'Dupont Matériaux SAS',
  code: 'DUPONT-MAT',
  country: 'FR',
  siret: '74900893400012',
  vatNumber: 'FR86749008934',
  billingStreet1: '8 rue du Lyonnais',
  billingStreet2: null,
  billingPostcode: '69200',
  billingCity: 'Vénissieux',
  notes: null,
  contacts: [
    { name: 'Sandrine Dupont', role: 'Transport manager', phone: '04 78 70 21 45', email: null },
  ],
  siteIds: [],
};

const codes = (c: CustomerDetails) => checkCustomer(c).map((i) => `${i.field}:${i.code}`);

describe('checkCustomer', () => {
  it('accepts the customer of the mockup', () => {
    expect(checkCustomer(customer)).toEqual([]);
  });

  it('criterion 1: refuses a SIRET with a wrong check digit', () => {
    expect(codes({ ...customer, siret: '40483304800015' })).toEqual(['siret:siret-invalid']);
  });

  it('keeps the SIRET for French customers', () => {
    expect(codes({ ...customer, country: 'IT', billingPostcode: '10156' })).toEqual([
      'siret:siret-not-french',
    ]);
  });

  it('criterion 4: a contact with a name only needs a phone or an email', () => {
    const contacts = [
      ...customer.contacts,
      { name: 'Yanis Mercier', role: 'Yard', phone: null, email: null },
    ];
    expect(codes({ ...customer, contacts })).toEqual(['contacts.1:contact-unreachable']);
  });

  it('SPEC-002 criterion 18: the phone "zz" is refused and does not reach the contact', () => {
    const contacts = [{ name: 'Yanis Mercier', role: null, phone: 'zz', email: null }];
    expect(codes({ ...customer, contacts })).toEqual([
      'contacts.0:contact-unreachable',
      'contacts.0.phone:phone-invalid',
    ]);
    const reachable = [{ name: 'Yanis Mercier', role: null, phone: 'zz', email: 'y@m.fr' }];
    expect(codes({ ...customer, contacts: reachable })).toEqual(['contacts.0.phone:phone-invalid']);
  });

  it('checks the shape of an email, quickly whatever its length', () => {
    const withEmail = (email: string) => ({
      ...customer,
      contacts: [{ name: 'Sandrine Dupont', role: null, phone: null, email }],
    });
    for (const email of ['s.dupont@dupont-materiaux.fr', 'a@b.co', 'x@sub.domain.fr']) {
      expect(codes(withEmail(email))).toEqual([]);
    }
    for (const email of ['dupont', '@b.fr', 'a@b', 'a@.fr', 'a@b.', 'a@b@c.fr', 'a b@c.fr']) {
      expect(codes(withEmail(email))).toEqual(['contacts.0.email:email-invalid']);
    }
    const start = Date.now();
    expect(codes(withEmail(`!@!.${'!.'.repeat(50_000)}@`))).toEqual([
      'contacts.0.email:email-invalid',
    ]);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('criterion 17: a German VAT number is accepted, "FR00MANUEL" is refused in France', () => {
    const german = { ...customer, country: 'DE', siret: null, billingPostcode: '10178' };
    expect(codes({ ...german, vatNumber: 'DE123456789' })).toEqual([]);
    expect(codes({ ...customer, vatNumber: 'FR00MANUEL' })).toEqual(['vatNumber:vat-invalid']);
  });

  it('criterion 16: a German customer saves once the SIRET and the French VAT are gone', () => {
    const german = { ...customer, country: 'DE', billingPostcode: '10178' };
    expect(codes({ ...german, siret: null, vatNumber: null })).toEqual([]);
  });

  it('wants a name, a code in capitals and a known country', () => {
    expect(codes({ ...customer, name: ' ', code: 'dupont mat', country: 'XX' })).toEqual([
      'name:required',
      'code:code-invalid',
      'country:country-unknown',
      'siret:siret-not-french',
    ]);
  });
});

describe('isValidVatNumber (rule 2)', () => {
  it('checks the key of a French number when it is made of digits', () => {
    expect(isValidVatNumber('FR83404833048', 'FR')).toBe(true);
    expect(isValidVatNumber('FR84404833048', 'FR')).toBe(false);
    expect(isValidVatNumber('FRA1404833048', 'FR')).toBe(true);
    expect(isValidVatNumber('FR8340483304', 'FR')).toBe(false);
    expect(isValidVatNumber('DE123456789', 'FR')).toBe(false);
  });

  it('takes two letters then 2 to 13 letters or digits for another country', () => {
    expect(isValidVatNumber('DE123456789', 'DE')).toBe(true);
    expect(isValidVatNumber('ATU12345678', 'AT')).toBe(true);
    expect(isValidVatNumber('NL123456789B01', 'NL')).toBe(true);
    expect(isValidVatNumber('D1123', 'DE')).toBe(false);
    expect(isValidVatNumber('DE1', 'DE')).toBe(false);
    expect(isValidVatNumber('DE12345678901234', 'DE')).toBe(false);
  });
});
