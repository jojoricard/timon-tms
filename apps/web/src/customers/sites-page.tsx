import { Link } from '@tanstack/react-router';
import type { LocatedBy } from '@timon/domain';
import type { ListItemJson, SiteJson } from '@timon/http';
import { Banner, Checkbox, Chip, ChipGroup, Columns, StatusBadge } from '@timon/ui';
import { useState } from 'react';
import { errorText, useReferenceLists } from '../data.ts';
import { formatLongDate } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { type SiteFilter, useCustomerSummary, useSites } from './customer-data.ts';
import { accessSummary, bookingMethodLabel } from './customer-labels.ts';
import { CustomerTabs, DayRanges, EquipmentTags, LocatedBadge } from './section.tsx';

export function SitesPage({
  imported,
}: {
  imported?: { count: number; notLocated: number } | undefined;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SiteFilter>('all');
  const [archived, setArchived] = useState(false);
  const list = useSites(query.trim(), filter, archived);
  const summary = useCustomerSummary().data;
  const equipment = useReferenceLists().data?.protectiveEquipment ?? [];

  const filters: { value: SiteFilter; label: string; tone?: 'warning' }[] = [
    { value: 'all', label: m.filter_all() },
    { value: 'not-located', label: m.filter_not_located(), tone: 'warning' },
    { value: 'booking', label: m.filter_booking() },
    { value: 'protective-equipment', label: m.filter_protective_equipment() },
  ];

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <>
            <li>
              <Link to="/customers">{m.customers_title()}</Link>
            </li>
            <li aria-current="page">{m.sites_title()}</li>
          </>
        }
        title={m.sites_title()}
        subtitle={summary ? m.sites_subtitle({ count: summary.sites }) : null}
        actions={
          <>
            <Link className="t-button" to="/customers/sites/import">
              {m.action_import()}
            </Link>
            <Link className="t-button" data-variant="primary" to="/customers/sites/new">
              {m.action_add_site()}
            </Link>
          </>
        }
      >
        <CustomerTabs current="sites" />
      </PageHeader>

      {imported ? (
        <Banner tone="ok">
          {m.imported_sites({ count: imported.count, notLocated: imported.notLocated })}
        </Banner>
      ) : null}

      <div className="toolbar">
        <div className="toolbar-start">
          <label className="search">
            <span className="t-visually-hidden">{m.search_label()}</span>
            <input
              type="search"
              value={query}
              placeholder={m.search_sites()}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ChipGroup label={m.site_filter_label()}>
            {filters.map((f) => (
              <Chip
                key={f.value}
                pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                {...(list.data ? { count: list.data.counts[f.value] } : {})}
                {...(f.tone ? { tone: f.tone } : {})}
              >
                {f.label}
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
            <SiteTable sites={list.data.sites} equipment={equipment} />
          </div>
          <p className="footnote">
            {m.sites_footer({ shown: list.data.sites.length, total: list.data.counts.all })} ·{' '}
            {formatLongDate(list.data.day)}
          </p>
        </>
      ) : list.isPending ? (
        <p>{m.loading()}</p>
      ) : null}
    </div>
  );
}

function SiteTable({
  sites,
  equipment,
}: {
  sites: readonly SiteJson[];
  equipment: readonly ListItemJson[];
}) {
  return (
    <table className="t-table">
      <caption className="t-visually-hidden">{m.sites_caption()}</caption>
      <Columns widths={[18, 13, 5, 16, 10, 16, 12, 10]} />
      <thead>
        <tr>
          <th scope="col">{m.col_site()}</th>
          <th scope="col">{m.col_postcode_city()}</th>
          <th scope="col">{m.col_country()}</th>
          <th scope="col">{m.col_today()}</th>
          <th scope="col">{m.col_booking()}</th>
          <th scope="col">{m.col_protective_equipment()}</th>
          <th scope="col">{m.col_access()}</th>
          <th scope="col" className="t-end">
            {m.col_location()}
          </th>
        </tr>
      </thead>
      <tbody>
        {sites.length === 0 ? (
          <tr>
            <td colSpan={8}>{m.list_empty()}</td>
          </tr>
        ) : null}
        {sites.map((s) => (
          <tr key={s.id}>
            <th scope="row">
              <Link to="/customers/sites/$id" params={{ id: s.id }} className="row-link">
                {s.name}
              </Link>
              <span className="t-secondary">
                {s.archived ? m.archived() : m.used_by({ count: s.customerIds.length })}
              </span>
            </th>
            <td>
              <span className="t-mono">{s.postcode}</span> {s.city}
            </td>
            <td className="t-mono">{s.country}</td>
            <td className={s.today.openings.length > 0 ? 't-mono' : 'muted'}>
              {s.today.openings.length > 0 ? (
                <DayRanges openings={s.today.openings} />
              ) : (
                m.closed_today()
              )}
            </td>
            <td>
              {s.bookingRequired ? (
                <StatusBadge tone="petrol">
                  {bookingMethodLabel[s.bookingMethod ?? '']?.() ?? ''}
                </StatusBadge>
              ) : (
                <span className="muted">{m.booking_not_required()}</span>
              )}
            </td>
            <td>
              <EquipmentTags ids={s.protectiveEquipmentIds} list={equipment} />
            </td>
            <td>{accessSummary(s)}</td>
            <td className="t-end">
              <LocatedBadge locatedBy={s.locatedBy as LocatedBy} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
