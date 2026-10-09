import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  checkCustomer,
  companyDay,
  countries,
  type Issue,
  isValidSiret,
  normaliseSiret,
  sirenOf,
  Temporal,
  vatFromSiren,
} from '@timon/domain';
import type {
  CustomerInputJson,
  CustomerOwnerJson,
  CustomerWithSitesJson,
  IssueJson,
  OpeningJson,
  SiteJson,
} from '@timon/http';
import { Banner, Button, Field, Plate } from '@timon/ui';
import { type FormEvent, useId, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText, useReferenceLists } from '../data.ts';
import { failureText, issueSentence } from '../issues.ts';
import { capitalise } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { Breadcrumb } from '../resources/section.tsx';
import {
  customerKeys,
  useCustomer,
  useDebounced,
  useRefreshCustomers,
  useSites,
} from './customer-data.ts';
import { accessAndBooking, countryName, weekdayName } from './customer-labels.ts';
import { DayRanges, EquipmentTags, LocatedBadge } from './section.tsx';

/** Create and edit in the same form. */
export function CustomerPage({ id }: { id?: string }) {
  const customer = useCustomer(id);
  if (customer.error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(customer.error)}</Banner>
      </div>
    );
  }
  if (id && !customer.data) {
    return (
      <div className="page">
        <p>{m.loading()}</p>
      </div>
    );
  }
  return <CustomerForm key={customer.data?.updatedAt ?? 'new'} customer={customer.data} />;
}

type ContactRow = {
  key: string;
  id?: string;
  name: string;
  role: string;
  phone: string;
  email: string;
};

type FormState = {
  name: string;
  code: string;
  country: string;
  siret: string;
  vatNumber: string;
  billingStreet1: string;
  billingStreet2: string;
  billingPostcode: string;
  billingCity: string;
  notes: string;
  contacts: ContactRow[];
  sites: SiteJson[];
};

let nextKey = 0;
const newKey = () => `contact-${++nextKey}`;

function initialState(c: CustomerWithSitesJson | undefined): FormState {
  return {
    name: c?.name ?? '',
    code: c?.code ?? '',
    country: c?.country ?? 'FR',
    siret: c?.siret ?? '',
    vatNumber: c?.vatNumber ?? '',
    billingStreet1: c?.billingStreet1 ?? '',
    billingStreet2: c?.billingStreet2 ?? '',
    billingPostcode: c?.billingPostcode ?? '',
    billingCity: c?.billingCity ?? '',
    notes: c?.notes ?? '',
    contacts: (c?.contacts ?? []).map((x) => ({
      key: newKey(),
      id: x.id,
      name: x.name,
      role: x.role ?? '',
      phone: x.phone ?? '',
      email: x.email ?? '',
    })),
    sites: c?.sites ?? [],
  };
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toInput(s: FormState): CustomerInputJson {
  return {
    name: s.name,
    code: s.code,
    country: s.country,
    siret: orNull(s.siret),
    vatNumber: orNull(s.vatNumber),
    billingStreet1: orNull(s.billingStreet1),
    billingStreet2: orNull(s.billingStreet2),
    billingPostcode: orNull(s.billingPostcode),
    billingCity: orNull(s.billingCity),
    notes: orNull(s.notes),
    contacts: s.contacts.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      role: orNull(c.role),
      phone: orNull(c.phone),
      email: orNull(c.email),
    })),
    siteIds: s.sites.map((site) => site.id),
  };
}

/** The domain's rules on what is typed, the way the server will see it. */
function clientIssues(s: FormState): Issue[] {
  const input = toInput(s);
  return checkCustomer({
    ...input,
    code: input.code.trim().toUpperCase(),
    siret: input.siret ? normaliseSiret(input.siret) : null,
    vatNumber: input.vatNumber ?? null,
    billingStreet1: input.billingStreet1 ?? null,
    billingStreet2: input.billingStreet2 ?? null,
    billingPostcode: input.billingPostcode ?? null,
    billingCity: input.billingCity ?? null,
    notes: input.notes ?? null,
    contacts: input.contacts.map((c) => ({
      name: c.name,
      role: c.role ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    })),
  });
}

function CustomerForm({ customer }: { customer: CustomerWithSitesJson | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshCustomers();
  const lists = useReferenceLists().data;
  const [state, setState] = useState(() => initialState(customer));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<IssueJson[]>([]);
  const [taken, setTaken] = useState<{ field: 'code' | 'siret'; owner: CustomerOwnerJson }>();
  const [notice, setNotice] = useState<string>();

  const issues = clientIssues(state);
  const shown: IssueJson[] = [
    ...issues.filter(
      (i) =>
        submitted || touched.has(i.field) || touched.has(i.field.split('.').slice(0, 2).join('.')),
    ),
    ...serverIssues.filter((s) => !issues.some((i) => i.field === s.field)),
  ];
  const errorFor = (field: string) => {
    const issue = shown.find((i) => i.field === field);
    return issue ? issueSentence(issue, lists) : undefined;
  };

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [field]: value }));
    setTouched((t) => new Set(t).add(field));
    setServerIssues((list) => list.filter((i) => i.field !== field));
    if (field === 'code' || field === 'siret') setTaken(undefined);
  };

  // Rule 2: a valid French SIRET proposes the VAT number, which stays editable.
  const siret = normaliseSiret(state.siret);
  const siretValid = state.country === 'FR' && isValidSiret(siret);
  const setSiret = (value: string) => {
    const next = normaliseSiret(value);
    const proposed = isValidSiret(next) ? vatFromSiren(sirenOf(next)) : null;
    const previous = isValidSiret(siret) ? vatFromSiren(sirenOf(siret)) : '';
    set('siret', value);
    if (proposed && (state.vatNumber === '' || state.vatNumber === previous)) {
      setState((s) => ({ ...s, vatNumber: proposed }));
    }
  };

  const setContact = (key: string, field: keyof Omit<ContactRow, 'key' | 'id'>, value: string) => {
    const index = state.contacts.findIndex((c) => c.key === key);
    setState((s) => ({
      ...s,
      contacts: s.contacts.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    }));
    setTouched((t) => new Set(t).add(`contacts.${index}`));
  };

  const save = useMutation({
    mutationFn: async (body: CustomerInputJson) =>
      customer
        ? ok(await api.customers[':id'].$put({ param: { id: customer.id }, json: body }))
        : ok(await api.customers.$post({ json: body })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.customer(saved.id), saved);
      await refresh();
      if (customer) setNotice(m.saved());
      else await navigate({ to: '/customers/$id', params: { id: saved.id } });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      const body = error.body as { issues?: IssueJson[]; owner?: CustomerOwnerJson };
      if (error.code === 'invalid') setServerIssues(body.issues ?? []);
      if ((error.code === 'code-taken' || error.code === 'siret-taken') && body.owner) {
        setTaken({ field: error.code === 'code-taken' ? 'code' : 'siret', owner: body.owner });
      }
    },
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const param = { param: { id: customer?.id ?? '' } };
      return ok(
        archived
          ? await api.customers[':id'].archive.$post(param)
          : await api.customers[':id'].restore.$post(param),
      );
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.customer(saved.id), saved);
      await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setNotice(undefined);
    if (issues.length === 0) save.mutate(toInput(state));
  };

  const takenMessage = (field: 'code' | 'siret') => {
    if (taken?.field !== field) return errorFor(field);
    const owner = taken.owner;
    return (
      <>
        {field === 'code'
          ? owner.archived
            ? m.code_taken_archived({ code: owner.code, name: owner.name })
            : m.code_taken({ code: owner.code, name: owner.name })
          : m.siret_taken({ name: owner.name, code: owner.code })}{' '}
        <Link to="/customers/$id" params={{ id: owner.id }}>
          {m.action_open_customer({ name: owner.name })}
        </Link>
      </>
    );
  };

  const writeError =
    save.error &&
    !(
      save.error instanceof ApiError &&
      ['invalid', 'code-taken', 'siret-taken'].includes(save.error.code ?? '')
    )
      ? save.error
      : archive.error;
  const today = companyDay(Temporal.Now.instant()).dayOfWeek;
  const countryOptions = [...countries].sort((a, b) =>
    a === 'FR' ? -1 : b === 'FR' ? 1 : countryName(a).localeCompare(countryName(b)),
  );

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb>
          <li>
            <Link to="/customers">{m.customers_title()}</Link>
          </li>
          <li aria-current="page">{customer?.code ?? m.new_customer()}</li>
        </Breadcrumb>
        <div className="page-title-row">
          <div className="page-title">
            {customer ? <Plate>{customer.code}</Plate> : null}
            <div>
              <h1>{customer?.name ?? m.new_customer()}</h1>
              {customer ? (
                <span className="page-subtitle">
                  {[customer.billingCity, countryName(customer.country)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="page-actions">
            {customer ? (
              <Button
                variant="danger"
                onClick={() => archive.mutate(!customer.archived)}
                disabled={archive.isPending}
              >
                {customer.archived ? m.action_restore() : m.action_archive()}
              </Button>
            ) : null}
            <Link className="t-button" to="/customers">
              {m.action_cancel()}
            </Link>
            <Button type="submit" form="customer-form" variant="primary" disabled={save.isPending}>
              {customer ? m.action_save() : m.action_create()}
            </Button>
          </div>
        </div>
      </header>

      {customer?.archived ? <Banner tone="warning">{m.customer_archived_banner()}</Banner> : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}
      {writeError ? <Banner tone="conflict">{failureText(writeError, lists)}</Banner> : null}

      <form id="customer-form" className="customer-layout" onSubmit={submit} noValidate>
        <div className="customer-column">
          <section className="t-panel form-grid" aria-labelledby="identity-title">
            <h2 id="identity-title">{m.section_customer_identity()}</h2>
            <div className="span-2">
              <Field label={m.field_legal_name()} error={errorFor('name')}>
                <input value={state.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
            </div>
            <Field label={m.field_code()} hint={m.code_hint()} error={takenMessage('code')}>
              <input
                className="t-mono"
                value={state.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={m.field_country()} error={errorFor('country')}>
              <select value={state.country} onChange={(e) => set('country', e.target.value)}>
                {countryOptions.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
            </Field>
            {state.country === 'FR' ? (
              <Field
                label={m.field_siret()}
                optional={m.optional()}
                hint={siretValid ? `✓ ${m.siret_valid()} · ${m.siret_hint()}` : m.siret_hint()}
                error={takenMessage('siret')}
              >
                <input
                  className="t-mono"
                  inputMode="numeric"
                  value={state.siret}
                  onChange={(e) => setSiret(e.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label={m.field_vat()}
              optional={m.optional()}
              hint={state.country === 'FR' ? m.vat_hint() : undefined}
              error={errorFor('vatNumber')}
            >
              <input
                className="t-mono"
                value={state.vatNumber}
                onChange={(e) => set('vatNumber', e.target.value.toUpperCase())}
              />
            </Field>
          </section>

          <section className="t-panel form-grid" aria-labelledby="billing-title">
            <h2 id="billing-title">{m.section_billing()}</h2>
            <div className="span-2">
              <Field label={m.field_street()} optional={m.optional()}>
                <input
                  value={state.billingStreet1}
                  onChange={(e) => set('billingStreet1', e.target.value)}
                />
              </Field>
            </div>
            <div className="span-2">
              <Field label={m.field_street2()} optional={m.optional()}>
                <input
                  value={state.billingStreet2}
                  onChange={(e) => set('billingStreet2', e.target.value)}
                />
              </Field>
            </div>
            <Field
              label={m.field_postcode()}
              optional={m.optional()}
              error={errorFor('billingPostcode')}
            >
              <input
                className="t-mono"
                value={state.billingPostcode}
                onChange={(e) => set('billingPostcode', e.target.value)}
              />
            </Field>
            <Field label={m.field_city()} optional={m.optional()}>
              <input
                value={state.billingCity}
                onChange={(e) => set('billingCity', e.target.value)}
              />
            </Field>
          </section>

          <section className="t-panel" aria-labelledby="notes-title">
            <h2 id="notes-title">{m.section_notes()}</h2>
            <Field label={m.section_notes()}>
              <textarea value={state.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </section>
        </div>

        <div className="customer-column">
          <Contacts
            contacts={state.contacts}
            errorFor={errorFor}
            onChange={setContact}
            onAdd={() =>
              setState((s) => ({
                ...s,
                contacts: [
                  ...s.contacts,
                  { key: newKey(), name: '', role: '', phone: '', email: '' },
                ],
              }))
            }
            onRemove={(key) => {
              setState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.key !== key) }));
              setServerIssues([]);
            }}
          />
          <UsualSites
            sites={state.sites}
            customerId={customer?.id}
            today={today}
            onAdd={(site) => set('sites', [...state.sites, site])}
            onRemove={(siteId) =>
              set(
                'sites',
                state.sites.filter((s) => s.id !== siteId),
              )
            }
          />
        </div>
      </form>
    </div>
  );
}

function Contacts({
  contacts,
  errorFor,
  onChange,
  onAdd,
  onRemove,
}: {
  contacts: readonly ContactRow[];
  errorFor: (field: string) => string | undefined;
  onChange: (key: string, field: 'name' | 'role' | 'phone' | 'email', value: string) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  return (
    <section className="t-panel" aria-labelledby="contacts-title">
      <div className="panel-title-row">
        <h2 id="contacts-title">{m.section_contacts()}</h2>
        <Button onClick={onAdd}>{m.action_add_contact()}</Button>
      </div>
      {contacts.length === 0 ? <p className="t-field-hint">{m.contacts_empty()}</p> : null}
      <div className="contact-list">
        {contacts.map((contact, index) => {
          const rowError = errorFor(`contacts.${index}`);
          const label = m.contact_label({ n: index + 1 });
          return (
            <fieldset
              key={contact.key}
              className="contact-row"
              data-invalid={rowError ? 'true' : undefined}
            >
              <legend className="t-visually-hidden">{label}</legend>
              <Field label={m.field_contact_name()} error={errorFor(`contacts.${index}.name`)}>
                <input
                  value={contact.name}
                  onChange={(e) => onChange(contact.key, 'name', e.target.value)}
                />
              </Field>
              <Field label={m.field_contact_role()} optional={m.optional()}>
                <input
                  value={contact.role}
                  onChange={(e) => onChange(contact.key, 'role', e.target.value)}
                />
              </Field>
              <Field label={m.field_contact_phone()}>
                <input
                  type="tel"
                  className="t-mono"
                  value={contact.phone}
                  onChange={(e) => onChange(contact.key, 'phone', e.target.value)}
                />
              </Field>
              <Field label={m.field_contact_email()} error={errorFor(`contacts.${index}.email`)}>
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) => onChange(contact.key, 'email', e.target.value)}
                />
              </Field>
              <Button
                variant="link"
                onClick={() => onRemove(contact.key)}
                aria-label={m.action_remove_named({ name: contact.name || label })}
              >
                {m.action_remove()}
              </Button>
              {rowError ? (
                <p className="t-field-error contact-error" role="alert">
                  {rowError}
                </p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <p className="t-field-hint">{m.contacts_hint()}</p>
    </section>
  );
}

function UsualSites({
  sites,
  customerId,
  today,
  onAdd,
  onRemove,
}: {
  sites: readonly SiteJson[];
  customerId: string | undefined;
  today: number;
  onAdd: (site: SiteJson) => void;
  onRemove: (siteId: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const settled = useDebounced(query.trim());
  const found = useSites(settled, 'all', false);
  const equipment = useReferenceLists().data?.protectiveEquipment ?? [];
  const matches =
    settled.length >= 2
      ? (found.data?.sites ?? []).filter((s) => !sites.some((x) => x.id === s.id)).slice(0, 6)
      : [];

  return (
    <section className="t-panel" aria-labelledby="usual-sites-title">
      <div className="panel-title-row">
        <h2 id="usual-sites-title">{m.section_usual_sites()}</h2>
        <span className="t-field-hint">{m.usual_sites_hint()}</span>
      </div>
      <div className="site-picker">
        <label htmlFor={searchId} className="t-visually-hidden">
          {m.site_search_label()}
        </label>
        <input
          id={searchId}
          type="search"
          className="search-input"
          placeholder={m.site_search_label()}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {customerId ? (
          <Link className="t-button" to="/customers/sites/new" search={{ customer: customerId }}>
            {m.action_new_site()}
          </Link>
        ) : null}
      </div>
      {matches.length > 0 ? (
        <ul className="site-matches">
          {matches.map((site) => (
            <li key={site.id}>
              <Button
                variant="link"
                onClick={() => {
                  onAdd(site);
                  setQuery('');
                }}
                aria-label={m.action_use_site({ name: site.name })}
              >
                + {site.name}
              </Button>
              <span className="t-secondary">
                {site.postcode} {site.city}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {sites.length === 0 ? (
        <p className="t-field-hint">{m.usual_sites_empty()}</p>
      ) : (
        <div className="t-table-frame">
          <table className="t-table">
            <caption className="t-visually-hidden">{m.section_usual_sites()}</caption>
            <thead>
              <tr>
                <th scope="col">{m.col_site()}</th>
                <th scope="col">{m.col_hours_on({ day: weekdayName(today) })}</th>
                <th scope="col">{m.col_protective_equipment()}</th>
                <th scope="col">{m.col_location()}</th>
                <th scope="col">{m.col_access_booking()}</th>
                <th scope="col">
                  <span className="t-visually-hidden">{m.col_actions()}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <th scope="row" className="usual-site">
                    <Link to="/customers/sites/$id" params={{ id: site.id }} className="row-link">
                      {site.name}
                    </Link>
                    <span className="t-secondary">
                      {site.street1}, {site.postcode} {site.city}
                    </span>
                  </th>
                  <HoursCell openings={site.openings.filter((o) => o.weekday === today)} />
                  <td>
                    <EquipmentTags ids={site.protectiveEquipmentIds} list={equipment} />
                  </td>
                  <td>
                    <LocatedBadge locatedBy={site.locatedBy} />
                  </td>
                  <td>{accessAndBooking(site)}</td>
                  <td className="t-end">
                    <Button
                      variant="link"
                      onClick={() => onRemove(site.id)}
                      aria-label={m.action_remove_named({ name: site.name })}
                    >
                      {m.action_remove()}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HoursCell({ openings }: { openings: readonly OpeningJson[] }) {
  return openings.length > 0 ? (
    <td className="t-mono">
      <DayRanges openings={openings} />
    </td>
  ) : (
    <td className="muted">{capitalise(m.closed())}</td>
  );
}
