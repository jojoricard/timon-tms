import { Link } from '@tanstack/react-router';
import type { OrderSummaryJson, ReferenceListsJson } from '@timon/http';
import { Banner, Chip, ChipGroup, Columns, StatusBadge, TableFrame } from '@timon/ui';
import { Fragment } from 'react';
import { useCustomers } from '../customers/customer-data.ts';
import { errorText, useReferenceLists } from '../data.ts';
import { formatLongDate } from '../labels.ts';
import type { OrdersSearch, SetSearch } from '../list-search.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { useOrders } from './order-data.ts';
import {
  goodsParts,
  listedRequirements,
  requirementLabel,
  reviewLabel,
  shortSlot,
  statusLabel,
  statusTone,
  stopCounts,
  warningLabel,
} from './order-labels.ts';

type Status = 'to-plan' | 'to-review';

/** The orders to plan and to review from today, by first pickup, grouped by day. */
export function OrdersPage({
  search,
  setSearch,
}: {
  search: OrdersSearch;
  setSearch: SetSearch<OrdersSearch>;
}) {
  const list = useOrders(search);
  const lists = useReferenceLists().data;
  const customers = useCustomers('', 'all', false).data?.customers ?? [];
  const query = search.q ?? '';
  const setQuery = (q: string) => setSearch({ q: q || undefined }, { replace: true });

  // Both statuses show by default; a chip turned off hides its orders.
  const shows = (status: Status) => search.status === undefined || search.status === status;
  const toggle = (status: Status) =>
    setSearch((current) => {
      const other: Status = status === 'to-plan' ? 'to-review' : 'to-plan';
      return { status: current.status === undefined ? other : undefined };
    });

  const counts = list.data?.counts;
  const filtered = Boolean(search.q || search.customer || search.status || search.to);

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<li>{m.orders_title()}</li>}
        title={m.orders_title()}
        subtitle={
          counts
            ? m.orders_subtitle({
                toPlan: counts['to-plan'],
                toReview: counts['to-review'],
                from: search.from
                  ? m.from_date({ date: formatLongDate(search.from) })
                  : m.from_today(),
              })
            : ''
        }
        actions={
          <Link className="t-button" data-variant="primary" to="/orders/new">
            {m.action_new_order()}
          </Link>
        }
      />

      <div className="toolbar">
        <div className="toolbar-start">
          <label className="search">
            <span className="t-visually-hidden">{m.search_label()}</span>
            <input
              type="search"
              value={query}
              placeholder={m.search_orders()}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ChipGroup label={m.order_status_filter_label()}>
            {(['to-plan', 'to-review'] as const).map((status) => (
              <Chip
                key={status}
                pressed={shows(status)}
                onClick={() => toggle(status)}
                {...(counts ? { count: counts[status] } : {})}
              >
                {statusLabel[status]()}
              </Chip>
            ))}
            <Chip
              pressed={search.cancelled === true}
              onClick={() => setSearch((c) => ({ cancelled: c.cancelled ? undefined : true }))}
              {...(counts && search.cancelled ? { count: counts.cancelled } : {})}
            >
              {m.order_status_cancelled()}
            </Chip>
          </ChipGroup>
          <div className="order-dates">
            <label>
              <span className="t-visually-hidden">{m.field_from_date()}</span>
              <input
                type="date"
                value={search.from ?? list.data?.day ?? ''}
                onChange={(e) => setSearch({ from: e.target.value || undefined })}
              />
            </label>
            <span aria-hidden="true">{m.date_range_to()}</span>
            <label>
              <span className="t-visually-hidden">{m.field_to_date()}</span>
              <input
                type="date"
                value={search.to ?? ''}
                onChange={(e) => setSearch({ to: e.target.value || undefined })}
              />
            </label>
          </div>
          <label>
            <span className="t-visually-hidden">{m.field_customer()}</span>
            <select
              value={search.customer ?? ''}
              onChange={(e) => setSearch({ customer: e.target.value || undefined })}
            >
              <option value="">{m.all_customers()}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="footnote">{m.sorted_by_first_pickup()}</span>
      </div>

      {list.error ? <Banner tone="conflict">{errorText(list.error)}</Banner> : null}
      {list.data ? (
        <>
          <TableFrame>
            <OrderTable orders={list.data.orders} lists={lists} filtered={filtered} />
          </TableFrame>
          <p className="footnote">{m.orders_footer({ count: list.data.orders.length })}</p>
        </>
      ) : list.isPending ? (
        <p>{m.loading()}</p>
      ) : null}
    </div>
  );
}

function OrderTable({
  orders,
  lists,
  filtered,
}: {
  orders: readonly OrderSummaryJson[];
  lists: ReferenceListsJson | undefined;
  filtered: boolean;
}) {
  const days = new Map<string, OrderSummaryJson[]>();
  for (const order of orders) {
    const day = order.firstPickup?.date ?? '';
    days.set(day, [...(days.get(day) ?? []), order]);
  }
  return (
    <table className="t-table order-table">
      <caption className="t-visually-hidden">{m.orders_caption()}</caption>
      <Columns widths={[11, 15, 15, 15, 11, 13, 11, 9]} />
      <thead>
        <tr>
          <th scope="col">{m.col_number()}</th>
          <th scope="col">{m.col_customer_reference()}</th>
          <th scope="col">{m.col_first_pickup()}</th>
          <th scope="col">{m.col_last_delivery()}</th>
          <th scope="col">{m.col_goods()}</th>
          <th scope="col">{m.col_requirements()}</th>
          <th scope="col">{m.col_warnings()}</th>
          <th scope="col">{m.col_status()}</th>
        </tr>
      </thead>
      <tbody>
        {orders.length === 0 ? (
          <tr>
            <td colSpan={8}>{filtered ? m.orders_no_match() : m.orders_empty()}</td>
          </tr>
        ) : null}
        {[...days].map(([day, rows]) => (
          <Fragment key={day}>
            <tr className="group-row">
              <th scope="colgroup" colSpan={8}>
                {day ? formatLongDate(day) : ''} · {m.count_orders({ count: rows.length })}
              </th>
            </tr>
            {rows.map((order) => (
              <OrderRow key={order.id} order={order} lists={lists} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function OrderRow({
  order,
  lists,
}: {
  order: OrderSummaryJson;
  lists: ReferenceListsJson | undefined;
}) {
  const first = order.firstPickup;
  const last = order.lastDelivery;
  const counts = stopCounts(order.pickups, order.deliveries);
  const requirements = order.requirements.filter((r) => listedRequirements.includes(r.code));
  return (
    <tr>
      <th scope="row" className="t-mono">
        <Link to="/orders/$id" params={{ id: order.id }} className="row-link">
          {order.number}
        </Link>
      </th>
      <td>
        <span className="cell-strong">{order.customer?.name ?? '—'}</span>
        {order.customerReference ? (
          <span className="t-secondary t-mono">{order.customerReference}</span>
        ) : null}
      </td>
      <td>
        {first ? (
          <>
            {first.siteName}
            <span className="t-secondary t-mono">
              {shortSlot(first.date, first.start, first.end)}
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td>
        {last ? (
          <>
            {last.siteName}
            <span className="t-secondary t-mono">{shortSlot(last.date, last.start, last.end)}</span>
          </>
        ) : (
          '—'
        )}
        {counts ? <span className="t-secondary">{counts}</span> : null}
      </td>
      <td>
        {goodsParts(order.totals).map((part, i) => (
          <span key={part} className="t-nowrap">
            {i > 0 ? ' · ' : ''}
            {part}
          </span>
        ))}
      </td>
      <td>
        {requirements.length > 0 ? (
          <ul className="t-tags">
            {requirements.map((r) => (
              <li key={`${r.code}-${r.ids.join()}`}>{requirementLabel(r, lists)}</li>
            ))}
          </ul>
        ) : (
          <span className="muted">{m.none()}</span>
        )}
      </td>
      <td>
        {order.warnings.length > 0 ? (
          <span className="badge-list">
            {order.warnings.map((w) => (
              <StatusBadge key={`${w.code}-${w.stopId}`} tone="warning">
                {warningLabel(w)}
              </StatusBadge>
            ))}
          </span>
        ) : (
          <span className="muted">{m.none()}</span>
        )}
      </td>
      <td>
        <StatusBadge tone={statusTone[order.status]}>{statusLabel[order.status]()}</StatusBadge>
        {order.review.map((issue) => (
          <span key={issue.code} className="t-secondary">
            {reviewLabel(issue)}
          </span>
        ))}
      </td>
    </tr>
  );
}
