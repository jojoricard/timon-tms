import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ResourceKind, VehicleKind } from '@timon/domain';
import type { DocumentJson, ReferenceListsJson, ResourceJson } from '@timon/http';
import { Banner, Button, Checkbox, Chip, ChipGroup, Plate, StatusBadge } from '@timon/ui';
import { type ReactNode, useState } from 'react';
import { api, ok } from '../api.ts';
import {
  errorText,
  type StatusFilter,
  useReferenceLists,
  useRefreshResources,
  useResourceList,
  useSummary,
} from '../data.ts';
import { failureText } from '../issues.ts';
import { addLabel, kindSlugs, tabLabel } from '../kinds.ts';
import {
  entryLabel,
  formatDate,
  formatDays,
  formatLongDate,
  formatMonth,
  severityLabel,
  severityTone,
  textTone,
  vehicleKindLabel,
} from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader, SectionTabs } from './section.tsx';

export function ListPage({
  kind,
  imported,
}: {
  kind: ResourceKind;
  imported?: number | undefined;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [archived, setArchived] = useState(false);
  const list = useResourceList(kind, query.trim(), status, archived);
  const lists = useReferenceLists().data;
  const summary = useSummary().data;
  const total = summary
    ? summary.active.driver + summary.active['power-unit'] + summary.active.trailer
    : null;

  const filters: { value: StatusFilter; label: string; tone?: 'warning' | 'conflict' }[] = [
    { value: 'all', label: m.filter_all() },
    { value: 'expiring', label: m.filter_expiring(), tone: 'warning' },
    { value: 'expired', label: m.filter_expired(), tone: 'conflict' },
  ];

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<li>{m.resources_title()}</li>}
        title={m.resources_title()}
        subtitle={total === null ? null : m.resources_active({ count: total })}
        actions={
          <>
            <Link
              className="t-button"
              to="/resources/$kind/import"
              params={{ kind: kindSlugs[kind] }}
            >
              {m.action_import()}
            </Link>
            <Link
              className="t-button"
              data-variant="primary"
              to="/resources/$kind/new"
              params={{ kind: kindSlugs[kind] }}
            >
              {addLabel[kind]()}
            </Link>
          </>
        }
      >
        <SectionTabs current={kind} />
      </PageHeader>

      {imported ? <Banner tone="ok">{m.imported({ count: imported })}</Banner> : null}

      <div className="toolbar">
        <div className="toolbar-start">
          <label className="search">
            <span className="t-visually-hidden">{m.search_label()}</span>
            <input
              type="search"
              value={query}
              placeholder={kind === 'driver' ? m.search_drivers() : m.search_vehicles()}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ChipGroup label={m.filters_label()}>
            {filters.map((filter) => (
              <Chip
                key={filter.value}
                pressed={status === filter.value}
                onClick={() => setStatus(filter.value)}
                {...(list.data ? { count: list.data.counts[filter.value] } : {})}
                {...(filter.tone ? { tone: filter.tone } : {})}
              >
                {filter.label}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        <Checkbox label={m.show_archived()} checked={archived} onChange={setArchived} />
      </div>

      {list.error ? <Banner tone="conflict">{errorText(list.error)}</Banner> : null}
      {list.data && lists ? (
        <>
          <div className="t-table-frame">
            <ResourceTable
              kind={kind}
              resources={list.data.resources}
              lists={lists}
              day={list.data.day}
            />
          </div>
          <p className="footnote">
            {m.list_footer({
              shown: list.data.resources.length,
              total: list.data.counts.all,
              date: formatLongDate(list.data.day),
            })}
          </p>
        </>
      ) : list.isPending ? (
        <p>{m.loading()}</p>
      ) : null}
    </div>
  );
}

function ResourceTable({
  kind,
  resources,
  lists,
  day,
}: {
  kind: ResourceKind;
  resources: readonly ResourceJson[];
  lists: ReferenceListsJson;
  day: string;
}) {
  const typeCode = (d: DocumentJson) =>
    lists.documentTypes.find((t) => t.id === d.documentTypeId)?.code ?? null;
  const documentOf = (r: ResourceJson, code: string) =>
    r.documents.find((d) => typeCode(d) === code);
  const caption = m.list_caption({ kind: tabLabel[kind](), date: formatLongDate(day) });

  const columns =
    kind === 'driver'
      ? [m.col_driver(), m.col_licence(), m.col_cpc(), m.col_driver_card(), m.col_adr()]
      : kind === 'power-unit'
        ? [m.col_plate(), m.col_kind(), m.col_category(), m.col_make_model(), m.col_body_type()]
        : [m.col_plate(), m.col_kind(), m.col_category(), m.col_body_type()];

  return (
    <table className="t-table">
      <caption className="t-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
          <th scope="col">{m.col_next_expiry()}</th>
          <th scope="col" className="t-end">
            {m.col_status()}
          </th>
        </tr>
      </thead>
      <tbody>
        {resources.length === 0 ? (
          <tr>
            <td colSpan={columns.length + 2}>{m.list_empty()}</td>
          </tr>
        ) : null}
        {resources.map((r) => (
          <tr key={r.id}>
            {kind === 'driver' ? (
              <>
                <th scope="row">
                  <ResourceLink resource={r}>{`${r.firstName} ${r.lastName}`}</ResourceLink>
                  <span className="t-secondary">{r.displayName}</span>
                </th>
                <td className="t-mono">
                  {r.documents
                    .map((d) => typeCode(d))
                    .filter((code): code is string => code?.startsWith('licence-') ?? false)
                    .map((code) => code.slice('licence-'.length).toUpperCase())
                    .join(' · ')}
                </td>
                {['cpc', 'driver-card', 'adr-certificate'].map((code) => (
                  <td key={code}>
                    <MonthCell document={documentOf(r, code)} />
                  </td>
                ))}
              </>
            ) : (
              <>
                <th scope="row">
                  <ResourceLink resource={r}>
                    <Plate>{r.plate}</Plate>
                  </ResourceLink>
                </th>
                <td>{r.vehicleKind ? vehicleKindLabel[r.vehicleKind as VehicleKind]() : ''}</td>
                <td className="t-mono">{r.category}</td>
                {kind === 'power-unit' ? <td>{r.makeModel}</td> : null}
                <td>{entryLabel(lists.bodyTypes.find((b) => b.id === r.bodyTypeId)) || '—'}</td>
              </>
            )}
            <td>
              {r.nextExpiry ? (
                <>
                  {entryLabel(
                    lists.documentTypes.find((t) => t.id === r.nextExpiry?.documentTypeId),
                  )}{' '}
                  <span className="t-mono">{formatDate(r.nextExpiry.expiresOn)}</span>
                  {r.nextExpiry.status !== 'valid' ? (
                    <span className="t-secondary">{formatDays(r.nextExpiry.daysUntil)}</span>
                  ) : null}
                </>
              ) : (
                '—'
              )}
            </td>
            <td className="t-end">
              {r.archived ? (
                <RestoreButton resource={r} />
              ) : (
                <StatusBadge tone={severityTone[r.severity]}>
                  {severityLabel[r.severity]()}
                </StatusBadge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResourceLink({ resource, children }: { resource: ResourceJson; children: ReactNode }) {
  return (
    <Link
      to="/resources/$kind/$id"
      params={{ kind: kindSlugs[resource.kind], id: resource.id }}
      className="row-link"
    >
      {children}
    </Link>
  );
}

/** A document as month and year, coloured when it needs attention. */
function MonthCell({ document }: { document: DocumentJson | undefined }) {
  if (!document) return <span aria-hidden="true">—</span>;
  const tone = textTone(document.severity);
  return (
    <span className="t-mono t-tone-text" data-tone={tone}>
      {formatMonth(document.expiresOn)}
      {tone ? (
        <span className="t-visually-hidden"> ({severityLabel[document.severity]()})</span>
      ) : null}
    </span>
  );
}

function RestoreButton({ resource }: { resource: ResourceJson }) {
  const refresh = useRefreshResources();
  const restore = useMutation({
    mutationFn: async () =>
      ok(await api.resources[':id'].restore.$post({ param: { id: resource.id } })),
    onSuccess: refresh,
  });
  return (
    <span className="archived-actions">
      <StatusBadge tone="neutral">{m.archived()}</StatusBadge>
      <Button
        variant="link"
        onClick={() => restore.mutate()}
        disabled={restore.isPending}
        aria-label={m.action_restore_named({ name: resource.name })}
      >
        {m.action_restore()}
      </Button>
      {restore.error ? <span className="t-field-error">{failureText(restore.error)}</span> : null}
    </span>
  );
}
