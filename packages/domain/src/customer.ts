import { isCountry } from './countries.ts';
import { customerCodePattern, isValidSiret } from './identifiers.ts';
import { blank, type Issue } from './issue.ts';

export type ContactDetails = {
  readonly name: string;
  readonly role: string | null;
  readonly phone: string | null;
  readonly email: string | null;
};

/** A customer belongs to the company, not to a subsidiary: a chartered order keeps it. */
export type CustomerDetails = {
  readonly name: string;
  readonly code: string;
  readonly country: string;
  readonly siret: string | null;
  readonly vatNumber: string | null;
  readonly billingStreet1: string | null;
  readonly billingStreet2: string | null;
  readonly billingPostcode: string | null;
  readonly billingCity: string | null;
  readonly notes: string | null;
  readonly contacts: readonly ContactDetails[];
  /** The sites it usually uses, from the company's address book. */
  readonly siteIds: readonly string[];
};

// Enough to catch a typo, not a validation of the address itself.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rule 3: a contact has a name and can be reached, by phone or by email. */
export function checkContact(contact: ContactDetails, index: number): Issue[] {
  const issues: Issue[] = [];
  if (blank(contact.name)) issues.push({ field: `contacts.${index}.name`, code: 'required' });
  if (blank(contact.phone) && blank(contact.email)) {
    issues.push({ field: `contacts.${index}`, code: 'contact-unreachable' });
  }
  if (!blank(contact.email) && !emailPattern.test(contact.email?.trim() ?? '')) {
    issues.push({ field: `contacts.${index}.email`, code: 'email-invalid' });
  }
  return issues;
}

/** The rules a customer follows on its own; uniqueness needs the other customers. */
export function checkCustomer(customer: CustomerDetails): Issue[] {
  const issues: Issue[] = [];
  if (blank(customer.name)) issues.push({ field: 'name', code: 'required' });
  if (blank(customer.code)) issues.push({ field: 'code', code: 'required' });
  else if (!customerCodePattern.test(customer.code)) {
    issues.push({ field: 'code', code: 'code-invalid' });
  }
  if (!isCountry(customer.country)) issues.push({ field: 'country', code: 'country-unknown' });
  if (customer.siret !== null) {
    if (customer.country !== 'FR') issues.push({ field: 'siret', code: 'siret-not-french' });
    else if (!isValidSiret(customer.siret)) issues.push({ field: 'siret', code: 'siret-invalid' });
  }
  if (
    customer.country === 'FR' &&
    customer.billingPostcode !== null &&
    !/^\d{5}$/.test(customer.billingPostcode)
  ) {
    issues.push({ field: 'billingPostcode', code: 'postcode-invalid' });
  }
  customer.contacts.forEach((contact, index) => {
    issues.push(...checkContact(contact, index));
  });
  return issues;
}
