import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { OrderImportCheckJson, OrderWarningJson } from '@timon/http';
import { StatusBadge, TableFrame } from '@timon/ui';
import { api, ok } from '../api.ts';
import { useReferenceLists } from '../data.ts';
import { ImportScreen } from '../import/import-screen.tsx';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import { useRefreshOrders } from './order-data.ts';
import { reviewLabel, warningLabel } from './order-labels.ts';

// SPEC-004, Import: the shared import path, with the preview grouped by order (criteria 11 and
// 13). One line per goods line; the lines of one customer with one reference make an order.

type Check = OrderImportCheckJson;
type Row = Check['rows'][number];
type Group = Check['orders'][number];

/** "2–4" for lines that follow each other, "2, 5" otherwise. */
export function lineRange(lines: readonly number[]): string {
  const first = lines[0];
  const last = lines.at(-1);
  if (first === undefined || last === undefined) return '';
  if (lines.length === 1) return String(first);
  return last - first === lines.length - 1 ? `${first}–${last}` : lines.join(', ');
}

function warningText(w: Group['warnings'][number]): string {
  return w.code === 'no-reference' ? m.warning_no_reference() : warningLabel(w as OrderWarningJson);
}

function OrderPreview({ check, fileName }: { check: Check; fileName: string }) {
  const issues = (group: Group) =>
    check.rows.filter((r) => group.lines.includes(r.line)).reduce((n, r) => n + r.issues.length, 0);
  const code = (group: Group) =>
    check.rows.find((r) => r.line === group.lines[0])?.cells.customerCode ?? '';
  return (
    <TableFrame>
      <table className="t-table order-import-table">
        <caption className="t-visually-hidden">
          {m.order_import_caption({ file: fileName })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{m.col_reference()}</th>
            <th scope="col">{m.field_customer()}</th>
            <th scope="col">{m.col_lines()}</th>
            <th scope="col">{m.col_shape()}</th>
            <th scope="col" className="t-numeric">
              {m.col_goods_lines()}
            </th>
            <th scope="col">{m.col_result()}</th>
            <th scope="col">{m.section_warnings()}</th>
          </tr>
        </thead>
        <tbody>
          {check.orders.map((group) => (
            <tr key={group.lines[0]} data-tone={group.result === 'errors' ? 'conflict' : undefined}>
              <td className="t-mono">{group.reference ?? '—'}</td>
              <td>{group.customer?.name ?? code(group)}</td>
              <td className="t-mono">{lineRange(group.lines)}</td>
              <td>
                {m.count_pickups({ count: group.pickups })} ·{' '}
                {m.count_deliveries({ count: group.deliveries })}
              </td>
              <td className="t-mono t-numeric">{group.goodsLines}</td>
              <td>
                {group.result === 'errors' ? (
                  <StatusBadge tone="conflict">
                    {m.count_errors({ count: issues(group) })}
                  </StatusBadge>
                ) : group.result === 'to-review' ? (
                  <>
                    <StatusBadge tone="warning">{m.order_status_to_review()}</StatusBadge>
                    <span className="t-field-hint check-note">
                      {group.review.map(reviewLabel).join(' · ')}
                    </span>
                  </>
                ) : (
                  <StatusBadge tone="ok">{m.check_ready()}</StatusBadge>
                )}
              </td>
              <td>
                {group.warnings.length === 0 ? (
                  <span className="muted">{m.none()}</span>
                ) : (
                  <span className="badge-list">
                    {group.warnings.map((w) => (
                      <StatusBadge key={`${w.code}-${w.stopId}`} tone="warning">
                        {warningText(w)}
                      </StatusBadge>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

export function OrderImportPage() {
  const navigate = useNavigate();
  const refresh = useRefreshOrders();
  const lists = useReferenceLists().data;
  const lang = getLocale();
  const guide = useQuery({
    queryKey: ['imports', 'orders', 'columns', lang],
    queryFn: async () => ok(await api.imports.orders.columns.$get({ query: { lang } })),
  }).data;

  return (
    <ImportScreen<Row, Check>
      breadcrumb={
        <>
          <li>
            <Link to="/orders">{m.orders_title()}</Link>
          </li>
          <li aria-current="page">{m.import()}</li>
        </>
      }
      title={m.import_title_orders()}
      cancel={
        <Link className="t-button" to="/orders">
          {m.action_cancel()}
        </Link>
      }
      lists={lists}
      check={async (csv) => ok(await api.imports.orders.check.$post({ json: { csv } }))}
      run={async (csv, _check, fileName) => {
        const result = await ok(await api.imports.orders.$post({ json: { csv, fileName } }));
        await refresh();
        await navigate({
          to: '/orders',
          search: { imported: result.imported, toReview: result.toReview },
        });
      }}
      columns={[]}
      preview={(check, fileName) => <OrderPreview check={check} fileName={fileName} />}
      importLabel={(check) => m.action_import_orders({ count: check?.summary.orders ?? 0 })}
      summary={(check) => [
        { label: m.summary_lines(), value: check.summary.lines },
        { label: m.summary_orders(), value: check.summary.orders },
        { label: m.summary_ready(), value: check.summary.ready },
        { label: m.summary_to_review(), value: check.summary.toReview },
        { label: m.summary_with_errors(), value: check.summary.withErrors },
      ]}
      rules={[
        m.rule_all_or_nothing(),
        m.rule_separator(),
        m.rule_formats(),
        m.rule_order_grouping(),
        m.rule_order_references(),
        m.rule_order_review(),
      ]}
      guide={guide}
      templates={[
        {
          href: `/api/imports/orders/template?lang=${lang}`,
          download: `timon-orders-${lang}.csv`,
          label: m.download_order_template(),
        },
      ]}
      templateText={m.template_text_orders()}
      readyText={m.order_import_ready()}
      errorsText={m.order_import_errors_text()}
    />
  );
}
