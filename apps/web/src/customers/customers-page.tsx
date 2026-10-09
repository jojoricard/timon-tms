import { Link } from '@tanstack/react-router';
import type { CustomerJson } from '@timon/http';
import { Banner, Checkbox, Chip, ChipGroup, Columns } from '@timon/ui';
import { useState } from 'react';
import { errorText } from '../data.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { type CountryFilter, useCustomerSummary, useCustomers } from './customer-data.ts';
import { countryName } from './customer-labels.ts';
import { CustomerTabs } from './section.tsx';

/** "74900893400012" → "749 008 934 00012", as people read it. */
export function formatSiret(siret: string): string {
  return siret.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4');
}

export function CustomersPage({ imported }: { imported?: number | undefined }) {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<CountryFilter>('all');
  const [archived, setArchived] = useState(false);
  const list = useCustomers(query.trim(), country, archived);
  const summary = useCustomerSummary().data;

  const filters: { value: CountryFilter; label: string }[] = [
    { value: 'all', label: m.filter_all() },
    { value: 'france', label: m.filter_france() },
    { value: 'abroad', label: m.filter_abroad() },
  ];

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<li>{m.customers_title()}</li>}
        title={m.customers_title()}
        subtitle={summary ? m.customers_subtitle({ count: summary.customers }) : null}
        actions={
          <>
            <Link className="t-button" to="/customers/import">
              {m.action_import()}
            </Link>
            <Link className="t-button" data-variant="primary" to="/customers/new">
              {m.action_add_customer()}
            </Link>
          </>
        }
      >
        <CustomerTabs current="customers" />
      </PageHeader>

      {imported ? <Banner tone="ok">{m.imported({ count: imported })}</Banner> : null}

      <div className="toolbar">
        <div className="toolbar-start">
          <label className="search">
            <span className="t-visually-hidden">{m.search_label()}</span>
            <input
              type="search"
              value={query}
              placeholder={m.search_customers()}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ChipGroup label={m.country_filter_label()}>
            {filters.map((filter) => (
              <Chip
                key={filter.value}
                pressed={country === filter.value}
                onClick={() => setCountry(filter.value)}
                {...(list.data ? { count: list.data.counts[filter.value] } : {})}
              >
                {filter.label}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        <Checkbox label={m.show_archived()} checked={archived} onChange={setArchived} />
      </div>

      {list.error ? <Banner tone="conflict">{errorText(list.error)}</Banner> : null}
      {list.data ? (
        <>
          <div className="t-table-frame">
            <CustomerTable customers={list.data.customers} />
          </div>
          <p className="footnote">
            {m.customers_footer({ shown: list.data.customers.length, total: list.data.counts.all })}
          </p>
        </>
      ) : list.isPending ? (
        <p>{m.loading()}</p>
      ) : null}
    </div>
  );
}

function CustomerTable({ customers }: { customers: readonly CustomerJson[] }) {
  return (
    <table className="t-table">
      <caption className="t-visually-hidden">{m.customers_caption()}</caption>
      <Columns widths={[12, 25, 17, 15, 13, 8, 10]} />
      <thead>
        <tr>
          <th scope="col">{m.col_code()}</th>
          <th scope="col">{m.col_customer()}</th>
          <th scope="col">{m.col_city()}</th>
          <th scope="col">{m.col_siret()}</th>
          <th scope="col">{m.col_vat()}</th>
          <th scope="col" className="t-numeric">
            {m.col_contacts()}
          </th>
          <th scope="col" className="t-numeric">
            {m.col_usual_sites()}
          </th>
        </tr>
      </thead>
      <tbody>
        {customers.length === 0 ? (
          <tr>
            <td colSpan={7}>{m.list_empty()}</td>
          </tr>
        ) : null}
        {customers.map((c) => (
          <tr key={c.id}>
            <td className="t-mono">{c.code}</td>
            <th scope="row">
              <Link to="/customers/$id" params={{ id: c.id }} className="row-link">
                {c.name}
              </Link>
              {c.archived ? <span className="t-secondary">{m.archived()}</span> : null}
              {!c.siret && c.country === 'FR' ? (
                <span className="t-secondary">{m.no_siret_yet()}</span>
              ) : null}
            </th>
            <td>
              {c.billingCity}
              {c.country !== 'FR' ? ` · ${countryName(c.country)}` : ''}
            </td>
            <td className="t-mono">{c.siret ? formatSiret(c.siret) : '—'}</td>
            <td className="t-mono">{c.vatNumber ?? '—'}</td>
            <td className="t-numeric">{c.contacts.length}</td>
            <td className="t-numeric">{c.siteIds.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
