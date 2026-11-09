import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { OrderJson, ReferenceListsJson } from '@timon/http';
import { Banner, Button, CardRow, StatusBadge } from '@timon/ui';
import { useState } from 'react';
import { ApiError, api, ifMatch, ok } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { errorText, useReferenceLists } from '../data.ts';
import { issueText } from '../issues.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { useSubmit } from '../submit.ts';
import { orderKeys, useOrder, useOrderHistory, useRefreshOrders } from './order-data.ts';
import {
  goodsParts,
  kilograms,
  packagingLabel,
  shortSlot,
  statusLabel,
  statusTone,
  stopKindLabel,
} from './order-labels.ts';

// SPEC-004, Splitting an order (criterion 12): the goods lines of an order to review in two
// groups, the stops each group takes, and whether each has a valid shape. Nothing is split until
// the dispatcher confirms; the split is made under the order's version.

type Line = OrderJson['lines'][number];
type Stop = OrderJson['stops'][number];

/** A group of lines: the stops they use, in the order's order, and its shape. */
function groupOf(order: OrderJson, lines: readonly Line[]) {
  const stops = order.stops.filter((s) =>
    lines.some((l) => l.fromStopId === s.id || l.toStopId === s.id),
  );
  const pickups = stops.filter((s) => s.kind === 'pickup').length;
  const deliveries = stops.length - pickups;
  const valid = lines.length > 0 && (pickups === 1 || deliveries === 1);
  const quantities = { 'euro-pallet': 0, pallet: 0, parcel: 0, bulk: 0 };
  let weightKg = 0;
  for (const line of lines) {
    quantities[line.packaging] += line.quantity;
    weightKg += line.weightKg;
  }
  return { lines, stops, pickups, deliveries, valid, totals: { weightKg, floorDm: 0, quantities } };
}

type Group = ReturnType<typeof groupOf>;

function shapeText(group: Group): string {
  const { pickups, deliveries } = group;
  if (pickups === 1 && deliveries === 1) return m.split_shape_one_one();
  if (pickups === 1) return m.split_shape_one_pickup({ deliveries });
  if (deliveries === 1) return m.split_shape_one_delivery({ pickups });
  return m.review_shape({
    pickups: m.count_pickups({ count: pickups }),
    deliveries: m.count_deliveries({ count: deliveries }),
  });
}

/** Why the split was refused, in the interface's language. */
function refusalText(error: unknown, lists: ReferenceListsJson | undefined): string {
  if (error instanceof ApiError) {
    if (error.code === 'not-splittable') return m.split_not_splittable();
    if (error.code === 'cancelled') return m.split_cancelled();
    if (error.code === 'invalid') {
      const issues = (error.body as { issues?: { field: string; code: string }[] }).issues ?? [];
      return issues.map((i) => issueText(i, lists)).join(' ');
    }
  }
  return errorText(error);
}

function GroupPanel({
  id,
  title,
  hint,
  order,
  group,
  siteName,
  move,
}: {
  id: string;
  title: string;
  hint: string;
  order: OrderJson;
  group: Group;
  siteName: (stop: Stop | undefined) => string;
  move: (line: Line) => { label: string; text: string; onClick: () => void };
}) {
  const stopOf = (stopId: string) => order.stops.find((s) => s.id === stopId);
  const number = (line: Line) => order.lines.findIndex((l) => l.id === line.id) + 1;
  return (
    <section className="t-panel split-group" aria-labelledby={`${id}-title`}>
      <div className="panel-title-row">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p className="t-field-hint">{hint}</p>
        </div>
        {group.lines.length === 0 ? (
          <StatusBadge tone="neutral">{m.split_no_line()}</StatusBadge>
        ) : group.valid ? (
          <StatusBadge tone="ok">{m.split_valid_shape()}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{m.split_wrong_shape()}</StatusBadge>
        )}
      </div>
      {group.stops.length > 0 ? (
        <>
          <ul className="split-stops">
            {group.stops.map((stop) => (
              <li key={stop.id}>
                <StatusBadge tone={stop.kind === 'pickup' ? 'petrol' : 'neutral'}>
                  {stopKindLabel[stop.kind]()}
                </StatusBadge>
                <span className="split-site">{siteName(stop)}</span>
                <span className="t-mono t-secondary">
                  {stop.date && stop.start && stop.end
                    ? shortSlot(stop.date, stop.start, stop.end)
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-field-hint">{shapeText(group)}</p>
        </>
      ) : null}
      <h3 className="label-heading">
        {[m.count_goods_lines({ count: group.lines.length }), ...goodsParts(group.totals)].join(
          ' · ',
        )}
      </h3>
      <ol className="split-lines">
        {group.lines.map((line) => {
          const action = move(line);
          return (
            <li key={line.id} className="split-line">
              <span className="split-number t-mono">{number(line)}</span>
              <div className="split-line-body">
                <p className="split-description">{line.description}</p>
                <p className="t-field-hint">
                  {packagingLabel(line.packaging, line.quantity)} · {kilograms(line.weightKg)} ·{' '}
                  <StatusBadge tone="petrol">{m.split_from()}</StatusBadge>{' '}
                  {siteName(stopOf(line.fromStopId))} ·{' '}
                  <StatusBadge tone="neutral">{m.split_to()}</StatusBadge>{' '}
                  {siteName(stopOf(line.toStopId))}
                </p>
              </div>
              <Button aria-label={action.label} onClick={action.onClick}>
                {action.text}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function SplitPage({ id }: { id: string }) {
  const order = useOrder(id);
  if (order.error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(order.error)}</Banner>
      </div>
    );
  }
  if (!order.data) {
    return (
      <div className="page">
        <p role="status">{m.loading()}</p>
      </div>
    );
  }
  return <SplitForm order={order.data} />;
}

function SplitForm({ order }: { order: OrderJson }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshOrders();
  const lists = useReferenceLists().data;
  const history = useOrderHistory(order.id).data;
  const confirm = useConfirm();
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());

  const split = useSubmit({
    mutationFn: async (lines: string[]) =>
      ok(
        await api.orders[':id'].split.$post({
          param: { id: order.id },
          header: ifMatch(order.version),
          json: { lines },
        }),
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(orderKeys.order(order.id), result.kept);
      queryClient.setQueryData(orderKeys.order(result.moved.id), result.moved);
      await refresh();
      await navigate({
        to: '/orders/$id',
        params: { id: order.id },
        search: { split: result.moved.id },
      });
    },
  });

  const siteName = (stop: Stop | undefined) =>
    order.sites.find((s) => s.id === stop?.siteId)?.name ?? '';
  const kept = groupOf(
    order,
    order.lines.filter((l) => !moved.has(l.id)),
  );
  const created = groupOf(
    order,
    order.lines.filter((l) => moved.has(l.id)),
  );
  const toggle = (line: Line) =>
    setMoved((current) => {
      const next = new Set(current);
      if (next.has(line.id)) next.delete(line.id);
      else next.add(line.id);
      return next;
    });
  const splittable = order.status === 'to-review' && order.shape === 'several-both';
  const ready = splittable && kept.lines.length > 0 && created.lines.length > 0;
  const creation = history?.events.find((e) => e.kind === 'created');
  const fileName = creation?.kind === 'created' ? creation.fileName : null;

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <>
            <li>
              <Link to="/orders">{m.orders_title()}</Link>
            </li>
            <li>
              <Link to="/orders/$id" params={{ id: order.id }} search={{}}>
                {order.number}
              </Link>
            </li>
            <li aria-current="page">{m.action_split()}</li>
          </>
        }
        title={m.split_title({ number: order.number })}
        badges={
          <StatusBadge tone={statusTone[order.status]}>{statusLabel[order.status]()}</StatusBadge>
        }
        subtitle={
          [
            order.customer?.name,
            order.customerReference ? m.reference_is({ reference: order.customerReference }) : null,
            fileName ? m.imported_from({ file: fileName }) : null,
          ]
            .filter(Boolean)
            .join(' · ') || null
        }
        actions={
          <>
            <Link className="t-button" to="/orders/$id" params={{ id: order.id }} search={{}}>
              {m.action_cancel()}
            </Link>
            <Button
              variant="primary"
              disabled={!ready}
              busy={split.isPending}
              onClick={() =>
                confirm.ask({
                  title: m.confirm_split_title({ number: order.number }),
                  text: m.confirm_split_text({ count: created.lines.length }),
                  confirmLabel: m.action_split(),
                  onConfirm: () => split.mutate([...moved]),
                })
              }
            >
              {m.action_split_into_two()}
            </Button>
          </>
        }
      />
      {confirm.dialog}

      {split.error ? <Banner tone="conflict">{refusalText(split.error, lists)}</Banner> : null}
      {splittable ? (
        <>
          <div className="t-banner" data-tone="warning">
            {m.split_banner({
              shape: m.review_shape({
                pickups: m.count_pickups({
                  count: order.stops.filter((s) => s.kind === 'pickup').length,
                }),
                deliveries: m.count_deliveries({
                  count: order.stops.filter((s) => s.kind === 'delivery').length,
                }),
              }),
            })}
          </div>
          <CardRow columns={['1fr', '1fr']}>
            <GroupPanel
              id="split-kept"
              title={m.split_stays_in({ number: order.number })}
              hint={m.split_stays_hint()}
              order={order}
              group={kept}
              siteName={siteName}
              move={(line) => ({
                label: m.split_move_right_label({ line: line.description }),
                text: m.split_move_right(),
                onClick: () => toggle(line),
              })}
            />
            <GroupPanel
              id="split-new"
              title={m.split_new_order()}
              hint={m.split_new_hint()}
              order={order}
              group={created}
              siteName={siteName}
              move={(line) => ({
                label: m.split_move_left_label({ line: line.description, number: order.number }),
                text: m.split_move_left(),
                onClick: () => toggle(line),
              })}
            />
          </CardRow>
          <p className="t-field-hint">{m.split_note()}</p>
        </>
      ) : (
        <Banner tone="warning">{m.split_not_splittable()}</Banner>
      )}
    </div>
  );
}
