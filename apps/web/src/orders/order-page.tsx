import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type AdrClass,
  adrClasses,
  checkOrder,
  formatMinutes,
  type GoodsLine,
  type Issue,
  type OrderDetails,
  type OrderSite,
  type OrderStop,
  orderRequirements,
  orderTotals,
  orderWarnings,
  type Packaging,
  packagings,
  parseTime,
  type StopKind,
  Temporal,
  textLimits,
  type Weekday,
} from '@timon/domain';
import type {
  CustomerJson,
  OrderInputJson,
  OrderJson,
  OrderWarningJson,
  SiteJson,
} from '@timon/http';
import {
  Banner,
  Button,
  CardRow,
  CardStack,
  Count,
  Dialog,
  Field,
  FormGrid,
  Plate,
  SegmentedControl,
  StatusBadge,
  Tabs,
} from '@timon/ui';
import { type FormEvent, useState } from 'react';
import { api, ifMatch, ok } from '../api.ts';
import { useCustomers, useSites } from '../customers/customer-data.ts';
import { formatRange, weekdayName } from '../customers/customer-labels.ts';
import { errorText, useReferenceLists } from '../data.ts';
import { bannerError, IssueBanner, useFormIssues } from '../form.tsx';
import { failureText, issueSentence } from '../issues.ts';
import { capitalise, entryLabel, formatLongDate } from '../labels.ts';
import { changed, useLeaveGuard } from '../leave-guard.tsx';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { useSubmit } from '../submit.ts';
import { orderKeys, useOrder, useRefreshOrders } from './order-data.ts';
import { OrderHistory } from './order-history.tsx';
import {
  floorMetres,
  goodsSummary,
  packagingLabel,
  requirementLabel,
  requirementSource,
  reviewLabel,
  statusLabel,
  statusTone,
  stopKindLabel,
  warningText,
} from './order-labels.ts';

export type OrderTab = 'order' | 'history';

/**
 * Create, edit and read in the same form. `duplicateOf` opens a new order copied from another,
 * its dates to set (criterion 16).
 */
export function OrderPage({
  id,
  duplicateOf,
  tab = 'order',
}: {
  id?: string;
  duplicateOf?: string | undefined;
  tab?: OrderTab;
}) {
  const order = useOrder(id ?? duplicateOf);
  const [notice, setNotice] = useState<string>();
  if (order.error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(order.error)}</Banner>
      </div>
    );
  }
  if ((id || duplicateOf) && !order.data) {
    return (
      <div className="page">
        <p>{m.loading()}</p>
      </div>
    );
  }
  const existing = id ? order.data : undefined;
  return (
    <OrderForm
      key={existing ? existing.updatedAt : `new-${duplicateOf ?? ''}`}
      order={existing}
      source={duplicateOf ? order.data : undefined}
      tab={existing ? tab : 'order'}
      notice={notice}
      onNotice={setNotice}
    />
  );
}

type Shape = 'one-pickup' | 'one-delivery';

type StopRow = {
  key: string;
  kind: StopKind;
  siteId: string;
  date: string;
  start: string;
  end: string;
  bookingMade: boolean;
  bookingReference: string;
};

type LineRow = {
  key: string;
  description: string;
  quantity: string;
  packaging: Packaging;
  weightKg: string;
  floorM: string;
  unNumber: string;
  adrClass: AdrClass | '';
  temperatureMin: string;
  temperatureMax: string;
  from: string;
  to: string;
};

type FormState = {
  customerId: string;
  customerReference: string;
  notes: string;
  bodyTypeId: string;
  sideLoading: boolean;
  tailLift: boolean;
  shape: Shape;
  stops: StopRow[];
  lines: LineRow[];
};

let nextKey = 0;
const newKey = (prefix: string) => `${prefix}-${++nextKey}`;

const emptyStop = (kind: StopKind): StopRow => ({
  key: newKey('stop'),
  kind,
  siteId: '',
  date: '',
  start: '',
  end: '',
  bookingMade: false,
  bookingReference: '',
});

const emptyLine = (from: string, to: string): LineRow => ({
  key: newKey('line'),
  description: '',
  quantity: '',
  packaging: 'euro-pallet',
  weightKg: '',
  floorM: '',
  unNumber: '',
  adrClass: '',
  temperatureMin: '',
  temperatureMax: '',
  from,
  to,
});

const text = (value: number | null) => (value === null ? '' : String(value));

/** The form of an order read, or of a copy whose ids and dates are left out. */
function initialState(o: OrderJson | undefined, copy: boolean): FormState {
  if (!o) {
    const pickup = emptyStop('pickup');
    const delivery = emptyStop('delivery');
    return {
      customerId: '',
      customerReference: '',
      notes: '',
      bodyTypeId: '',
      sideLoading: false,
      tailLift: false,
      shape: 'one-pickup',
      stops: [pickup, delivery],
      lines: [emptyLine(pickup.key, delivery.key)],
    };
  }
  const keys = new Map(o.stops.map((s) => [s.id, copy ? newKey('stop') : s.id]));
  const pickups = o.stops.filter((s) => s.kind === 'pickup').length;
  return {
    customerId: o.customerId,
    customerReference: o.customerReference ?? '',
    notes: o.notes ?? '',
    bodyTypeId: o.bodyTypeId ?? '',
    sideLoading: o.sideLoading,
    tailLift: o.tailLift,
    shape: pickups === 1 ? 'one-pickup' : 'one-delivery',
    stops: o.stops.map((s) => ({
      key: keys.get(s.id) ?? s.id,
      kind: s.kind,
      siteId: s.siteId,
      date: copy ? '' : (s.date ?? ''),
      start: s.start ?? '',
      end: s.end ?? '',
      bookingMade: copy ? false : s.bookingMade,
      bookingReference: copy ? '' : (s.bookingReference ?? ''),
    })),
    lines: o.lines.map((l) => ({
      key: copy ? newKey('line') : l.id,
      description: l.description,
      quantity: String(l.quantity),
      packaging: l.packaging,
      weightKg: String(l.weightKg),
      floorM: l.floorDm === null ? '' : floorMetres(l.floorDm).replace(',', '.'),
      unNumber: l.unNumber ?? '',
      adrClass: l.adrClass ?? '',
      temperatureMin: text(l.temperatureMin),
      temperatureMax: text(l.temperatureMax),
      from: keys.get(l.fromStopId) ?? l.fromStopId,
      to: keys.get(l.toStopId) ?? l.toStopId,
    })),
  };
}

/** A whole number as typed; anything else is not a number, which the rules refuse. */
const whole = (value: string) => (/^[+-]?\d+$/.test(value.trim()) ? Number(value) : Number.NaN);
const optionalWhole = (value: string) => (value.trim() === '' ? null : whole(value));
const date = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? Temporal.PlainDate.from(value) : null;
const time = (value: string) => (value === '' ? null : (parseTime(value) ?? null));

/** "1.6" or "1,6" metres → 16 decimetres. */
function decimetres(value: string): number | null {
  const typed = value.trim().replace(',', '.');
  if (typed === '') return null;
  return /^\d+(\.\d)?$/.test(typed) ? Math.round(Number(typed) * 10) : Number.NaN;
}

const sides = (s: FormState) => ({
  pickups: s.stops.filter((x) => x.kind === 'pickup'),
  deliveries: s.stops.filter((x) => x.kind === 'delivery'),
});

/** The order as the domain reads it; the single side of the shape carries every line. */
function detailsOf(s: FormState): OrderDetails {
  const { pickups, deliveries } = sides(s);
  const onlyPickup = pickups.length === 1 ? pickups[0]?.key : undefined;
  const onlyDelivery = deliveries.length === 1 ? deliveries[0]?.key : undefined;
  return {
    customerId: s.customerId,
    customerReference: s.customerReference.trim() || null,
    notes: s.notes.trim() || null,
    bodyTypeId: s.bodyTypeId || null,
    sideLoading: s.sideLoading,
    tailLift: s.tailLift,
    stops: s.stops.map(
      (x): OrderStop => ({
        id: x.key,
        kind: x.kind,
        siteId: x.siteId,
        date: date(x.date),
        startMinute: time(x.start),
        endMinute: time(x.end),
        bookingMade: x.bookingMade,
        bookingReference: x.bookingMade ? x.bookingReference.trim() || null : null,
      }),
    ),
    lines: s.lines.map(
      (l): GoodsLine => ({
        id: l.key,
        description: l.description,
        quantity: whole(l.quantity),
        packaging: l.packaging,
        weightKg: whole(l.weightKg),
        floorDm: decimetres(l.floorM),
        unNumber: l.unNumber.trim() || null,
        adrClass: l.adrClass || null,
        temperatureMin: optionalWhole(l.temperatureMin),
        temperatureMax: optionalWhole(l.temperatureMax),
        fromStopId: onlyPickup ?? l.from,
        toStopId: onlyDelivery ?? l.to,
      }),
    ),
  };
}

function toInput(s: FormState): OrderInputJson {
  const d = detailsOf(s);
  return {
    customerId: d.customerId,
    customerReference: d.customerReference,
    notes: d.notes,
    bodyTypeId: d.bodyTypeId,
    sideLoading: d.sideLoading,
    tailLift: d.tailLift,
    stops: d.stops.map((x) => ({
      id: x.id,
      kind: x.kind,
      siteId: x.siteId,
      date: x.date?.toString() ?? null,
      start: x.startMinute === null ? null : formatMinutes(x.startMinute),
      end: x.endMinute === null ? null : formatMinutes(x.endMinute),
      bookingMade: x.bookingMade,
      bookingReference: x.bookingReference,
    })),
    lines: d.lines.map((l) => ({ ...l })),
  };
}

const asOrderSite = (s: SiteJson): OrderSite => ({
  ...s,
  openings: s.openings.map((o) => ({ ...o, weekday: o.weekday as Weekday })),
});

/** An empty number is missing rather than not positive. */
function clientIssues(s: FormState, sites: ReadonlyMap<string, OrderSite>, review: boolean) {
  const check = checkOrder(detailsOf(s), sites);
  const issues: Issue[] = [...check.blocking, ...(review ? [] : check.review)];
  return issues.map((issue) => {
    const line = /^lines\.(\d+)\.(quantity|weightKg)$/.exec(issue.field);
    const row = line ? s.lines[Number(line[1])] : undefined;
    const typed = line?.[2] === 'quantity' ? row?.quantity : row?.weightKg;
    return line && typed?.trim() === '' ? { field: issue.field, code: 'required' as const } : issue;
  });
}

function OrderForm({
  order,
  source,
  tab,
  notice,
  onNotice: setNotice,
}: {
  order: OrderJson | undefined;
  source: OrderJson | undefined;
  tab: OrderTab;
  notice: string | undefined;
  onNotice: (notice: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshOrders();
  const lists = useReferenceLists().data;
  const customers = useCustomers('', 'all', true).data?.customers ?? [];
  const allSites = useSites('', 'all', true).data?.sites ?? [];
  const sites = new Map(allSites.map((s) => [s.id, asOrderSite(s)]));
  const siteName = (id: string) => sites.get(id)?.name ?? '';

  const [initial] = useState(() => initialState(order ?? source, source !== undefined));
  const [state, setState] = useState(initial);
  const [shapeHint, setShapeHint] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const readOnly = order?.status === 'cancelled';
  const guard = useLeaveGuard(!readOnly && changed(initial, state));
  const reviewAllowed = order?.status === 'to-review';

  const details = detailsOf(state);
  const form = useFormIssues({
    issues: clientIssues(state, sites, reviewAllowed).map((i) => ({ ...i })),
    placed: ['customerId', 'customerReference', 'notes', 'bodyTypeId', 'stops', 'lines'],
    lists,
  });
  const { errorFor } = form;

  const sameReference =
    order && state.customerReference === (order.customerReference ?? '')
      ? order.warnings.filter((w) => w.code === 'reference-used')
      : [];
  const warnings: OrderWarningJson[] = [
    ...orderWarnings(details, sites, []).map((w) => ({ ...w, params: { ...w.params } })),
    ...sameReference,
  ];
  const requirements = orderRequirements(details, sites).map((r) => ({
    ...r,
    params: { ...r.params },
    ids: [...r.ids],
    source: { ...r.source, lines: [...r.source.lines], siteIds: [...r.source.siteIds] },
  }));
  const totals = orderTotals(details);
  const { pickups, deliveries } = sides(state);

  const update = (patch: Partial<FormState>, touched: string) => {
    setState((s) => ({ ...s, ...patch }));
    form.touch(touched);
    setNotice(undefined);
  };
  const setStop = (key: string, patch: Partial<StopRow>) => {
    const index = state.stops.findIndex((s) => s.key === key);
    setState((s) => ({
      ...s,
      stops: s.stops.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    }));
    form.touch(`stops.${index}`);
    setNotice(undefined);
  };
  const setLine = (key: string, patch: Partial<LineRow>) => {
    const index = state.lines.findIndex((l) => l.key === key);
    setState((s) => ({
      ...s,
      lines: s.lines.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    }));
    form.touch(`lines.${index}`);
    setNotice(undefined);
  };

  /** The side that becomes single keeps one stop at most: extra stops are removed first. */
  const setShape = (shape: Shape) => {
    const single = shape === 'one-pickup' ? pickups : deliveries;
    if (single.length > 1) {
      setShapeHint(shape === 'one-pickup' ? m.shape_remove_pickups() : m.shape_remove_deliveries());
      return;
    }
    setShapeHint(undefined);
    update({ shape }, 'stops');
  };
  const addStop = (kind: StopKind) =>
    setState((s) => ({ ...s, stops: [...s.stops, emptyStop(kind)] }));
  const removeStop = (key: string) => {
    const gone = state.stops.find((s) => s.key === key);
    const rest = state.stops.filter((s) => s.key !== key);
    const fallback = rest.find((s) => s.kind === gone?.kind)?.key ?? '';
    setState((s) => ({
      ...s,
      stops: rest,
      lines: s.lines.map((l) => ({
        ...l,
        from: l.from === key ? fallback : l.from,
        to: l.to === key ? fallback : l.to,
      })),
    }));
    form.forgetServer();
  };
  const addLine = () =>
    setState((s) => ({
      ...s,
      lines: [...s.lines, emptyLine(pickups[0]?.key ?? '', deliveries[0]?.key ?? '')],
    }));
  const removeLine = (key: string) => {
    setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
    form.forgetServer();
  };

  const save = useSubmit({
    mutationFn: async (body: OrderInputJson) =>
      order
        ? ok(
            await api.orders[':id'].$put({
              param: { id: order.id },
              header: ifMatch(order.version),
              json: body,
            }),
          )
        : ok(
            await api.orders.$post({
              json: { ...body, ...(source ? { duplicatedFrom: source.id } : {}) },
            }),
          ),
    onSuccess: async (saved) => {
      guard.release();
      queryClient.setQueryData(orderKeys.order(saved.id), saved);
      await refresh();
      if (order) setNotice(m.saved());
      else await navigate({ to: '/orders/$id', params: { id: saved.id } });
    },
    onError: (error) => form.refused(error),
  });

  const cancel = useSubmit({
    mutationFn: async (reason: string) =>
      ok(
        await api.orders[':id'].cancel.$post({
          param: { id: order?.id ?? '' },
          header: ifMatch(order?.version ?? 0),
          json: { reason },
        }),
      ),
    onSuccess: async (saved) => {
      setCancelling(false);
      queryClient.setQueryData(orderKeys.order(saved.id), saved);
      await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    if (form.submit()) save.mutate(toInput(state));
  };

  const writeError = bannerError(save.error);
  const customer = customers.find((c) => c.id === state.customerId);
  const firstPickup = [...details.stops]
    .filter((s) => s.kind === 'pickup' && s.date && s.startMinute !== null)
    .sort((a, b) =>
      `${a.date}${a.startMinute}`.localeCompare(`${b.date}${b.startMinute}`, 'en', {
        numeric: true,
      }),
    )[0];
  const title = order ? (order.customer?.name ?? order.number) : m.new_order();

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <>
            <li>
              <Link to="/orders">{m.orders_title()}</Link>
            </li>
            <li aria-current="page">{order?.number ?? m.new_order()}</li>
          </>
        }
        lead={order ? <Plate>{order.number}</Plate> : null}
        title={title}
        badges={
          order ? (
            <>
              <StatusBadge tone={statusTone[order.status]}>
                {statusLabel[order.status]()}
              </StatusBadge>
              {warnings.length > 0 && !readOnly ? (
                <StatusBadge tone="warning">
                  {m.count_warnings({ count: warnings.length })}
                </StatusBadge>
              ) : null}
            </>
          ) : null
        }
        subtitle={
          [
            state.customerReference ? m.reference_is({ reference: state.customerReference }) : null,
            firstPickup?.date && firstPickup.startMinute !== null
              ? m.first_pickup_on({
                  date: formatLongDate(firstPickup.date.toString()),
                  time: formatMinutes(firstPickup.startMinute),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || null
        }
        actions={
          order ? (
            <>
              <Link className="t-button" to="/orders/new" search={{ from: order.id }}>
                {m.action_duplicate()}
              </Link>
              {readOnly ? null : (
                <>
                  <Button variant="danger" onClick={() => setCancelling(true)}>
                    {m.action_cancel_order()}
                  </Button>
                  <Button type="submit" form="order-form" variant="primary" busy={save.isPending}>
                    {m.action_save()}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Link className="t-button" to="/orders">
                {m.action_cancel()}
              </Link>
              <Button type="submit" form="order-form" variant="primary" busy={save.isPending}>
                {m.action_create()}
              </Button>
            </>
          )
        }
      >
        {order ? (
          <Tabs label={m.order_tabs_label()}>
            <li>
              <Link
                to="/orders/$id"
                params={{ id: order.id }}
                search={{}}
                aria-current={tab === 'order' ? 'page' : undefined}
              >
                {m.tab_order()}
              </Link>
            </li>
            <li>
              <Link
                to="/orders/$id"
                params={{ id: order.id }}
                search={{ tab: 'history' }}
                aria-current={tab === 'history' ? 'page' : undefined}
              >
                {m.tab_history()}
                <Count>{order.historyCount}</Count>
              </Link>
            </li>
          </Tabs>
        ) : null}
      </PageHeader>

      {guard.dialog}
      {cancelling && order ? (
        <CancelDialog
          number={order.number}
          busy={cancel.isPending}
          error={cancel.error}
          onClose={() => {
            setCancelling(false);
            cancel.reset();
          }}
          onConfirm={(reason) => cancel.mutate(reason)}
        />
      ) : null}

      {tab === 'history' && order ? (
        <OrderHistory id={order.id} lists={lists} />
      ) : (
        <>
          {readOnly ? (
            <Banner tone="warning">
              {m.order_cancelled_banner({ reason: order?.cancelReason ?? '' })}
            </Banner>
          ) : null}
          {source ? (
            <Banner tone="ok">{m.duplicate_banner({ number: source.number })}</Banner>
          ) : null}
          {order?.status === 'to-review' && order.review.length > 0 ? (
            <Banner tone="warning">
              {m.to_review_banner({ reasons: order.review.map(reviewLabel).join(' · ') })}
            </Banner>
          ) : null}
          {notice ? <Banner tone="ok">{notice}</Banner> : null}
          {writeError ? <Banner tone="conflict">{failureText(writeError, lists)}</Banner> : null}
          <IssueBanner issues={form.unplaced} lists={lists} />

          <form id="order-form" ref={form.formRef} onSubmit={submit} noValidate>
            <fieldset className="plain-fieldset" disabled={readOnly}>
              <legend className="t-visually-hidden">{title}</legend>
              <CardRow columns={['1fr', '1fr']}>
                <CardStack>
                  <section className="t-panel" aria-labelledby="order-header-title">
                    <h2 id="order-header-title" className="t-visually-hidden">
                      {m.section_order()}
                    </h2>
                    <FormGrid>
                      <Field label={m.field_customer()} error={errorFor('customerId')}>
                        <select
                          value={state.customerId}
                          onChange={(e) => update({ customerId: e.target.value }, 'customerId')}
                        >
                          <option value="">{m.choose()}</option>
                          {customers
                            .filter((c) => !c.archived || c.id === state.customerId)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.code})
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field
                        label={m.field_customer_reference()}
                        optional={m.optional()}
                        error={errorFor('customerReference')}
                      >
                        <input
                          className="t-mono"
                          value={state.customerReference}
                          maxLength={textLimits.order.customerReference}
                          onChange={(e) =>
                            update({ customerReference: e.target.value }, 'customerReference')
                          }
                        />
                      </Field>
                      <div className="t-span-all">
                        <SegmentedControl
                          legend={m.field_shape()}
                          value={pickups.length > 1 && deliveries.length > 1 ? null : state.shape}
                          options={[
                            { value: 'one-pickup', label: m.shape_one_pickup() },
                            { value: 'one-delivery', label: m.shape_one_delivery() },
                          ]}
                          onChange={setShape}
                          hint={shapeHint}
                        />
                      </div>
                    </FormGrid>
                  </section>

                  <Stops
                    state={state}
                    sites={allSites}
                    customer={customer}
                    warnings={warnings}
                    errorFor={errorFor}
                    onChange={setStop}
                    onAdd={addStop}
                    onRemove={removeStop}
                  />
                </CardStack>

                <CardStack>
                  <Goods
                    state={state}
                    totals={goodsSummary(totals)}
                    floor={totals.floorDm}
                    siteName={siteName}
                    errorFor={errorFor}
                    onChange={setLine}
                    onAdd={addLine}
                    onRemove={removeLine}
                  />

                  <section className="t-panel" aria-labelledby="requirements-title">
                    <div className="panel-title-row">
                      <h2 id="requirements-title">{m.section_requirements()}</h2>
                      <span className="t-field-hint">{m.requirements_hint()}</span>
                    </div>
                    {requirements.length === 0 ? (
                      <p className="t-field-hint">{m.requirements_empty()}</p>
                    ) : (
                      <ul className="requirement-list">
                        {requirements.map((r) => (
                          <li key={`${r.code}-${r.ids.join()}`}>
                            <StatusBadge tone="petrol">{requirementLabel(r, lists)}</StatusBadge>
                            <span className="t-secondary">
                              {requirementSource(
                                r,
                                siteName,
                                requirements.filter((x) => x.code === 'temperature').length === 1,
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <FormGrid>
                      <Field
                        label={m.field_body_type()}
                        optional={m.optional()}
                        error={errorFor('bodyTypeId')}
                      >
                        <select
                          value={state.bodyTypeId}
                          onChange={(e) => update({ bodyTypeId: e.target.value }, 'bodyTypeId')}
                        >
                          <option value="">{m.body_type_any()}</option>
                          {(lists?.bodyTypes ?? []).map((b) => (
                            <option key={b.id} value={b.id}>
                              {entryLabel(b)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="checkbox-row">
                        <label className="t-checkbox">
                          <input
                            type="checkbox"
                            checked={state.sideLoading}
                            onChange={(e) =>
                              update({ sideLoading: e.target.checked }, 'sideLoading')
                            }
                          />
                          {m.requirement_side_loading()}
                        </label>
                        <label className="t-checkbox">
                          <input
                            type="checkbox"
                            checked={state.tailLift}
                            onChange={(e) => update({ tailLift: e.target.checked }, 'tailLift')}
                          />
                          {m.requirement_tail_lift()}
                        </label>
                      </div>
                    </FormGrid>
                  </section>

                  <section className="t-panel" aria-labelledby="warnings-title">
                    <div className="panel-title-row">
                      <h2 id="warnings-title">
                        {m.section_warnings()} <Count>{warnings.length}</Count>
                      </h2>
                      <span className="t-field-hint">{m.warnings_hint()}</span>
                    </div>
                    {warnings.length === 0 ? (
                      <p className="t-field-hint">{m.warnings_empty()}</p>
                    ) : (
                      <ul className="warning-list">
                        {warnings.map((w) => (
                          <li key={`${w.code}-${w.stopId}`}>
                            {warningText(w, state.stops.find((s) => s.key === w.stopId)?.kind)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="t-panel" aria-labelledby="order-notes-title">
                    <div className="panel-title-row">
                      <h2 id="order-notes-title">{m.section_notes()}</h2>
                      <span className="t-field-hint">{m.notes_hint()}</span>
                    </div>
                    <Field
                      label={m.section_notes()}
                      optional={m.optional()}
                      hideLabel
                      error={errorFor('notes')}
                    >
                      <textarea
                        value={state.notes}
                        maxLength={textLimits.order.notes}
                        onChange={(e) => update({ notes: e.target.value }, 'notes')}
                      />
                    </Field>
                  </section>
                </CardStack>
              </CardRow>
            </fieldset>
          </form>
        </>
      )}
    </div>
  );
}

/** The sites in the picker: the customer's usual sites first, then the others. */
function SiteOptions({
  sites,
  customer,
  current,
}: {
  sites: readonly SiteJson[];
  customer: CustomerJson | undefined;
  current: string;
}) {
  const offered = sites.filter((s) => !s.archived || s.id === current);
  const usual = offered.filter((s) => customer?.siteIds.includes(s.id));
  const others = offered.filter((s) => !customer?.siteIds.includes(s.id));
  return (
    <>
      <option value="">{m.choose()}</option>
      {usual.length > 0 ? (
        <optgroup label={m.usual_sites_group()}>
          {usual.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={usual.length > 0 ? m.other_sites_group() : m.all_sites_group()}>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </optgroup>
    </>
  );
}

function Stops({
  state,
  sites,
  customer,
  warnings,
  errorFor,
  onChange,
  onAdd,
  onRemove,
}: {
  state: FormState;
  sites: readonly SiteJson[];
  customer: CustomerJson | undefined;
  warnings: readonly OrderWarningJson[];
  errorFor: (field: string) => string | undefined;
  onChange: (key: string, patch: Partial<StopRow>) => void;
  onAdd: (kind: StopKind) => void;
  onRemove: (key: string) => void;
}) {
  const { pickups, deliveries } = sides(state);
  const both = pickups.length > 1 && deliveries.length > 1;
  const many: StopKind = state.shape === 'one-pickup' ? 'delivery' : 'pickup';
  // Pickups first, then deliveries; each keeps its place in the order for its errors.
  const ordered = [...state.stops.entries()].sort(
    ([, a], [, b]) => Number(a.kind === 'delivery') - Number(b.kind === 'delivery'),
  );
  const stopsError = errorFor('stops');
  return (
    <section className="t-panel" aria-labelledby="stops-title">
      <div className="panel-title-row">
        <h2 id="stops-title">
          {m.section_stops()} <span className="t-field-hint">{m.stops_hint()}</span>
        </h2>
        <span className="t-actions">
          {both || many === 'pickup' ? (
            <Button variant="link" onClick={() => onAdd('pickup')}>
              {m.action_add_pickup()}
            </Button>
          ) : null}
          {both || many === 'delivery' ? (
            <Button variant="link" onClick={() => onAdd('delivery')}>
              {m.action_add_delivery()}
            </Button>
          ) : null}
        </span>
      </div>
      {stopsError ? <p className="t-field-error">{stopsError}</p> : null}
      <div className="stop-list t-container">
        {ordered.map(([index, stop]) => {
          const site = sites.find((s) => s.id === stop.siteId);
          const sameKind = stop.kind === 'pickup' ? pickups : deliveries;
          const day = date(stop.date)?.dayOfWeek;
          const openings = day ? (site?.openings ?? []).filter((o) => o.weekday === day) : [];
          const label = `${stopKindLabel[stop.kind]()} ${sameKind.indexOf(stop) + 1}`;
          return (
            <fieldset key={stop.key} className="stop-card">
              <legend className="t-visually-hidden">{label}</legend>
              <div className="stop-head">
                <StatusBadge tone={stop.kind === 'pickup' ? 'petrol' : 'neutral'}>
                  {stopKindLabel[stop.kind]()}
                </StatusBadge>
                {site ? (
                  <span className="t-secondary">
                    {site.street1}, {site.postcode} {site.city}
                  </span>
                ) : null}
                {sameKind.length > 1 ? (
                  <Button
                    variant="link"
                    onClick={() => onRemove(stop.key)}
                    aria-label={m.action_remove_named({ name: site?.name ?? label })}
                  >
                    {m.action_remove()}
                  </Button>
                ) : null}
              </div>
              <FormGrid columns={4}>
                <div className="t-span-all">
                  <Field label={m.col_site()} error={errorFor(`stops.${index}.siteId`)}>
                    <select
                      value={stop.siteId}
                      onChange={(e) =>
                        onChange(stop.key, { siteId: e.target.value, bookingMade: false })
                      }
                    >
                      <SiteOptions sites={sites} customer={customer} current={stop.siteId} />
                    </select>
                  </Field>
                </div>
                <Field label={m.field_date()} error={errorFor(`stops.${index}.date`)}>
                  <input
                    type="date"
                    value={stop.date}
                    onChange={(e) => onChange(stop.key, { date: e.target.value })}
                  />
                </Field>
                <Field label={m.field_from_time()} error={errorFor(`stops.${index}.start`)}>
                  <input
                    type="time"
                    value={stop.start}
                    onChange={(e) => onChange(stop.key, { start: e.target.value })}
                  />
                </Field>
                <Field label={m.field_to_time()} error={errorFor(`stops.${index}.end`)}>
                  <input
                    type="time"
                    value={stop.end}
                    onChange={(e) => onChange(stop.key, { end: e.target.value })}
                  />
                </Field>
                <div className="booking-cell">
                  {site?.bookingRequired ? (
                    <>
                      <label className="t-checkbox">
                        <input
                          type="checkbox"
                          checked={stop.bookingMade}
                          onChange={(e) => onChange(stop.key, { bookingMade: e.target.checked })}
                        />
                        {m.field_booking_made()}
                      </label>
                      {stop.bookingMade ? (
                        <Field
                          label={m.field_booking_reference()}
                          optional={m.optional()}
                          error={errorFor(`stops.${index}.bookingReference`)}
                        >
                          <input
                            className="t-mono"
                            value={stop.bookingReference}
                            maxLength={textLimits.stop.bookingReference}
                            onChange={(e) =>
                              onChange(stop.key, { bookingReference: e.target.value })
                            }
                          />
                        </Field>
                      ) : null}
                    </>
                  ) : site ? (
                    <span className="t-field-hint">{m.no_booking_needed()}</span>
                  ) : null}
                </div>
              </FormGrid>
              {warnings
                .filter((w) => w.stopId === stop.key)
                .map((w) => (
                  <p key={w.code} className="stop-warning">
                    {w.code === 'site-closed' || w.code === 'outside-opening-hours'
                      ? `${warningText(w, stop.kind)} ${
                          openings.length > 0
                            ? m.open_on({
                                ranges: openings.map(formatRange).join(' · '),
                                day: weekdayName(day ?? 1),
                              })
                            : m.closed_on({ day: weekdayName(day ?? 1) })
                        }`
                      : w.code === 'booking-to-make'
                        ? `${warningText(w, stop.kind)}${
                            site?.bookingDetail
                              ? ` ${m.booking_detail({ detail: site.bookingDetail })}`
                              : ''
                          }`
                        : warningText(w, stop.kind)}
                  </p>
                ))}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

function Goods({
  state,
  totals,
  floor,
  siteName,
  errorFor,
  onChange,
  onAdd,
  onRemove,
}: {
  state: FormState;
  totals: string;
  floor: number;
  siteName: (id: string) => string;
  errorFor: (field: string) => string | undefined;
  onChange: (key: string, patch: Partial<LineRow>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const { pickups, deliveries } = sides(state);
  const stopName = (s: StopRow, index: number) =>
    siteName(s.siteId) || `${stopKindLabel[s.kind]()} ${index + 1}`;
  const linesError = errorFor('lines');
  return (
    <section className="t-panel" aria-labelledby="goods-title">
      <div className="panel-title-row">
        <h2 id="goods-title">
          {m.section_goods()}{' '}
          <span className="t-field-hint">
            {totals}
            {floor > 0 ? ` · ${m.floor_metres_total({ metres: floorMetres(floor) })}` : ''}
          </span>
        </h2>
        <Button variant="link" onClick={onAdd}>
          {m.action_add_line()}
        </Button>
      </div>
      {linesError ? <p className="t-field-error">{linesError}</p> : null}
      <div className="line-list t-container">
        {state.lines.map((line, index) => {
          const label = m.line_label({ n: index + 1 });
          const field = (name: string) => `lines.${index}.${name}`;
          return (
            <fieldset key={line.key} className="line-row">
              <legend className="t-visually-hidden">{label}</legend>
              <FormGrid columns={4}>
                <div className="t-span-2">
                  <Field
                    label={`${index + 1}. ${m.field_description()}`}
                    error={errorFor(field('description'))}
                  >
                    <input
                      value={line.description}
                      maxLength={textLimits.goods.description}
                      onChange={(e) => onChange(line.key, { description: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={m.field_quantity()} error={errorFor(field('quantity'))}>
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={line.quantity}
                    onChange={(e) => onChange(line.key, { quantity: e.target.value })}
                  />
                </Field>
                <Field label={m.field_packaging()} error={errorFor(field('packaging'))}>
                  <select
                    value={line.packaging}
                    onChange={(e) => onChange(line.key, { packaging: e.target.value as Packaging })}
                  >
                    {packagings.map((p) => (
                      <option key={p} value={p}>
                        {capitalise(packagingLabel(p, 2).replace(/^\d+\s*/, ''))}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={m.field_weight()} error={errorFor(field('weightKg'))}>
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={line.weightKg}
                    onChange={(e) => onChange(line.key, { weightKg: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.field_floor_metres()}
                  optional={m.optional()}
                  error={errorFor(field('floorDm'))}
                >
                  <input
                    inputMode="decimal"
                    className="t-mono"
                    value={line.floorM}
                    onChange={(e) => onChange(line.key, { floorM: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.field_temperature_min()}
                  optional={m.optional()}
                  error={errorFor(field('temperatureMin'))}
                >
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={line.temperatureMin}
                    onChange={(e) => onChange(line.key, { temperatureMin: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.field_temperature_max()}
                  optional={m.optional()}
                  error={errorFor(field('temperatureMax'))}
                >
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={line.temperatureMax}
                    onChange={(e) => onChange(line.key, { temperatureMax: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.field_un_number()}
                  optional={m.optional()}
                  error={errorFor(field('unNumber'))}
                >
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={line.unNumber}
                    maxLength={4}
                    onChange={(e) => onChange(line.key, { unNumber: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.field_adr_class()}
                  optional={m.optional()}
                  error={errorFor(field('adrClass'))}
                >
                  <select
                    value={line.adrClass}
                    onChange={(e) =>
                      onChange(line.key, { adrClass: e.target.value as AdrClass | '' })
                    }
                  >
                    <option value="">{m.none()}</option>
                    {adrClasses.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                {pickups.length > 1 ? (
                  <Field label={m.field_from_stop()} error={errorFor(field('fromStopId'))}>
                    <select
                      value={line.from}
                      onChange={(e) => onChange(line.key, { from: e.target.value })}
                    >
                      <option value="">{m.choose()}</option>
                      {pickups.map((s, i) => (
                        <option key={s.key} value={s.key}>
                          {stopName(s, i)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {deliveries.length > 1 ? (
                  <Field label={m.field_to_stop()} error={errorFor(field('toStopId'))}>
                    <select
                      value={line.to}
                      onChange={(e) => onChange(line.key, { to: e.target.value })}
                    >
                      <option value="">{m.choose()}</option>
                      {deliveries.map((s, i) => (
                        <option key={s.key} value={s.key}>
                          {stopName(s, i)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <div className="t-form-actions">
                  <Button
                    variant="link"
                    onClick={() => onRemove(line.key)}
                    aria-label={m.action_remove_named({ name: line.description || label })}
                  >
                    {m.action_remove()}
                  </Button>
                </div>
              </FormGrid>
            </fieldset>
          );
        })}
      </div>
      <p className="t-field-hint">{m.goods_hint()}</p>
    </section>
  );
}

/** Rule 6: a reason, then a confirmation; the order is kept, read only. */
function CancelDialog({
  number,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  number: string;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const missing = tried && reason.trim() === '';
  return (
    <Dialog
      title={m.confirm_cancel_order_title({ number })}
      description={m.confirm_cancel_order_text()}
      size="small"
      alert
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (reason.trim() !== '') onConfirm(reason.trim());
        }}
        noValidate
      >
        <Field
          label={m.field_cancel_reason()}
          error={
            missing
              ? issueSentence({ field: 'reason', code: 'required' })
              : error
                ? failureText(error)
                : undefined
          }
        >
          <textarea
            value={reason}
            maxLength={textLimits.order.cancelReason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="t-actions t-dialog-actions">
          <Button autoFocus onClick={onClose}>
            {m.action_keep_order()}
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            {m.action_cancel_order()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
