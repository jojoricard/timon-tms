import { describe, expect, it } from 'vitest';
import { type CustomerDetails, checkCustomer } from '../src/index.ts';

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

  it('wants a name, a code in capitals and a known country', () => {
    expect(codes({ ...customer, name: ' ', code: 'dupont mat', country: 'XX' })).toEqual([
      'name:required',
      'code:code-invalid',
      'country:country-unknown',
      'siret:siret-not-french',
    ]);
  });
});
