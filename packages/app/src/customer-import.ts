import { parseCountry } from './countries.ts';
import { type CsvColumn, csvTemplate, type FileProblem, readCsv } from './csv.ts';
import { type CustomerOwner, checkCustomerInput, normaliseCustomer, owner } from './customers.ts';
import {
  CustomerCodeTakenError,
  type CustomerInput,
  type Ports,
  SiretTakenError,
} from './ports.ts';
import type { FieldIssue } from './resources.ts';

const column = (field: string, en: string, fr: string, required = false): CsvColumn => ({
  field,
  en,
  fr,
  required,
});

/** One line per customer, with at most one contact; more contacts are added in the form. */
export const customerColumns: readonly CsvColumn[] = [
  column('code', 'code', 'code', true),
  column('name', 'name', 'raison_sociale', true),
  column('country', 'country', 'pays'),
  column('siret', 'siret', 'siret'),
  column('vatNumber', 'vat_number', 'numero_tva'),
  column('billingStreet1', 'billing_street', 'adresse_facturation'),
  column('billingStreet2', 'billing_street2', 'complement_adresse'),
  column('billingPostcode', 'billing_postcode', 'code_postal'),
  column('billingCity', 'billing_city', 'ville'),
  column('notes', 'notes', 'notes'),
  column('contacts.0.name', 'contact_name', 'contact_nom'),
  column('contacts.0.role', 'contact_role', 'contact_fonction'),
  column('contacts.0.phone', 'contact_phone', 'contact_telephone'),
  column('contacts.0.email', 'contact_email', 'contact_email'),
];

export type CustomerImportIssue =
  | FieldIssue
  | {
      readonly field: string;
      readonly code: 'code-taken' | 'siret-taken';
      readonly params: { readonly owner: CustomerOwner };
    }
  | {
      readonly field: string;
      readonly code: 'code-duplicated' | 'siret-duplicated';
      readonly params: { readonly line: number };
    };

export type CustomerImportRow = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: readonly CustomerImportIssue[];
};

export type CustomerImportCheck = {
  readonly problem: FileProblem | null;
  readonly rows: readonly CustomerImportRow[];
  readonly summary: {
    readonly lines: number;
    readonly valid: number;
    readonly invalid: number;
    readonly alreadyInTimon: number;
    readonly contacts: number;
  };
  readonly ready: boolean;
};

export function customerTemplate(language: 'en' | 'fr') {
  return csvTemplate(customerColumns, language);
}

const emptyCheck = (problem: FileProblem): CustomerImportCheck => ({
  problem,
  rows: [],
  summary: { lines: 0, valid: 0, invalid: 0, alreadyInTimon: 0, contacts: 0 },
  ready: false,
});

async function parse(ports: Ports, csv: string) {
  const read = readCsv(csv, customerColumns);
  if ('problem' in read) return { check: emptyCheck(read.problem), customers: [] };

  const firstCode = new Map<string, number>();
  const firstSiret = new Map<string, number>();
  let alreadyInTimon = 0;
  const rows: (CustomerImportRow & { customer: CustomerInput | null })[] = [];

  for (const { line, cells } of read.lines) {
    const value = (field: string) => cells[field] ?? '';
    const issues: CustomerImportIssue[] = [];
    const country = parseCountry(value('country'));
    if (country === undefined) {
      issues.push({ field: 'country', code: 'unknown-value', params: { value: value('country') } });
    }
    const contactCells = ['name', 'role', 'phone', 'email'].map((f) => value(`contacts.0.${f}`));
    const customer = normaliseCustomer({
      code: value('code'),
      name: value('name'),
      country: country ?? 'FR',
      siret: value('siret'),
      vatNumber: value('vatNumber'),
      billingStreet1: value('billingStreet1'),
      billingStreet2: value('billingStreet2'),
      billingPostcode: value('billingPostcode'),
      billingCity: value('billingCity'),
      notes: value('notes'),
      contacts: contactCells.some((c) => c !== '')
        ? [
            {
              name: value('contacts.0.name'),
              role: value('contacts.0.role'),
              phone: value('contacts.0.phone'),
              email: value('contacts.0.email'),
            },
          ]
        : [],
      siteIds: [],
    });
    issues.push(...(await checkCustomerInput(ports, customer)));

    if (issues.length === 0) {
      const earlierCode = firstCode.get(customer.code);
      const taken = await ports.customers.findByCode(customer.code);
      if (earlierCode !== undefined) {
        issues.push({ field: 'code', code: 'code-duplicated', params: { line: earlierCode } });
      } else {
        firstCode.set(customer.code, line);
      }
      if (taken)
        issues.push({ field: 'code', code: 'code-taken', params: { owner: owner(taken) } });
      if (customer.siret) {
        const earlierSiret = firstSiret.get(customer.siret);
        const takenSiret = await ports.customers.findActiveBySiret(customer.siret);
        if (earlierSiret !== undefined) {
          issues.push({ field: 'siret', code: 'siret-duplicated', params: { line: earlierSiret } });
        } else {
          firstSiret.set(customer.siret, line);
        }
        if (takenSiret) {
          issues.push({
            field: 'siret',
            code: 'siret-taken',
            params: { owner: owner(takenSiret) },
          });
        }
      }
      if (taken) alreadyInTimon += 1;
    }
    rows.push({ line, cells, issues, customer: issues.length === 0 ? customer : null });
  }

  const invalid = rows.filter((r) => r.issues.length > 0).length;
  const check: CustomerImportCheck = {
    problem: null,
    rows: rows.map(({ customer: _, ...row }) => row),
    summary: {
      lines: rows.length,
      valid: rows.length - invalid,
      invalid,
      alreadyInTimon,
      contacts: rows.reduce((sum, r) => sum + (r.customer?.contacts.length ?? 0), 0),
    },
    ready: invalid === 0,
  };
  return { check, customers: rows.flatMap((r) => (r.customer ? [r.customer] : [])) };
}

/** The preview: every line with its issues. Nothing is written. */
export async function checkCustomerImport(ports: Ports, csv: string) {
  return (await parse(ports, csv)).check;
}

export type CustomerImportResult =
  | { readonly ok: true; readonly imported: number }
  | { readonly ok: false; readonly check: CustomerImportCheck };

/** Rule 7: all or nothing. */
export async function importCustomers(ports: Ports, csv: string): Promise<CustomerImportResult> {
  const { check, customers } = await parse(ports, csv);
  if (!check.ready) return { ok: false, check };
  try {
    return { ok: true, imported: await ports.customers.createMany(customers) };
  } catch (error) {
    if (error instanceof CustomerCodeTakenError || error instanceof SiretTakenError) {
      return { ok: false, check: await checkCustomerImport(ports, csv) };
    }
    throw error;
  }
}
