import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  allowedCategories,
  canHaveBodyType,
  canPull,
  checkResource,
  type Issue,
  type ResourceDetails,
  type ResourceKind,
  type VehicleCategory,
  type VehicleKind,
  vehicleKindsOf,
} from '@timon/domain';
import type {
  DocumentJson,
  IssueJson,
  PlateOwnerJson,
  ReferenceListsJson,
  ResourceInputJson,
  ResourceJson,
} from '@timon/http';
import { Banner, Button, Checkbox, Field, Plate, SegmentedControl, StatusBadge } from '@timon/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText, keys, useReferenceLists, useRefreshResources, useResource } from '../data.ts';
import { failureText, issueSentence, ownerKind } from '../issues.ts';
import { kindSlugs, newTitle, tabLabel } from '../kinds.ts';
import {
  entryLabel,
  formatDate,
  formatDays,
  formatNumber,
  joinOr,
  severityLabel,
  severityTone,
  vehicleKindLabel,
} from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { Breadcrumb } from './section.tsx';

type Notice = { tone: 'ok' | 'warning'; text: string } | undefined;

/** Create and edit in the same form; documents once the resource exists. */
export function ResourcePage({ kind, id }: { kind: ResourceKind; id?: string }) {
  const resource = useResource(id);
  const lists = useReferenceLists();
  const [notice, setNotice] = useState<Notice>();

  const error = resource.error ?? lists.error;
  if (error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(error)}</Banner>
      </div>
    );
  }
  if (!lists.data || (id && !resource.data)) {
    return (
      <div className="page">
        <p>{m.loading()}</p>
      </div>
    );
  }
  const current = resource.data;
  return (
    <ResourceForm
      key={current?.updatedAt ?? 'new'}
      kind={current?.kind ?? kind}
      resource={current}
      lists={lists.data}
      notice={notice}
      onNotice={setNotice}
    />
  );
}

type FormState = {
  lastName: string;
  firstName: string;
  displayName: string;
  employeeNumber: string;
  phone: string;
  plate: string;
  makeModel: string;
  vehicleKind: VehicleKind | null;
  category: VehicleCategory | null;
  gvwKg: string;
  gcwKg: string;
  bodyTypeId: string;
  tradeLabelId: string;
  capabilityIds: string[];
};

function initialState(kind: ResourceKind, r: ResourceJson | undefined): FormState {
  return {
    lastName: r?.lastName ?? '',
    firstName: r?.firstName ?? '',
    displayName: r?.displayName ?? '',
    employeeNumber: r?.employeeNumber ?? '',
    phone: r?.phone ?? '',
    plate: r?.plate ?? '',
    makeModel: r?.makeModel ?? '',
    vehicleKind:
      (r?.vehicleKind as VehicleKind | null) ??
      (kind === 'driver' ? null : (vehicleKindsOf(kind)[0] ?? null)),
    category: (r?.category as VehicleCategory | null) ?? null,
    gvwKg: r?.gvwKg ? String(r.gvwKg) : '',
    gcwKg: r?.gcwKg ? String(r.gcwKg) : '',
    bodyTypeId: r?.bodyTypeId ?? '',
    tradeLabelId: r?.tradeLabelId ?? '',
    capabilityIds: r?.capabilityIds ?? [],
  };
}

const weight = (value: string) =>
  value.trim() === '' ? null : Number(value.replace(/[\s  ]/g, ''));

/** The form as the API's input, or the issues that stop it from being one. */
function toInput(kind: ResourceKind, s: FormState): { input?: ResourceInputJson; issues: Issue[] } {
  if (kind === 'driver') {
    const input = {
      kind,
      lastName: s.lastName,
      firstName: s.firstName,
      displayName: s.displayName || null,
      employeeNumber: s.employeeNumber || null,
      phone: s.phone || null,
    } as const;
    // The display name is filled by the server when left empty.
    const issues = checkResource({
      ...input,
      displayName: s.displayName || 'x',
      employeeNumber: null,
      phone: null,
    });
    return { input, issues };
  }
  const missing: Issue[] = [];
  if (!s.vehicleKind) missing.push({ field: 'vehicleKind', code: 'required' });
  if (!s.category) missing.push({ field: 'category', code: 'required' });
  if (s.gvwKg.trim() === '') missing.push({ field: 'gvwKg', code: 'required' });
  if (!s.vehicleKind || !s.category) return { issues: missing };
  const details: ResourceDetails = {
    kind,
    plate: s.plate,
    vehicleKind: s.vehicleKind,
    category: s.category,
    gvwKg: weight(s.gvwKg) ?? Number.NaN,
    gcwKg: canPull(s.vehicleKind) ? weight(s.gcwKg) : null,
    makeModel: s.makeModel || null,
    bodyTypeId: canHaveBodyType(s.vehicleKind) ? s.bodyTypeId || null : null,
    tradeLabelId: s.tradeLabelId || null,
    capabilityIds: s.capabilityIds,
  };
  const issues = [
    ...missing,
    ...checkResource(details).filter((i) => !missing.some((x) => x.field === i.field)),
  ];
  return { input: details as ResourceInputJson, issues };
}

function ResourceForm({
  kind,
  resource,
  lists,
  notice,
  onNotice,
}: {
  kind: ResourceKind;
  resource: ResourceJson | undefined;
  lists: ReferenceListsJson;
  notice: Notice;
  onNotice: (notice: Notice) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshResources();
  const [state, setState] = useState(() => initialState(kind, resource));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<IssueJson[]>([]);
  const [plateOwner, setPlateOwner] = useState<PlateOwnerJson>();

  const { input, issues } = toInput(kind, state);
  const shown = [
    ...issues.filter((i) => submitted || touched.has(i.field)),
    ...serverIssues.filter((s) => !issues.some((i) => i.field === s.field)),
  ];
  const errorFor = (field: string) => {
    const issue = shown.find((i) => i.field === field);
    return issue ? issueSentence(issue as IssueJson, lists) : undefined;
  };

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [field]: value }));
    setTouched((t) => new Set(t).add(field));
    setServerIssues((list) => list.filter((i) => i.field !== field));
    if (field === 'plate') setPlateOwner(undefined);
  };

  const save = useMutation({
    mutationFn: async (body: ResourceInputJson) =>
      resource
        ? ok(await api.resources[':id'].$put({ param: { id: resource.id }, json: body }))
        : ok(await api.resources.$post({ json: body })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(keys.resource(saved.id), saved);
      await refresh();
      if (resource) {
        onNotice({ tone: 'ok', text: m.saved() });
      } else {
        await navigate({
          to: '/resources/$kind/$id',
          params: { kind: kindSlugs[kind], id: saved.id },
        });
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      const body = error.body as { issues?: IssueJson[]; owner?: PlateOwnerJson };
      if (error.code === 'invalid') setServerIssues(body.issues ?? []);
      if (error.code === 'plate-taken') setPlateOwner(body.owner);
    },
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const param = { param: { id: resource?.id ?? '' } };
      return ok(
        archived
          ? await api.resources[':id'].archive.$post(param)
          : await api.resources[':id'].restore.$post(param),
      );
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(keys.resource(saved.id), saved);
      onNotice(
        saved.archived
          ? { tone: 'warning', text: m.archived_done({ name: saved.name }) }
          : { tone: 'ok', text: m.restored({ name: saved.name }) },
      );
      await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    onNotice(undefined);
    if (input && issues.length === 0) save.mutate(input);
  };

  const vehicleKind = state.vehicleKind;
  const categories =
    kind === 'power-unit' ? (['N1', 'N2', 'N3'] as const) : (['O1', 'O2', 'O3', 'O4'] as const);
  const kindText = vehicleKind ? vehicleKindLabel[vehicleKind]() : '';
  const writeError =
    save.error &&
    !(save.error instanceof ApiError && ['invalid', 'plate-taken'].includes(save.error.code ?? ''))
      ? save.error
      : archive.error;

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb>
          <li>
            <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
              {m.resources_title()}
            </Link>
          </li>
          <li>
            <Link to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
              {tabLabel[kind]()}
            </Link>
          </li>
          <li aria-current="page">{resource?.name ?? newTitle[kind]()}</li>
        </Breadcrumb>
        <div className="page-title-row">
          <div className="page-title">
            {resource && kind !== 'driver' ? <Plate>{resource.plate}</Plate> : null}
            <div>
              <h1>
                {!resource
                  ? newTitle[kind]()
                  : kind === 'driver'
                    ? `${resource.firstName} ${resource.lastName}`
                    : [kindText, resource.makeModel].filter(Boolean).join(' · ')}
              </h1>
              {resource && kind !== 'driver' ? (
                <span className="page-subtitle">
                  {[
                    resource.category,
                    resource.gcwKg
                      ? `${m.field_gcw()} ${formatNumber(resource.gcwKg)} ${m.kg()}`
                      : `${m.field_gvw()} ${formatNumber(resource.gvwKg ?? 0)} ${m.kg()}`,
                  ].join(' · ')}
                </span>
              ) : null}
            </div>
            {resource?.nextExpiry && resource.nextExpiry.status !== 'valid' ? (
              <StatusBadge tone={severityTone[resource.nextExpiry.severity]}>
                {entryLabel(
                  lists.documentTypes.find((t) => t.id === resource.nextExpiry?.documentTypeId),
                )}{' '}
                {formatDays(resource.nextExpiry.daysUntil)}
              </StatusBadge>
            ) : null}
          </div>
          <div className="page-actions">
            {resource ? (
              <Button
                variant="danger"
                onClick={() => archive.mutate(!resource.archived)}
                disabled={archive.isPending}
              >
                {resource.archived ? m.action_restore() : m.action_archive()}
              </Button>
            ) : null}
            <Link className="t-button" to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
              {m.action_cancel()}
            </Link>
            <Button type="submit" form="resource-form" variant="primary" disabled={save.isPending}>
              {resource ? m.action_save() : m.action_create()}
            </Button>
          </div>
        </div>
      </header>

      {resource?.archived ? <Banner tone="warning">{m.archived_banner()}</Banner> : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      {writeError ? <Banner tone="conflict">{failureText(writeError, lists)}</Banner> : null}

      <div className="resource-layout">
        <div className="resource-main">
          <form id="resource-form" className="t-panel form-grid" onSubmit={submit} noValidate>
            <h2>{m.section_identity()}</h2>
            {kind === 'driver' ? (
              <>
                <Field label={m.field_last_name()} error={errorFor('lastName')}>
                  <input
                    value={state.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                    autoComplete="family-name"
                  />
                </Field>
                <Field label={m.field_first_name()} error={errorFor('firstName')}>
                  <input
                    value={state.firstName}
                    onChange={(e) => set('firstName', e.target.value)}
                    autoComplete="given-name"
                  />
                </Field>
                <Field
                  label={m.field_display_name()}
                  optional={m.optional()}
                  hint={m.display_name_hint()}
                  error={errorFor('displayName')}
                >
                  <input
                    value={state.displayName}
                    onChange={(e) => set('displayName', e.target.value)}
                  />
                </Field>
                <Field label={m.field_employee_number()} optional={m.optional()}>
                  <input
                    value={state.employeeNumber}
                    onChange={(e) => set('employeeNumber', e.target.value)}
                  />
                </Field>
                <Field label={m.field_phone()} optional={m.optional()}>
                  <input
                    type="tel"
                    value={state.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    autoComplete="tel"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field
                  label={m.field_plate()}
                  hint={m.plate_hint()}
                  error={
                    plateOwner ? (
                      <>
                        {m.plate_taken({ name: plateOwner.name, kind: ownerKind(plateOwner) })}{' '}
                        <Link
                          to="/resources/$kind/$id"
                          params={{ kind: kindSlugs[plateOwner.kind], id: plateOwner.id }}
                        >
                          {m.action_open_named({ name: plateOwner.name })}
                        </Link>
                      </>
                    ) : (
                      errorFor('plate')
                    )
                  }
                >
                  <input
                    className="t-mono"
                    value={state.plate}
                    onChange={(e) => set('plate', e.target.value)}
                  />
                </Field>
                <Field label={m.field_make_model()} optional={m.optional()}>
                  <input
                    value={state.makeModel}
                    onChange={(e) => set('makeModel', e.target.value)}
                  />
                </Field>
                <div className="span-2">
                  <SegmentedControl
                    legend={m.field_vehicle_kind()}
                    value={vehicleKind}
                    options={vehicleKindsOf(kind).map((k) => ({
                      value: k,
                      label: vehicleKindLabel[k](),
                    }))}
                    onChange={(k) => {
                      set('vehicleKind', k);
                      if (!canHaveBodyType(k)) set('bodyTypeId', '');
                      if (!canPull(k)) set('gcwKg', '');
                    }}
                    error={errorFor('vehicleKind')}
                  />
                </div>
                <SegmentedControl
                  legend={m.field_category()}
                  value={state.category}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  onChange={(c) => set('category', c)}
                  hint={
                    vehicleKind
                      ? m.category_hint({
                          kind: kindText,
                          allowed: joinOr(allowedCategories[vehicleKind]),
                        })
                      : undefined
                  }
                  error={errorFor('category')}
                />
                <Field label={m.field_trade_label()} optional={m.optional()}>
                  <select
                    value={state.tradeLabelId}
                    onChange={(e) => set('tradeLabelId', e.target.value)}
                  >
                    <option value="">{m.none()}</option>
                    {lists.tradeLabels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {entryLabel(l)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`${m.field_gvw()} (${m.kg()})`} error={errorFor('gvwKg')}>
                  <input
                    inputMode="numeric"
                    className="t-mono"
                    value={state.gvwKg}
                    onChange={(e) => set('gvwKg', e.target.value)}
                  />
                </Field>
                {kind === 'power-unit' && vehicleKind && canPull(vehicleKind) ? (
                  <Field
                    label={`${m.field_gcw()} (${m.kg()})`}
                    optional={m.optional()}
                    error={errorFor('gcwKg')}
                  >
                    <input
                      inputMode="numeric"
                      className="t-mono"
                      value={state.gcwKg}
                      onChange={(e) => set('gcwKg', e.target.value)}
                    />
                  </Field>
                ) : (
                  <span />
                )}
                <div className="span-2">
                  <Field
                    label={m.field_body_type()}
                    optional={
                      vehicleKind && canHaveBodyType(vehicleKind) ? m.optional() : undefined
                    }
                    hint={
                      vehicleKind && !canHaveBodyType(vehicleKind)
                        ? m.body_type_tractor_hint()
                        : undefined
                    }
                    error={errorFor('bodyTypeId')}
                  >
                    <select
                      value={state.bodyTypeId}
                      disabled={!vehicleKind || !canHaveBodyType(vehicleKind)}
                      onChange={(e) => set('bodyTypeId', e.target.value)}
                    >
                      <option value="">{m.none()}</option>
                      {lists.bodyTypes.map((b) => (
                        <option key={b.id} value={b.id}>
                          {entryLabel(b)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <fieldset className="span-2 capabilities">
                  <legend>{m.section_capabilities()}</legend>
                  <p className="t-field-hint">{m.capabilities_hint()}</p>
                  <div className="capability-list">
                    {lists.capabilities.map((c) => (
                      <Checkbox
                        key={c.id}
                        label={entryLabel(c)}
                        checked={state.capabilityIds.includes(c.id)}
                        onChange={(checked) =>
                          set(
                            'capabilityIds',
                            checked
                              ? [...state.capabilityIds, c.id]
                              : state.capabilityIds.filter((x) => x !== c.id),
                          )
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              </>
            )}
          </form>
        </div>
        <section className="t-panel resource-documents" aria-labelledby="documents-title">
          <h2 id="documents-title">{m.section_documents()}</h2>
          {resource ? (
            <Documents resource={resource} lists={lists} />
          ) : (
            <p className="t-field-hint">{m.documents_after_save()}</p>
          )}
        </section>
      </div>
      {resource ? (
        <p className="footnote">
          {m.created_footer({
            created: formatDate(resource.createdAt.slice(0, 10)),
            updated: formatDate(resource.updatedAt.slice(0, 10)),
          })}
        </p>
      ) : null}
    </div>
  );
}

type DocumentDraft = {
  documentTypeId: string;
  reference: string;
  issuedOn: string;
  expiresOn: string;
};
const emptyDraft: DocumentDraft = {
  documentTypeId: '',
  reference: '',
  issuedOn: '',
  expiresOn: '',
};

function Documents({ resource, lists }: { resource: ResourceJson; lists: ReferenceListsJson }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshResources();
  const [editing, setEditing] = useState<DocumentJson>();
  const [draft, setDraft] = useState<DocumentDraft>(emptyDraft);

  const typeOf = (id: string) => lists.documentTypes.find((t) => t.id === id);
  const applicable = lists.documentTypes.filter(
    (t) =>
      t.appliesTo.includes(resource.kind) &&
      (t.id === editing?.documentTypeId ||
        !resource.documents.some((d) => d.documentTypeId === t.id)),
  );
  const selected = typeOf(draft.documentTypeId);

  const done = async (saved: ResourceJson) => {
    queryClient.setQueryData(keys.resource(saved.id), saved);
    setEditing(undefined);
    setDraft(emptyDraft);
    await refresh();
  };

  const write = useMutation({
    mutationFn: async () => {
      const json = {
        documentTypeId: draft.documentTypeId,
        reference: draft.reference || null,
        issuedOn: draft.issuedOn || null,
        expiresOn: draft.expiresOn,
      };
      return editing
        ? ok(await api.documents[':id'].$put({ param: { id: editing.id }, json }))
        : ok(await api.resources[':id'].documents.$post({ param: { id: resource.id }, json }));
    },
    onSuccess: done,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => ok(await api.documents[':id'].$delete({ param: { id } })),
    onSuccess: done,
  });

  const startEdit = (d: DocumentJson) => {
    setEditing(d);
    setDraft({
      documentTypeId: d.documentTypeId,
      reference: d.reference ?? '',
      issuedOn: d.issuedOn ?? '',
      expiresOn: d.expiresOn,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.documentTypeId && draft.expiresOn) write.mutate();
  };

  return (
    <>
      <div className="t-table-frame">
        <table className="t-table">
          <caption className="t-visually-hidden">{m.section_documents()}</caption>
          <thead>
            <tr>
              <th scope="col">{m.col_document()}</th>
              <th scope="col">{m.col_reference()}</th>
              <th scope="col">{m.col_issued()}</th>
              <th scope="col">{m.col_expires()}</th>
              <th scope="col">{m.col_status()}</th>
              <th scope="col">
                <span className="t-visually-hidden">{m.col_actions()}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {resource.documents.length === 0 ? (
              <tr>
                <td colSpan={6}>{m.documents_empty()}</td>
              </tr>
            ) : null}
            {resource.documents.map((d) => {
              const type = typeOf(d.documentTypeId);
              const label = entryLabel(type);
              return (
                <tr key={d.id}>
                  <th scope="row">
                    {label}
                    <span className="t-secondary">
                      {d.blocking ? m.rule_blocking() : m.rule_not_blocking()} ·{' '}
                      {m.rule_warns({ days: d.warnDays })}
                    </span>
                  </th>
                  <td className="t-mono">{d.reference}</td>
                  <td className="t-mono">{formatDate(d.issuedOn)}</td>
                  <td className="t-mono">{formatDate(d.expiresOn)}</td>
                  <td>
                    <StatusBadge tone={severityTone[d.severity]}>
                      {d.status === 'expiring'
                        ? formatDays(d.daysUntil)
                        : severityLabel[d.severity]()}
                    </StatusBadge>
                  </td>
                  <td className="t-end row-actions">
                    <Button
                      variant="link"
                      onClick={() => startEdit(d)}
                      aria-label={m.action_edit_named({ name: label })}
                    >
                      {m.action_edit()}
                    </Button>
                    <Button
                      variant="link"
                      onClick={() => remove.mutate(d.id)}
                      disabled={remove.isPending}
                      aria-label={m.action_remove_named({ name: label })}
                    >
                      {m.action_remove()}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="document-editor" onSubmit={submit} aria-labelledby="document-editor-title">
        <h3 id="document-editor-title">
          {editing
            ? m.editing_document({ type: entryLabel(typeOf(editing.documentTypeId)) })
            : m.adding_document()}
        </h3>
        <div className="document-fields">
          <Field label={m.field_document_type()}>
            <select
              value={draft.documentTypeId}
              disabled={editing !== undefined}
              onChange={(e) => setDraft({ ...draft, documentTypeId: e.target.value })}
            >
              <option value="" />
              {applicable.map((t) => (
                <option key={t.id} value={t.id}>
                  {entryLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={m.field_reference()} optional={m.optional()}>
            <input
              value={draft.reference}
              onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
            />
          </Field>
          <Field label={m.field_issued()} optional={m.optional()}>
            <input
              type="date"
              value={draft.issuedOn}
              onChange={(e) => setDraft({ ...draft, issuedOn: e.target.value })}
            />
          </Field>
          <Field label={m.field_expires()}>
            <input
              type="date"
              required
              value={draft.expiresOn}
              onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })}
            />
          </Field>
          <div className="document-buttons">
            <Button
              type="submit"
              variant="primary"
              disabled={!draft.documentTypeId || !draft.expiresOn || write.isPending}
            >
              {editing ? m.action_update() : m.action_add()}
            </Button>
            {editing ? (
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setDraft(emptyDraft);
                }}
              >
                {m.action_cancel()}
              </Button>
            ) : null}
          </div>
        </div>
        {selected ? (
          <p className="t-field-hint">
            {m.document_rule({
              type: entryLabel(selected),
              rule: selected.blocking ? m.rule_blocking() : m.rule_not_blocking(),
              days: selected.warnDays,
            })}
          </p>
        ) : null}
        {write.error ? (
          <p className="t-field-error" role="alert">
            {failureText(write.error, lists)}
          </p>
        ) : null}
        {remove.error ? (
          <p className="t-field-error" role="alert">
            {failureText(remove.error, lists)}
          </p>
        ) : null}
      </form>
    </>
  );
}
