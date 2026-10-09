import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type BookingMethod,
  bookingMethods,
  checkSite,
  countries,
  type LocatedBy,
  type SiteDetails,
  timeZoneOf,
} from '@timon/domain';
import type {
  AddressCandidateJson,
  CustomerWithSitesJson,
  IssueJson,
  SiteInputJson,
  SiteJson,
} from '@timon/http';
import { Banner, Button, Checkbox, Field, SegmentedControl, StatusBadge } from '@timon/ui';
import { type FormEvent, lazy, Suspense, useId, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText, useReferenceLists } from '../data.ts';
import { failureText, issueSentence } from '../issues.ts';
import { m } from '../paraglide/messages.js';
import { Breadcrumb } from '../resources/section.tsx';
import {
  customerKeys,
  useAddressSuggestions,
  useDebounced,
  useRefreshCustomers,
  useSite,
} from './customer-data.ts';
import { bookingMethodLabel, countryName, equipmentLabel } from './customer-labels.ts';
import {
  fromWeekDraft,
  OpeningHoursEditor,
  toWeekDraft,
  type WeekDraft,
} from './opening-hours.tsx';
import { LocatedBadge } from './section.tsx';

// The map, and Leaflet with it, load only when a site form opens.
const SiteMap = lazy(() => import('./site-map.tsx'));

export function SitePage({ id, customerId }: { id?: string; customerId?: string | undefined }) {
  const site = useSite(id);
  if (site.error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(site.error)}</Banner>
      </div>
    );
  }
  if (id && !site.data) {
    return (
      <div className="page">
        <p>{m.loading()}</p>
      </div>
    );
  }
  return (
    <SiteForm
      key={site.data?.site.updatedAt ?? 'new'}
      site={site.data?.site}
      initialNearby={site.data?.nearby ?? []}
      customerId={customerId}
    />
  );
}

type Point = { latitude: number; longitude: number };

type FormState = {
  name: string;
  street1: string;
  street2: string;
  postcode: string;
  city: string;
  country: string;
  location: Point | null;
  locatedBy: LocatedBy;
  week: WeekDraft;
  bookingRequired: boolean;
  bookingMethod: BookingMethod | null;
  bookingDetail: string;
  protectiveEquipmentIds: string[];
  maxLength: string;
  maxWeight: string;
  loadingDock: boolean;
  semiTrailersAccepted: boolean;
  gatePhone: string;
  instructions: string;
};

function initialState(s: SiteJson | undefined): FormState {
  return {
    name: s?.name ?? '',
    street1: s?.street1 ?? '',
    street2: s?.street2 ?? '',
    postcode: s?.postcode ?? '',
    city: s?.city ?? '',
    country: s?.country ?? 'FR',
    location:
      s && s.latitude !== null && s.longitude !== null
        ? { latitude: s.latitude, longitude: s.longitude }
        : null,
    locatedBy: s?.locatedBy ?? 'not-located',
    week: toWeekDraft(s?.openings ?? []),
    bookingRequired: s?.bookingRequired ?? false,
    bookingMethod: s?.bookingMethod ?? null,
    bookingDetail: s?.bookingDetail ?? '',
    protectiveEquipmentIds: s?.protectiveEquipmentIds ?? [],
    maxLength: s?.maxLengthCm ? String(s.maxLengthCm / 100) : '',
    maxWeight: s?.maxWeightKg ? String(s.maxWeightKg) : '',
    loadingDock: s?.loadingDock ?? true,
    semiTrailersAccepted: s?.semiTrailersAccepted ?? true,
    gatePhone: s?.gatePhone ?? '',
    instructions: s?.instructions ?? '',
  };
}

const number = (value: string, scale = 1) => {
  const text = value.replace(/[\s  ]/g, '').replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * scale) : Number.NaN;
};
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toInput(s: FormState): SiteInputJson {
  return {
    name: s.name,
    street1: s.street1,
    street2: orNull(s.street2),
    postcode: s.postcode,
    city: s.city,
    country: s.country,
    latitude: s.location?.latitude ?? null,
    longitude: s.location?.longitude ?? null,
    locatedBy: s.location ? s.locatedBy : 'not-located',
    openings: fromWeekDraft(s.week),
    bookingRequired: s.bookingRequired,
    bookingMethod: s.bookingRequired ? s.bookingMethod : null,
    bookingDetail: s.bookingRequired ? orNull(s.bookingDetail) : null,
    protectiveEquipmentIds: s.protectiveEquipmentIds,
    maxLengthCm: number(s.maxLength, 100),
    maxWeightKg: number(s.maxWeight),
    loadingDock: s.loadingDock,
    semiTrailersAccepted: s.semiTrailersAccepted,
    gatePhone: orNull(s.gatePhone),
    instructions: orNull(s.instructions),
  };
}

function clientIssues(s: FormState): IssueJson[] {
  const input = toInput(s);
  const details: SiteDetails = {
    ...input,
    street2: input.street2 ?? null,
    postcode: s.country === 'FR' ? input.postcode.replace(/\s/g, '') : input.postcode,
    location: s.location,
    locatedBy: s.location ? s.locatedBy : 'not-located',
    openings: input.openings.map((o) => ({ ...o, weekday: o.weekday as 1 })),
    bookingMethod: input.bookingMethod ?? null,
    bookingDetail: input.bookingDetail ?? null,
    maxLengthCm: input.maxLengthCm ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    gatePhone: input.gatePhone ?? null,
    instructions: input.instructions ?? null,
  };
  return checkSite(details).map((i) => ({ ...i }));
}

function SiteForm({
  site,
  initialNearby,
  customerId,
}: {
  site: SiteJson | undefined;
  initialNearby: readonly {
    id: string;
    name: string;
    distanceMetres: number | null;
    sameStreet: boolean;
  }[];
  customerId: string | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshCustomers();
  const lists = useReferenceLists().data;
  const [state, setState] = useState(() => initialState(site));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<IssueJson[]>([]);
  const [notice, setNotice] = useState<string>();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listboxId = useId();

  const issues = clientIssues(state);
  const shown = [
    ...issues.filter((i) => submitted || touched.has(i.field.split('.')[0] ?? i.field)),
    ...serverIssues.filter((s) => !issues.some((i) => i.field === s.field)),
  ];
  const errorFor = (field: string) => {
    const issue = shown.find((i) => i.field === field);
    return issue ? issueSentence(issue, lists) : undefined;
  };

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [field]: value }));
    setTouched((t) => new Set(t).add(field === 'week' ? 'openings' : field));
    setServerIssues((list) =>
      list.filter((i) => !i.field.startsWith(field === 'week' ? 'openings' : field)),
    );
  };

  // Typing the address again forgets a location found from the old one; a pin placed by hand stays.
  const setAddress = (field: 'street1' | 'postcode' | 'city' | 'country', value: string) => {
    setState((s) => ({
      ...s,
      [field]: value,
      ...(s.locatedBy === 'by-hand' ? {} : { location: null, locatedBy: 'not-located' as const }),
    }));
    setTouched((t) => new Set(t).add(field));
  };

  const suggestions = useAddressSuggestions(state.street1, state.country);
  const candidates = suggestionsOpen ? (suggestions.data?.candidates ?? []) : [];
  const choose = (candidate: AddressCandidateJson) => {
    setState((s) => ({
      ...s,
      street1: candidate.street || s.street1,
      postcode: candidate.postcode,
      city: candidate.city,
      location: { latitude: candidate.latitude, longitude: candidate.longitude },
      locatedBy: candidate.precision,
    }));
    setSuggestionsOpen(false);
  };

  const place = (point: Point) => {
    setState((s) => ({ ...s, location: point, locatedBy: 'by-hand' }));
  };

  // Rule 5: active sites near this one, as a warning while typing; never a refusal.
  const nearbyQuery = useDebounced({
    street1: state.street1,
    postcode: state.postcode,
    country: state.country,
    latitude: state.location?.latitude ?? null,
    longitude: state.location?.longitude ?? null,
    ...(site ? { exceptId: site.id } : {}),
  });
  const nearby = useQuery({
    queryKey: ['customers', 'nearby', nearbyQuery],
    enabled: nearbyQuery.street1.trim() !== '' || nearbyQuery.latitude !== null,
    queryFn: async () => ok(await api.sites.nearby.$post({ json: nearbyQuery })),
    placeholderData: (previous) => previous ?? [...initialNearby],
  });

  const save = useMutation({
    mutationFn: async (body: SiteInputJson) =>
      site
        ? ok(await api.sites[':id'].$put({ param: { id: site.id }, json: body }))
        : ok(await api.sites.$post({ json: body })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.site(saved.site.id), saved);
      if (!site && customerId) {
        // Created from a customer's form: the new site becomes one of its usual sites.
        const customer: CustomerWithSitesJson = await ok(
          await api.customers[':id'].$get({ param: { id: customerId } }),
        );
        await ok(
          await api.customers[':id'].$put({
            param: { id: customerId },
            json: {
              ...customer,
              contacts: customer.contacts.map(({ id, name, role, phone, email }) => ({
                id,
                name,
                role,
                phone,
                email,
              })),
              siteIds: [...customer.siteIds, saved.site.id],
            },
          }),
        );
        await refresh();
        await navigate({ to: '/customers/$id', params: { id: customerId } });
        return;
      }
      await refresh();
      const lost = saved.site.locatedBy === 'not-located' && saved.site.country === 'FR';
      if (site) setNotice(lost ? m.site_saved_not_located() : m.saved());
      else await navigate({ to: '/customers/sites/$id', params: { id: saved.site.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'invalid') {
        setServerIssues((error.body as { issues?: IssueJson[] }).issues ?? []);
      }
    },
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const param = { param: { id: site?.id ?? '' } };
      return ok(
        archived
          ? await api.sites[':id'].archive.$post(param)
          : await api.sites[':id'].restore.$post(param),
      );
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.site(saved.site.id), saved);
      await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setNotice(undefined);
    if (issues.length === 0) save.mutate(toInput(state));
  };

  const openingError = (weekday: number) =>
    errorFor(`openings.${weekday}`) ?? (weekday === 1 ? errorFor('openings') : undefined);
  const writeError =
    save.error && !(save.error instanceof ApiError && save.error.code === 'invalid')
      ? save.error
      : archive.error;
  const warnings = nearby.data ?? [];
  const equipment = lists?.protectiveEquipment ?? [];
  const countryOptions = [...countries].sort((a, b) =>
    a === 'FR' ? -1 : b === 'FR' ? 1 : countryName(a).localeCompare(countryName(b)),
  );
  const zone = timeZoneOf(state.country);
  const subtitle = site ? m.used_by({ count: site.customerIds.length }) : null;
  const backTo = customerId ? (
    <Link className="t-button" to="/customers/$id" params={{ id: customerId }}>
      {m.action_cancel()}
    </Link>
  ) : (
    <Link className="t-button" to="/customers/sites">
      {m.action_cancel()}
    </Link>
  );

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb>
          <li>
            <Link to="/customers">{m.customers_title()}</Link>
          </li>
          <li>
            <Link to="/customers/sites">{m.sites_title()}</Link>
          </li>
          <li aria-current="page">{site?.name ?? m.new_site()}</li>
        </Breadcrumb>
        <div className="page-title-row">
          <div className="page-title">
            <div>
              <h1>{site?.name ?? m.new_site()}</h1>
              {subtitle ? <span className="page-subtitle">{subtitle}</span> : null}
            </div>
          </div>
          <div className="page-actions">
            {site ? (
              <Button
                variant="danger"
                onClick={() => archive.mutate(!site.archived)}
                disabled={archive.isPending}
              >
                {site.archived ? m.action_restore() : m.action_archive()}
              </Button>
            ) : null}
            {backTo}
            <Button type="submit" form="site-form" variant="primary" disabled={save.isPending}>
              {site ? m.action_save() : m.action_create()}
            </Button>
          </div>
        </div>
      </header>

      {site?.archived ? <Banner tone="warning">{m.site_archived_banner()}</Banner> : null}
      {warnings.map((w) => (
        <Banner key={w.id} tone="warning">
          {w.distanceMetres !== null
            ? m.nearby_warning({ distance: w.distanceMetres, name: w.name })
            : m.nearby_same_street({ name: w.name })}{' '}
          <Link to="/customers/sites/$id" params={{ id: w.id }}>
            {m.action_open_site({ name: w.name })}
          </Link>
        </Banner>
      ))}
      {notice ? <Banner tone={notice === m.saved() ? 'ok' : 'warning'}>{notice}</Banner> : null}
      {writeError ? <Banner tone="conflict">{failureText(writeError, lists)}</Banner> : null}

      <form id="site-form" className="site-layout" onSubmit={submit} noValidate>
        <section className="t-panel form-grid" aria-labelledby="address-title">
          <div className="span-2 panel-title-row">
            <h2 id="address-title">{m.section_address()}</h2>
            <LocatedBadge locatedBy={state.location ? state.locatedBy : 'not-located'} />
          </div>
          <Field label={m.field_site_name()} error={errorFor('name')}>
            <input value={state.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={m.field_country()} error={errorFor('country')}>
            <select value={state.country} onChange={(e) => setAddress('country', e.target.value)}>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          </Field>
          <div className="span-2 address-field">
            <Field
              label={m.field_street()}
              error={errorFor('street1')}
              hint={
                state.country === 'FR'
                  ? suggestions.data?.available === false
                    ? m.suggestions_unavailable()
                    : m.suggestions_hint()
                  : undefined
              }
            >
              <input
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={candidates.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={candidates.length > 0 ? `${listboxId}-${active}` : undefined}
                autoComplete="off"
                value={state.street1}
                onChange={(e) => {
                  setAddress('street1', e.target.value);
                  setSuggestionsOpen(true);
                  setActive(0);
                }}
                onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                onKeyDown={(e) => {
                  if (candidates.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => (a + 1) % candidates.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => (a - 1 + candidates.length) % candidates.length);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const candidate = candidates[active];
                    if (candidate) choose(candidate);
                  } else if (e.key === 'Escape') {
                    setSuggestionsOpen(false);
                  }
                }}
              />
            </Field>
            {candidates.length > 0 ? (
              <div
                id={listboxId}
                role="listbox"
                aria-label={m.suggestions_label()}
                className="suggestions"
              >
                {candidates.map((c, index) => (
                  <div
                    key={`${c.label}-${c.latitude}`}
                    id={`${listboxId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(c);
                    }}
                  >
                    <span>{c.label}</span>
                    <span className="t-secondary">
                      {c.precision === 'address'
                        ? m.precision_address()
                        : c.precision === 'street'
                          ? m.precision_street()
                          : m.precision_city()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="span-2">
            <Field label={m.field_street2()} optional={m.optional()}>
              <input value={state.street2} onChange={(e) => set('street2', e.target.value)} />
            </Field>
          </div>
          <Field label={m.field_postcode()} error={errorFor('postcode')}>
            <input
              className="t-mono"
              value={state.postcode}
              onChange={(e) => setAddress('postcode', e.target.value)}
            />
          </Field>
          <Field label={m.field_city()} error={errorFor('city')}>
            <input value={state.city} onChange={(e) => setAddress('city', e.target.value)} />
          </Field>
        </section>

        <section className="t-panel" aria-labelledby="hours-title">
          <div className="panel-title-row">
            <h2 id="hours-title">{m.section_opening_hours()}</h2>
            <span className="t-field-hint">{m.opening_hint({ zone })}</span>
          </div>
          <OpeningHoursEditor
            week={state.week}
            onChange={(week) => set('week', week)}
            errorFor={openingError}
          />
        </section>

        <section className="t-panel" aria-labelledby="location-title">
          <div className="panel-title-row">
            <h2 id="location-title">{m.section_location()}</h2>
            <span className="location-facts">
              {state.location ? (
                <span className="t-mono">
                  {`${state.location.latitude.toFixed(5)}, ${state.location.longitude.toFixed(5)}`}
                </span>
              ) : (
                <span className="muted">{m.location_none()}</span>
              )}
              <StatusBadge tone="neutral">
                {m.time_zone_label()} · {zone}
              </StatusBadge>
            </span>
          </div>
          <Suspense fallback={<div className="site-map">{m.loading()}</div>}>
            <SiteMap location={state.location} onPlace={place} />
          </Suspense>
          <p className="t-field-hint">{m.map_hint()}</p>
          {state.location ? (
            <Button
              variant="link"
              onClick={() => setState((s) => ({ ...s, location: null, locatedBy: 'not-located' }))}
            >
              {m.action_clear_location()}
            </Button>
          ) : null}
        </section>

        <section className="t-panel form-grid" aria-labelledby="requirements-title">
          <h2 id="requirements-title">{m.section_requirements()}</h2>
          <SegmentedControl
            legend={m.field_booking()}
            value={state.bookingRequired ? 'required' : 'not-required'}
            options={[
              { value: 'not-required', label: m.booking_not_required_option() },
              { value: 'required', label: m.booking_required_option() },
            ]}
            onChange={(value) => set('bookingRequired', value === 'required')}
          />
          {state.bookingRequired ? (
            <Field label={m.field_booking_method()} error={errorFor('bookingMethod')}>
              <select
                value={state.bookingMethod ?? ''}
                onChange={(e) =>
                  set('bookingMethod', (e.target.value || null) as BookingMethod | null)
                }
              >
                <option value="" />
                {bookingMethods.map((method) => (
                  <option key={method} value={method}>
                    {bookingMethodLabel[method]?.()}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
          {state.bookingRequired ? (
            <div className="span-2">
              <Field label={m.field_booking_detail()} optional={m.optional()}>
                <input
                  value={state.bookingDetail}
                  onChange={(e) => set('bookingDetail', e.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <fieldset className="span-2 capabilities">
            <legend>{m.field_protective_equipment()}</legend>
            <div className="capability-list">
              {equipment.map((item) => (
                <Checkbox
                  key={item.id}
                  label={equipmentLabel(item)}
                  checked={state.protectiveEquipmentIds.includes(item.id)}
                  onChange={(checked) =>
                    set(
                      'protectiveEquipmentIds',
                      checked
                        ? [...state.protectiveEquipmentIds, item.id]
                        : state.protectiveEquipmentIds.filter((x) => x !== item.id),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          <Field
            label={m.field_max_length()}
            optional={m.optional()}
            error={errorFor('maxLengthCm')}
          >
            <input
              className="t-mono"
              inputMode="decimal"
              value={state.maxLength}
              onChange={(e) => set('maxLength', e.target.value)}
            />
          </Field>
          <Field
            label={m.field_max_weight()}
            optional={m.optional()}
            error={errorFor('maxWeightKg')}
          >
            <input
              className="t-mono"
              inputMode="numeric"
              value={state.maxWeight}
              onChange={(e) => set('maxWeight', e.target.value)}
            />
          </Field>
          <fieldset className="span-2 capabilities">
            <legend>{m.field_access()}</legend>
            <div className="capability-list">
              <Checkbox
                label={m.field_loading_dock()}
                checked={state.loadingDock}
                onChange={(v) => set('loadingDock', v)}
              />
              <Checkbox
                label={m.field_semi_trailers()}
                checked={state.semiTrailersAccepted}
                onChange={(v) => set('semiTrailersAccepted', v)}
              />
            </div>
          </fieldset>
          <Field label={m.field_gate_phone()} optional={m.optional()}>
            <input
              type="tel"
              className="t-mono"
              value={state.gatePhone}
              onChange={(e) => set('gatePhone', e.target.value)}
            />
          </Field>
          <span />
          <div className="span-2">
            <Field label={m.field_instructions()} optional={m.optional()}>
              <textarea
                value={state.instructions}
                onChange={(e) => set('instructions', e.target.value)}
              />
            </Field>
          </div>
        </section>
      </form>
    </div>
  );
}
