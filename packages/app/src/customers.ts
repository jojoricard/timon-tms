import {
  checkCustomer,
  companyDay,
  normaliseCustomerCode,
  normaliseSiret,
  type Temporal,
} from '@timon/domain';
import {
  type ContactInput,
  CustomerCodeTakenError,
  type CustomerInput,
  type Ports,
  SiretTakenError,
  type StoredCustomer,
} from './ports.ts';
import type { FieldIssue } from './resources.ts';
import { searchable } from './search.ts';
import { type SiteView, siteView } from './sites.ts';

/** The customer that already has a code or a SIRET (rule 1). */
export type CustomerOwner = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly archived: boolean;
};

export type CustomerView = StoredCustomer & {
  /** Its usual sites, with today's hours in each site's time zone. */
  readonly sites: readonly SiteView[];
};

export type CustomerResult =
  | { readonly ok: true; readonly customer: CustomerView }
  | { readonly ok: false; readonly reason: 'not-found' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] }
  | {
      readonly ok: false;
      readonly reason: 'code-taken' | 'siret-taken';
      readonly owner: CustomerOwner;
    };

export const owner = (c: StoredCustomer): CustomerOwner => ({
  id: c.id,
  code: c.code,
  name: c.name,
  archived: c.archived,
});

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const cleanContact = (contact: ContactInput): ContactInput => ({
  ...(contact.id ? { id: contact.id } : {}),
  name: contact.name.trim(),
  role: clean(contact.role),
  phone: clean(contact.phone),
  email: clean(contact.email),
});

/** Code in capitals, SIRET without spaces, empty text as nothing. */
export function normaliseCustomer(input: CustomerInput): CustomerInput {
  const siret = clean(input.siret);
  return {
    ...input,
    name: input.name.trim(),
    code: normaliseCustomerCode(input.code),
    country: input.country.trim().toUpperCase(),
    siret: siret === null ? null : normaliseSiret(siret),
    vatNumber: clean(input.vatNumber)?.replace(/\s/g, '').toUpperCase() ?? null,
    billingStreet1: clean(input.billingStreet1),
    billingStreet2: clean(input.billingStreet2),
    billingPostcode: clean(input.billingPostcode),
    billingCity: clean(input.billingCity),
    notes: clean(input.notes),
    contacts: input.contacts.map(cleanContact),
    siteIds: [...new Set(input.siteIds)],
  };
}

/** The rules of the domain, and that every usual site exists. */
export async function checkCustomerInput(ports: Ports, customer: CustomerInput) {
  const issues: FieldIssue[] = [...checkCustomer(customer)];
  if (customer.siteIds.length > 0) {
    const sites = await ports.sites.list({ includeArchived: true });
    if (customer.siteIds.some((id) => !sites.some((s) => s.id === id))) {
      issues.push({ field: 'siteIds', code: 'unknown-value' });
    }
  }
  return issues;
}

async function view(ports: Ports, customer: StoredCustomer): Promise<CustomerView> {
  const now = ports.clock.now();
  const sites = await ports.sites.list({ includeArchived: true });
  return {
    ...customer,
    sites: customer.siteIds.flatMap((id) => {
      const site = sites.find((s) => s.id === id);
      return site ? [siteView(site, now)] : [];
    }),
  };
}

/** Rule 1, checked here to name the customer; the database refuses it too. */
async function takenBy(ports: Ports, customer: CustomerInput, exceptId?: string) {
  const byCode = await ports.customers.findByCode(customer.code, exceptId);
  if (byCode) return { reason: 'code-taken' as const, owner: owner(byCode) };
  const bySiret = customer.siret
    ? await ports.customers.findActiveBySiret(customer.siret, exceptId)
    : undefined;
  if (bySiret) return { reason: 'siret-taken' as const, owner: owner(bySiret) };
  return undefined;
}

async function save(
  ports: Ports,
  input: CustomerInput,
  write: (customer: CustomerInput) => Promise<StoredCustomer | undefined>,
  exceptId?: string,
): Promise<CustomerResult> {
  const customer = normaliseCustomer(input);
  const issues = await checkCustomerInput(ports, customer);
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  const taken = await takenBy(ports, customer, exceptId);
  if (taken) return { ok: false, ...taken };
  try {
    const saved = await write(customer);
    return saved
      ? { ok: true, customer: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    // Another customer took the code or the SIRET since the check: the database refused it.
    if (error instanceof CustomerCodeTakenError || error instanceof SiretTakenError) {
      const now = await takenBy(ports, customer, exceptId);
      if (now) return { ok: false, ...now };
    }
    throw error;
  }
}

export function createCustomer(ports: Ports, input: CustomerInput) {
  return save(ports, input, (c) => ports.customers.create(c));
}

/** Contacts left out are deleted (rule 3); the usual sites are replaced. */
export async function updateCustomer(
  ports: Ports,
  id: string,
  input: CustomerInput,
): Promise<CustomerResult> {
  if (!(await ports.customers.get(id))) return { ok: false, reason: 'not-found' };
  return save(ports, input, (c) => ports.customers.update(id, c), id);
}

export async function getCustomer(ports: Ports, id: string) {
  const customer = await ports.customers.get(id);
  return customer ? view(ports, customer) : undefined;
}

/**
 * Rule 6: never deleted, only archived. Archiving a customer leaves its usual sites active:
 * other customers may use them.
 */
export async function setCustomerArchived(
  ports: Ports,
  id: string,
  archived: boolean,
): Promise<CustomerResult> {
  const existing = await ports.customers.get(id);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (!archived && existing.siret) {
    const other = await ports.customers.findActiveBySiret(existing.siret, id);
    if (other) return { ok: false, reason: 'siret-taken', owner: owner(other) };
  }
  try {
    const saved = await ports.customers.setArchived(id, archived);
    return saved
      ? { ok: true, customer: await view(ports, saved) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    if (!(error instanceof SiretTakenError) || !existing.siret) throw error;
    const other = await ports.customers.findActiveBySiret(existing.siret, id);
    if (other) return { ok: false, reason: 'siret-taken', owner: owner(other) };
    throw error;
  }
}

export const countryFilters = ['all', 'france', 'abroad'] as const;
export type CountryFilter = (typeof countryFilters)[number];

export type CustomerList = {
  readonly day: Temporal.PlainDate;
  readonly counts: Readonly<Record<CountryFilter, number>>;
  readonly customers: readonly StoredCustomer[];
};

/** Customers by code, searched by name, code or SIRET. */
export async function listCustomers(
  ports: Ports,
  options: { query?: string; country?: CountryFilter; includeArchived?: boolean } = {},
): Promise<CustomerList> {
  const query = searchable(options.query?.trim() ?? '');
  const customers = (
    await ports.customers.list({ includeArchived: options.includeArchived ?? false })
  )
    .filter((c) => {
      if (query === '') return true;
      const haystack = searchable(`${c.code} ${c.name} ${c.siret ?? ''}`);
      return query
        .split(/\s+/)
        .every((word) => haystack.includes(word) || haystack.includes(word.replace(/\s/g, '')));
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  const france = customers.filter((c) => c.country === 'FR');
  const counts = {
    all: customers.length,
    france: france.length,
    abroad: customers.length - france.length,
  };
  const country = options.country ?? 'all';
  return {
    day: companyDay(ports.clock.now()),
    counts,
    customers:
      country === 'all'
        ? customers
        : customers.filter((c) => (country === 'france') === (c.country === 'FR')),
  };
}

/** Active customers and sites, for the tabs. */
export async function customerSummary(ports: Ports) {
  const [customers, sites] = await Promise.all([
    ports.customers.list({ includeArchived: false }),
    ports.sites.list({ includeArchived: false }),
  ]);
  return { customers: customers.length, sites: sites.length };
}
