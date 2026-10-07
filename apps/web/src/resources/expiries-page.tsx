import { Link } from '@tanstack/react-router';
import type { ResourceKind } from '@timon/domain';
import type { ExpiryJson, ReferenceListsJson } from '@timon/http';
import { Banner, Checkbox, Chip, ChipGroup, Metric, Metrics, Plate, StatusBadge } from '@timon/ui';
import { useState } from 'react';
import { errorText, useExpiries, useReferenceLists } from '../data.ts';
import { ownerKind } from '../issues.ts';
import { kindSlugs, tabLabel } from '../kinds.ts';
import {
  capitalise,
  entryLabel,
  formatDate,
  formatDays,
  formatLongDate,
  severityTone,
  textTone,
} from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader, SectionTabs } from './section.tsx';

const kinds: ResourceKind[] = ['driver', 'power-unit', 'trailer'];

export function ExpiriesPage() {
  const [kind, setKind] = useState<ResourceKind | undefined>();
  const [blocking, setBlocking] = useState(false);
  const expiries = useExpiries(kind, blocking);
  const lists = useReferenceLists().data;
  const data = expiries.data;

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <>
            <li>
              <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
                {m.resources_title()}
              </Link>
            </li>
            <li aria-current="page">{m.expiries_title()}</li>
          </>
        }
        title={m.expiries_title()}
      >
        <SectionTabs current="expiries" />
      </PageHeader>

      {expiries.error ? <Banner tone="conflict">{errorText(expiries.error)}</Banner> : null}

      {data ? (
        <Metrics>
          <Metric
            label={m.metric_expired_blocking()}
            value={data.summary.expiredBlocking}
            tone="conflict"
          >
            {m.metric_expired_blocking_text()}
          </Metric>
          <Metric
            label={m.metric_expired_not_blocking()}
            value={data.summary.expiredNotBlocking}
            tone="warning"
          >
            {m.metric_expired_not_blocking_text()}
          </Metric>
          <Metric label={m.metric_within_30()} value={data.summary.withinThirtyDays}>
            {m.metric_within_30_text()}
          </Metric>
          <Metric label={m.metric_longer_lead()} value={data.summary.longerLeadTime}>
            {m.metric_longer_lead_text()}
          </Metric>
        </Metrics>
      ) : null}

      <div className="toolbar">
        <div className="toolbar-start">
          <ChipGroup label={m.kind_filter_label()}>
            <Chip pressed={kind === undefined} onClick={() => setKind(undefined)}>
              {m.filter_all_resources()}
            </Chip>
            {kinds.map((k) => (
              <Chip key={k} pressed={kind === k} onClick={() => setKind(k)}>
                {tabLabel[k]()}
              </Chip>
            ))}
          </ChipGroup>
          <Checkbox label={m.blocking_only()} checked={blocking} onChange={setBlocking} />
        </div>
      </div>

      {data && lists ? (
        <>
          <div className="t-table-frame">
            <ExpiryTable expiries={data.expiries} lists={lists} day={data.day} />
          </div>
          <p className="footnote">{m.expiries_footer({ date: formatLongDate(data.day) })}</p>
        </>
      ) : expiries.isPending ? (
        <p>{m.loading()}</p>
      ) : null}
    </div>
  );
}

function ExpiryTable({
  expiries,
  lists,
  day,
}: {
  expiries: readonly ExpiryJson[];
  lists: ReferenceListsJson;
  day: string;
}) {
  return (
    <table className="t-table">
      <caption className="t-visually-hidden">
        {m.expiries_caption({ date: formatLongDate(day) })}
      </caption>
      <thead>
        <tr>
          <th scope="col">{m.col_status()}</th>
          <th scope="col">{m.col_resource()}</th>
          <th scope="col">{m.col_kind()}</th>
          <th scope="col">{m.col_document()}</th>
          <th scope="col">{m.col_expires()}</th>
          <th scope="col">{m.col_when()}</th>
          <th scope="col">{m.col_rule()}</th>
          <th scope="col">{m.col_note()}</th>
          <th scope="col">
            <span className="t-visually-hidden">{m.col_actions()}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {expiries.length === 0 ? (
          <tr>
            <td colSpan={9}>{m.expiries_empty()}</td>
          </tr>
        ) : null}
        {expiries.map((e) => {
          const type = lists.documentTypes.find((t) => t.id === e.documentTypeId);
          const expired = e.status === 'expired';
          return (
            <tr key={e.id}>
              <td>
                <StatusBadge tone={severityTone[e.severity]}>
                  {expired ? m.status_expired() : m.status_expiring()}
                </StatusBadge>
              </td>
              <th scope="row">
                {e.resource.kind === 'driver' ? e.resource.name : <Plate>{e.resource.name}</Plate>}
              </th>
              <td>{capitalise(ownerKind(e.resource))}</td>
              <td>{entryLabel(type)}</td>
              <td className="t-mono">{formatDate(e.expiresOn)}</td>
              <td className="t-tone-text" data-tone={textTone(e.severity)}>
                {formatDays(e.daysUntil)}
              </td>
              <td>{e.blocking ? m.rule_blocking() : m.rule_not_blocking()}</td>
              <td>
                {!e.blocking
                  ? m.note_warning_only()
                  : expired
                    ? m.note_blocked()
                    : m.note_warns({ days: e.warnDays })}
              </td>
              <td className="t-end">
                <Link
                  to="/resources/$kind/$id"
                  params={{ kind: kindSlugs[e.resource.kind], id: e.resource.id }}
                  aria-label={m.action_open_named({ name: e.resource.name })}
                >
                  {m.action_open()}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
