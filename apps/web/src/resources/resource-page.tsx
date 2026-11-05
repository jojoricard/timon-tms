import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  allowedCategories,
  canHaveBodyType,
  canPull,
  checkResource,
  type ResourceDetails,
  type ResourceKind,
  textLimits,
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
import {
  Banner,
  Button,
  CardRow,
  Checkbox,
  Field,
  FormGrid,
  Plate,
  SegmentedControl,
  StatusBadge,
  TableFrame,
} from '@timon/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { equipmentLabel } from '../customers/customer-labels.ts';
import { errorText, keys, useReferenceLists, useRefreshResources, useResource } from '../data.ts';
import { bannerError, IssueBanner, useFormIssues } from '../form.tsx';
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
import { changed, useLeaveGuard } from '../leave-guard.tsx';
import { m } from '../paraglide/messages.js';
import { useSubmit } from '../submit.ts';
import { ResourceUnits } from '../units/resource-units.tsx';
import { PageHeader } from './section.tsx';

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
  protectiveEquipmentIds: string[];
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
    protectiveEquipmentIds: r?.protectiveEquipmentIds ?? [],
  };
}

/** Kilograms as digits, thousands apart or not: "19 000". Undefined when it is not that. */
const weight = (value: string): number | null | undefined => {
  const digits = value.replace(/[\s\u00a0\u202f]/g, '');
  if (digits === '') return null;
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
};

/** The form as the API's input, or the issues that stop it from being one. */
function toInput(
  kind: ResourceKind,
  s: FormState,
): { input?: ResourceInputJson; issues: IssueJson[] } {
  if (kind === 'driver') {
    const input = {
      kind,
      lastName: s.lastName,
      firstName: s.firstName,
      displayName: s.displayName || null,
      employeeNumber: s.employeeNumber || null,
      phone: s.phone || null,
      protectiveEquipmentIds: s.protectiveEquipmentIds,
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
  // What the domain cannot check yet: a field left empty, a weight that is not digits.
  const missing: IssueJson[] = [];
  if (s.plate.trim() === '') missing.push({ field: 'plate', code: 'required' });
  if (!s.vehicleKind) missing.push({ field: 'vehicleKind', code: 'required' });
  if (!s.category) missing.push({ field: 'category', code: 'required' });
  if (s.gvwKg.trim() === '') missing.push({ field: 'gvwKg', code: 'required' });
  for (const field of ['gvwKg', 'gcwKg'] as const) {
    if (s[field].trim() !== '' && weight(s[field]) === undefined) {
      missing.push({ field, code: 'invalid-number', params: { value: s[field].trim() } });
    }
  }
  if (!s.vehicleKind || !s.category) return { issues: missing };
  const details: ResourceDetails = {
    kind,
    plate: s.plate,
    vehicleKind: s.vehicleKind,
    category: s.category,
    gvwKg: weight(s.gvwKg) ?? Number.NaN,
    gcwKg: canPull(s.vehicleKind) ? (weight(s.gcwKg) ?? null) : null,
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
  const [initial] = useState(() => initialState(kind, resource));
  const [state, setState] = useState(initial);
  const [plateOwner, setPlateOwner] = useState<PlateOwnerJson>();
  const [documentChanged, setDocumentChanged] = useState(false);
  const guard = useLeaveGuard(changed(initial, state) || documentChanged);

  const { input, issues } = toInput(kind, state);
  const form = useFormIssues({
    issues: issues.map((i) => ({ ...i })),
    placed: Object.keys(state),
    lists,
  });
  const { errorFor } = form;

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [field]: value }));
    form.touch(field);
    onNotice(undefined);
    if (field === 'plate') setPlateOwner(undefined);
  };
  const limit = textLimits.resource;

  const save = useSubmit({
    mutationFn: async (body: ResourceInputJson) =>
      resource
        ? ok(await api.resources[':id'].$put({ param: { id: resource.id }, json: body }))
        : ok(await api.resources.$post({ json: body })),
    onSuccess: async (saved) => {
      if (!documentChanged) guard.release();
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
      form.refused(error);
      if (error instanceof ApiError && error.code === 'plate-taken') {
        setPlateOwner((error.body as { owner?: PlateOwnerJson }).owner);
      }
    },
  });

  const archive = useSubmit({
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
      // Archived, the banner of the page says so; restored, a notice says it is back.
      onNotice(saved.archived ? undefined : { tone: 'ok', text: m.restored({ name: saved.name }) });
      await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onNotice(undefined);
    if (form.submit() && input) save.mutate(input);
  };

  const vehicleKind = state.vehicleKind;
  const categories =
    kind === 'power-unit' ? (['N1', 'N2', 'N3'] as const) : (['O1', 'O2', 'O3', 'O4'] as const);
  const kindText = vehicleKind ? vehicleKindLabel[vehicleKind]() : '';
  const writeError = bannerError(save.error, ['plate-taken']) ?? archive.error;

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
            <li>
              <Link to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
                {tabLabel[kind]()}
              </Link>
            </li>
            <li aria-current="page">{resource?.name ?? newTitle[kind]()}</li>
          </>
        }
        lead={resource && kind !== 'driver' ? <Plate>{resource.plate}</Plate> : null}
        title={
          !resource
            ? newTitle[kind]()
            : kind === 'driver'
              ? `${resource.firstName} ${resource.lastName}`
              : [kindText, resource.makeModel].filter(Boolean).join(' · ')
        }
        subtitle={
          resource && kind !== 'driver'
            ? [
                resource.category,
                resource.gcwKg
                  ? `${m.field_gcw()} ${formatNumber(resource.gcwKg)} ${m.kg()}`
                  : `${m.field_gvw()} ${formatNumber(resource.gvwKg ?? 0)} ${m.kg()}`,
              ].join(' · ')
            : null
        }
        badges={
          resource?.nextExpiry && resource.nextExpiry.status !== 'valid' ? (
            <StatusBadge tone={severityTone[resource.nextExpiry.severity]}>
              {entryLabel(
                lists.documentTypes.find((t) => t.id === resource.nextExpiry?.documentTypeId),
              )}{' '}
              {formatDays(resource.nextExpiry.daysUntil)}
            </StatusBadge>
          ) : null
        }
        actions={
          <>
            {resource ? (
              <Button
                variant="danger"
                onClick={() => archive.mutate(!resource.archived)}
                busy={archive.isPending}
              >
                {resource.archived ? m.action_restore() : m.action_archive()}
              </Button>
            ) : null}
            <Link className="t-button" to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
              {m.action_cancel()}
            </Link>
            <Button type="submit" form="resource-form" variant="primary" busy={save.isPending}>
              {resource ? m.action_save() : m.action_create()}
            </Button>
          </>
        }
      />

      {guard.dialog}
      {resource?.archived ? <Banner tone="warning">{m.archived_banner()}</Banner> : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      {writeError ? <Banner tone="conflict">{failureText(writeError, lists)}</Banner> : null}
      <IssueBanner issues={form.unplaced} lists={lists} />

      <CardRow columns={['2fr', '3fr']}>
        <form
          id="resource-form"
          ref={form.formRef}
          className="t-panel"
          onSubmit={submit}
          noValidate
        >
          <h2>{m.section_identity()}</h2>
          <FormGrid>
            {kind === 'driver' ? (
              <>
                <Field label={m.field_last_name()} error={errorFor('lastName')}>
                  <input
                    value={state.lastName}
                    maxLength={limit.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                    autoComplete="family-name"
                  />
                </Field>
                <Field label={m.field_first_name()} error={errorFor('firstName')}>
                  <input
                    value={state.firstName}
                    maxLength={limit.firstName}
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
                    maxLength={limit.displayName}
                    onChange={(e) => set('displayName', e.target.value)}
                  />
                </Field>
                <Field
                  label={m.field_employee_number()}
                  optional={m.optional()}
                  error={errorFor('employeeNumber')}
                >
                  <input
                    value={state.employeeNumber}
                    maxLength={limit.employeeNumber}
                    onChange={(e) => set('employeeNumber', e.target.value)}
                  />
                </Field>
                <Field label={m.field_phone()} optional={m.optional()} error={errorFor('phone')}>
                  <input
                    type="tel"
                    value={state.phone}
                    maxLength={limit.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    autoComplete="tel"
                  />
                </Field>
                <fieldset className="t-span-all capabilities">
                  <legend>{m.section_driver_protective_equipment()}</legend>
                  <p className="t-field-hint">
                    {m.pe_held({
                      held: state.protectiveEquipmentIds.length,
                      total: lists.protectiveEquipment.length,
                    })}
                  </p>
                  <div className="capability-list">
                    {lists.protectiveEquipment.map((item) => (
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
                  <p className="t-field-hint">{m.pe_hint()}</p>
                </fieldset>
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
                    maxLength={limit.plate}
                    onChange={(e) => set('plate', e.target.value)}
                  />
                </Field>
                <Field
                  label={m.field_make_model()}
                  optional={m.optional()}
                  error={errorFor('makeModel')}
                >
                  <input
                    value={state.makeModel}
                    maxLength={limit.makeModel}
                    onChange={(e) => set('makeModel', e.target.value)}
                  />
                </Field>
                <div className="t-span-all">
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
                <div className="t-span-all">
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
                <fieldset className="t-span-all capabilities">
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
          </FormGrid>
        </form>
        <section className="t-panel resource-documents" aria-labelledby="documents-title">
          <h2 id="documents-title">{m.section_documents()}</h2>
          {resource ? (
            <Documents
              resource={resource}
              lists={lists}
              onChanged={setDocumentChanged}
              onAction={() => onNotice(undefined)}
            />
          ) : (
            <p className="t-field-hint">{m.documents_after_save()}</p>
          )}
        </section>
      </CardRow>
      {resource ? <ResourceUnits resource={resource} /> : null}
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

/** The rules a document's form checks before sending, as the API checks them. */
function draftIssues(draft: DocumentDraft): IssueJson[] {
  const issues: IssueJson[] = [];
  if (!draft.documentTypeId) issues.push({ field: 'documentTypeId', code: 'required' });
  if (!draft.expiresOn) issues.push({ field: 'expiresOn', code: 'required' });
  if (draft.issuedOn && draft.expiresOn && draft.issuedOn > draft.expiresOn) {
    issues.push({ field: 'issuedOn', code: 'issued-after-expiry' });
  }
  return issues;
}

const documentFields = ['documentTypeId', 'reference', 'issuedOn', 'expiresOn'];

function Documents({
  resource,
  lists,
  onChanged,
  onAction,
}: {
  resource: ResourceJson;
  lists: ReferenceListsJson;
  /** Whether the document form holds input not saved yet, for the page to keep it. */
  onChanged: (changed: boolean) => void;
  /** A document is written or removed: the notice of an earlier action goes. */
  onAction: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefreshResources();
  const [editing, setEditing] = useState<DocumentJson>();
  const [draft, setDraft] = useState<DocumentDraft>(emptyDraft);
  const [editRequest, setEditRequest] = useState(0);
  const original: DocumentDraft = editing
    ? {
        documentTypeId: editing.documentTypeId,
        reference: editing.reference ?? '',
        issuedOn: editing.issuedOn ?? '',
        expiresOn: editing.expiresOn,
      }
    : emptyDraft;
  const draftChanged = changed(original, draft);
  useEffect(() => onChanged(draftChanged), [draftChanged, onChanged]);
  const form = useFormIssues({ issues: draftIssues(draft), placed: documentFields, lists });
  const change = (field: keyof DocumentDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    form.touch(field);
  };

  // Editing a row brings its form into view, the focus on the first field it can change.
  useEffect(() => {
    if (editRequest === 0) return;
    const editor = form.formRef.current;
    editor?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    editor
      ?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [editRequest, form.formRef]);

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
    form.clear();
    await refresh();
  };

  const write = useSubmit({
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
    onError: form.refused,
  });

  const remove = useSubmit({
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
    form.clear();
    setEditRequest((n) => n + 1);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.submit()) {
      onAction();
      write.mutate();
    }
  };
  const writeError = bannerError(write.error) ?? remove.error;

  return (
    <>
      <TableFrame actions>
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
                  <td>
                    <span className="t-mono">{formatDate(d.expiresOn)}</span>
                    {d.status !== 'valid' ? (
                      <span className="t-secondary">{formatDays(d.daysUntil)}</span>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge tone={severityTone[d.severity]}>
                      {severityLabel[d.severity]()}
                    </StatusBadge>
                  </td>
                  <td className="t-end">
                    <span className="row-actions">
                      <Button
                        variant="link"
                        onClick={() => startEdit(d)}
                        aria-label={m.action_edit_named({ name: label })}
                      >
                        {m.action_edit()}
                      </Button>
                      <Button
                        variant="link"
                        onClick={() => {
                          onAction();
                          remove.mutate(d.id);
                        }}
                        busy={remove.isPending}
                        aria-label={m.action_remove_named({ name: label })}
                      >
                        {m.action_remove()}
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>

      <form
        ref={form.formRef}
        className="document-editor t-container"
        onSubmit={submit}
        aria-labelledby="document-editor-title"
        noValidate
      >
        <h3 id="document-editor-title">
          {editing
            ? m.editing_document({ type: entryLabel(typeOf(editing.documentTypeId)) })
            : m.adding_document()}
        </h3>
        <FormGrid columns={4}>
          <Field label={m.field_document_type()} error={form.errorFor('documentTypeId')}>
            <select
              value={draft.documentTypeId}
              disabled={editing !== undefined}
              onChange={(e) => change('documentTypeId', e.target.value)}
            >
              <option value="" />
              {applicable.map((t) => (
                <option key={t.id} value={t.id}>
                  {entryLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={m.field_reference()}
            optional={m.optional()}
            error={form.errorFor('reference')}
          >
            <input
              value={draft.reference}
              maxLength={textLimits.document.reference}
              onChange={(e) => change('reference', e.target.value)}
            />
          </Field>
          <Field label={m.field_issued()} optional={m.optional()} error={form.errorFor('issuedOn')}>
            <input
              type="date"
              value={draft.issuedOn}
              onChange={(e) => change('issuedOn', e.target.value)}
            />
          </Field>
          <Field label={m.field_expires()} error={form.errorFor('expiresOn')}>
            <input
              type="date"
              required
              value={draft.expiresOn}
              onChange={(e) => change('expiresOn', e.target.value)}
            />
          </Field>
          <div className="t-form-actions">
            <Button type="submit" variant="primary" busy={write.isPending}>
              {editing ? m.action_update() : m.action_add()}
            </Button>
            {editing ? (
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setDraft(emptyDraft);
                  form.clear();
                }}
              >
                {m.action_cancel()}
              </Button>
            ) : null}
          </div>
        </FormGrid>
        {selected ? (
          <p className="t-field-hint">
            {m.document_rule({
              type: entryLabel(selected),
              rule: selected.blocking ? m.rule_blocking() : m.rule_not_blocking(),
              days: selected.warnDays,
            })}
          </p>
        ) : null}
        {writeError ? (
          <p className="t-field-error" role="alert">
            {failureText(writeError, lists)}
          </p>
        ) : null}
        {form.unplaced.length > 0 ? (
          <p className="t-field-error" role="alert">
            {form.unplaced.map((issue) => issueSentence(issue, lists)).join(' ')}
          </p>
        ) : null}
      </form>
    </>
  );
}
