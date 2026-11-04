import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type {
  IssueJson,
  UnitDocumentsJson,
  UnitJson,
  UnitMemberJson,
  UnitOptionsJson,
} from '@timon/http';
import { Banner, Button, Field, Plate, StatusBadge } from '@timon/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText } from '../data.ts';
import { failureText, issueSentence } from '../issues.ts';
import { formatDate } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { Breadcrumb } from '../resources/section.tsx';
import { ChangeDialog } from './change-dialog.tsx';
import {
  formatTime,
  fromLocal,
  type LocalTime,
  nextHourLocal,
  toLocal,
  useRefreshUnits,
  useUnit,
  useUnitOptions,
} from './unit-data.ts';
import {
  documentName,
  documentsText,
  memberStatusLabel,
  memberStatusTone,
  periodText,
  reasonText,
  unitStateLabel,
  unitStateTone,
} from './unit-labels.ts';
import { memberDetails } from './units-page.tsx';

type Role = 'power-unit' | 'trailer' | 'driver';

export type UnitStart = {
  start?: LocalTime | undefined;
  powerUnit?: string | undefined;
  trailer?: string | undefined;
  driver?: string | undefined;
};

/** A new unit, a unit not started yet (editable), or a started one (an end, a change). */
export function UnitPage({ id, initial }: { id?: string; initial?: UnitStart }) {
  const unit = useUnit(id);
  if (unit.error) {
    return (
      <div className="page">
        <Banner tone="conflict">{errorText(unit.error)}</Banner>
      </div>
    );
  }
  if (id && !unit.data) {
    return (
      <div className="page">
        <p>{m.loading()}</p>
      </div>
    );
  }
  if (unit.data && unit.data.state !== 'future') return <StartedUnit unit={unit.data} />;
  return <UnitForm key={unit.data?.id ?? 'new'} unit={unit.data} initial={initial ?? {}} />;
}

function UnitBreadcrumb({ name }: { name: string }) {
  return (
    <Breadcrumb>
      <li>
        <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
          {m.resources_title()}
        </Link>
      </li>
      <li>
        <Link to="/resources/units">{m.units_title()}</Link>
      </li>
      <li aria-current="page">{name}</li>
    </Breadcrumb>
  );
}

function UnitForm({ unit, initial }: { unit: UnitJson | undefined; initial: UnitStart }) {
  const navigate = useNavigate();
  const refresh = useRefreshUnits();
  const [name, setName] = useState(unit?.customName ?? '');
  const [start, setStart] = useState<LocalTime>(
    unit ? toLocal(unit.start) : (initial.start ?? nextHourLocal()),
  );
  const [end, setEnd] = useState<LocalTime>(unit?.end ? toLocal(unit.end) : '');
  const [members, setMembers] = useState<Record<Role, string | null>>({
    'power-unit': unit?.powerUnit.id ?? initial.powerUnit ?? null,
    trailer: unit?.trailer?.id ?? initial.trailer ?? null,
    driver: unit?.driver?.id ?? initial.driver ?? null,
  });
  const [issues, setIssues] = useState<IssueJson[]>([]);

  const startInstant = fromLocal(start);
  const endInstant = end ? fromLocal(end) : undefined;
  const options = useUnitOptions(
    startInstant
      ? {
          start: startInstant,
          ...(endInstant ? { end: endInstant } : {}),
          ...(members['power-unit'] ? { powerUnitId: members['power-unit'] } : {}),
          ...(members.trailer ? { trailerId: members.trailer } : {}),
          ...(members.driver ? { driverId: members.driver } : {}),
          ...(unit ? { exceptUnitId: unit.id } : {}),
        }
      : undefined,
  );

  const json = {
    name: name.trim() || null,
    powerUnitId: members['power-unit'],
    trailerId: members.trailer,
    driverId: members.driver,
    start: startInstant ?? '',
    end: endInstant ?? null,
  };
  const save = useMutation({
    mutationFn: async () =>
      ok(
        unit
          ? await api.units[':id'].$put({ param: { id: unit.id }, json })
          : await api.units.$post({ json }),
      ),
    onMutate: () => setIssues([]),
    onSuccess: async (saved) => {
      await refresh();
      await navigate({ to: '/resources/units', search: { at: toLocal(saved.start) } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'invalid') {
        setIssues((error.body as { issues?: IssueJson[] }).issues ?? []);
      }
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const response = await api.units[':id'].$delete({ param: { id: unit?.id ?? '' } });
      if (!response.ok) throw new ApiError(response.status, await response.json());
    },
    onSuccess: async () => {
      await refresh();
      await navigate({ to: '/resources/units' });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!startInstant) {
      setIssues([{ field: 'start', code: 'required' }]);
      return;
    }
    if (end && !endInstant) {
      setIssues([{ field: 'end', code: 'required' }]);
      return;
    }
    save.mutate();
  };

  const choose = (role: Role, id: string | null) =>
    setMembers((current) => ({ ...current, [role]: id }));
  const title = unit ? unit.name : m.new_unit();
  const writeError =
    save.error && !(save.error instanceof ApiError && save.error.code === 'invalid')
      ? save.error
      : remove.error;

  return (
    <div className="page">
      <header className="page-header">
        <UnitBreadcrumb name={title} />
        <div className="page-title-row">
          <div className="page-title">
            <div>
              <h1>{title}</h1>
              <span className="page-subtitle">{m.unit_form_hint()}</span>
            </div>
            {unit ? (
              <StatusBadge tone={unitStateTone[unit.state]}>
                {unitStateLabel[unit.state]()}
              </StatusBadge>
            ) : null}
          </div>
          <div className="page-actions">
            {unit ? (
              <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {m.action_delete_unit()}
              </Button>
            ) : null}
            <Link className="t-button" to="/resources/units">
              {m.action_cancel()}
            </Link>
            <Button type="submit" form="unit-form" variant="primary" disabled={save.isPending}>
              {m.action_save_unit()}
            </Button>
          </div>
        </div>
      </header>

      {issues.length > 0 ? (
        <Banner tone="conflict">
          <ul className="issue-list">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.code}`}>{issueSentence(issue)}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {writeError ? <Banner tone="conflict">{failureText(writeError)}</Banner> : null}

      <form id="unit-form" className="unit-form" onSubmit={submit} noValidate>
        <CandidateColumn
          place="power-unit"
          title={m.col_power_unit()}
          required
          placeholder={m.search_plate_or_model()}
          hint={m.power_unit_hint()}
          options={options.data}
          chosen={members['power-unit']}
          onChoose={(id) => choose('power-unit', id)}
        />
        <CandidateColumn
          place="trailer"
          title={m.col_trailer()}
          placeholder={m.search_plate()}
          noneLabel={m.no_trailer()}
          options={options.data}
          chosen={members.trailer}
          onChoose={(id) => choose('trailer', id)}
        />
        <CandidateColumn
          place="driver"
          title={m.col_driver()}
          placeholder={m.search_name()}
          noneLabel={m.no_driver()}
          options={options.data}
          chosen={members.driver}
          onChoose={(id) => choose('driver', id)}
        />
        <div className="unit-side">
          <section className="t-panel form-grid" aria-labelledby="period-title">
            <h2 id="period-title" className="span-2">
              {m.period_title()}
            </h2>
            <Field label={m.field_start()}>
              <input
                type="datetime-local"
                className="datetime-input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={m.field_end()} optional={m.optional()}>
              <input
                type="datetime-local"
                className="datetime-input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <p className="t-field-hint span-2">{m.period_hint()}</p>
            <div className="span-2">
              <Field label={m.field_unit_name()} optional={m.optional()} hint={m.unit_name_hint()}>
                <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
          </section>
          <LicencePanel options={options.data} driverId={members.driver} />
          <section className="t-panel" aria-labelledby="documents-title">
            <MembersDocuments documents={options.data?.documents ?? null} />
          </section>
        </div>
      </form>
    </div>
  );
}

function CandidateColumn({
  place,
  title,
  required,
  placeholder,
  hint,
  noneLabel,
  options,
  chosen,
  onChoose,
}: {
  place: Role;
  title: string;
  required?: boolean;
  placeholder: string;
  hint?: string;
  noneLabel?: string;
  options: UnitOptionsJson | undefined;
  chosen: string | null;
  onChoose: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const words = query.trim().toLocaleLowerCase();
  const candidates = (options?.candidates[place] ?? []).filter(
    (c) =>
      words === '' ||
      [c.resource.name, c.resource.fullName, c.resource.makeModel ?? '']
        .join(' ')
        .toLocaleLowerCase()
        .includes(words),
  );
  const name = `unit-${place}`;
  return (
    <fieldset className="t-panel candidate-column">
      <legend className="candidate-title">
        {title}{' '}
        {required ? (
          <StatusBadge tone="petrol">{m.required_tag()}</StatusBadge>
        ) : (
          <span className="t-field-optional">{m.optional()}</span>
        )}
      </legend>
      <label className="search">
        <span className="t-visually-hidden">{placeholder}</span>
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="candidates">
        {noneLabel ? (
          <li>
            <label className="candidate" data-chosen={chosen === null || undefined}>
              <input
                type="radio"
                name={name}
                checked={chosen === null}
                onChange={() => onChoose(null)}
              />
              <span className="candidate-name">{noneLabel}</span>
            </label>
          </li>
        ) : null}
        {candidates.map(({ resource, reason }) => {
          const isChosen = chosen === resource.id;
          return (
            <li key={resource.id}>
              <label
                className="candidate"
                data-chosen={isChosen || undefined}
                data-disabled={(reason && !isChosen) || undefined}
              >
                <input
                  type="radio"
                  name={name}
                  checked={isChosen}
                  disabled={reason !== null && !isChosen}
                  onChange={() => onChoose(resource.id)}
                />
                <span>
                  <span className="candidate-name">
                    {resource.kind === 'driver' ? resource.fullName : resource.name}
                  </span>
                  <span className="t-secondary">{candidateDetails(resource)}</span>
                </span>
                {reason ? <span className="candidate-reason">{reasonText(reason)}</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
      {hint ? <p className="t-field-hint">{hint}</p> : null}
    </fieldset>
  );
}

/** "Tractor · Renault T 480 · 19,000 kg", "C · CE". */
function candidateDetails(member: UnitMemberJson): string {
  const weight = (kg: number | null) =>
    kg === null ? '' : `${new Intl.NumberFormat().format(kg)} ${m.kg()}`;
  if (member.kind === 'driver') return memberDetails(member);
  return [memberDetails(member), member.category, weight(member.gvwKg)].filter(Boolean).join(' · ');
}

function LicencePanel({
  options,
  driverId,
}: {
  options: UnitOptionsJson | undefined;
  driverId: string | null;
}) {
  if (!options?.licence) return null;
  const driver = options.candidates.driver.find((c) => c.resource.id === driverId)?.resource;
  return (
    <section className="t-panel licence-panel" aria-labelledby="licence-title">
      <h2 id="licence-title" className="label-heading">
        {m.licence_needed()}
      </h2>
      {options.licence === 'unsupported' ? (
        <p>{m.reason_be()}</p>
      ) : (
        <>
          <p className="licence-category">{options.licence}</p>
          <p className="t-field-hint">
            {driver
              ? `${m.licence_holds({ name: driver.fullName, held: driver.licences.join(', ') || '—' })} `
              : ''}
            {m.licence_hint()}
          </p>
        </>
      )}
    </section>
  );
}

function MembersDocuments({ documents }: { documents: UnitDocumentsJson | null }) {
  return (
    <>
      <div className="panel-title-row">
        <h2 id="documents-title">{m.members_documents_title()}</h2>
        {documents ? (
          <StatusBadge tone={memberStatusTone[documents.status]}>
            {memberStatusLabel[documents.status]()}
          </StatusBadge>
        ) : null}
      </div>
      {documents ? (
        <>
          <table className="t-table">
            <caption className="t-visually-hidden">
              {m.members_documents_caption({ date: formatDate(documents.day) })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{m.col_member()}</th>
                <th scope="col">{m.col_document()}</th>
                <th scope="col">{m.col_expires()}</th>
                <th scope="col" className="t-end">
                  {m.col_status()}
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.documents.map((d) => (
                <tr key={`${d.resourceId}-${d.code}`}>
                  <td>{d.member}</td>
                  <td>{documentName(d)}</td>
                  <td className="t-mono">{d.expiresOn ? formatDate(d.expiresOn) : '—'}</td>
                  <td className="t-end">
                    <StatusBadge tone={memberStatusTone[d.status]}>
                      {memberStatusLabel[d.status]()}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="t-field-hint">{m.documents_warning_only()}</p>
        </>
      ) : (
        <p className="t-field-hint">{m.documents_choose_power_unit()}</p>
      )}
    </>
  );
}

/** A started unit: never edited in place. It can be given an end, or a new driver or trailer. */
function StartedUnit({ unit }: { unit: UnitJson }) {
  const navigate = useNavigate();
  const refresh = useRefreshUnits();
  const [changing, setChanging] = useState(false);
  const [end, setEnd] = useState<LocalTime>(unit.end ? toLocal(unit.end) : nextHourLocal());
  const endInstant = fromLocal(end);
  const setEndMutation = useMutation({
    mutationFn: async () =>
      ok(
        await api.units[':id'].end.$post({
          param: { id: unit.id },
          json: { end: endInstant ?? '' },
        }),
      ),
    onSuccess: refresh,
  });
  const member = (label: string, value: UnitMemberJson | null, empty: string) => (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <>
            {value.kind === 'driver' ? value.fullName : <Plate>{value.name}</Plate>}
            <span className="t-secondary">{memberDetails(value)}</span>
          </>
        ) : (
          <span className="muted">{empty}</span>
        )}
      </dd>
    </div>
  );
  return (
    <div className="page">
      <header className="page-header">
        <UnitBreadcrumb name={unit.name} />
        <div className="page-title-row">
          <div className="page-title">
            <div>
              <h1>{unit.name}</h1>
              <span className="page-subtitle t-mono">{periodText(unit.start, unit.end)}</span>
            </div>
            <StatusBadge tone={unitStateTone[unit.state]}>
              {unitStateLabel[unit.state]()}
            </StatusBadge>
            <StatusBadge tone={memberStatusTone[unit.documents.status]}>
              {documentsText(unit.documents)}
            </StatusBadge>
          </div>
          <div className="page-actions">
            {unit.state === 'running' ? (
              <Button onClick={() => setChanging(true)}>{m.action_change_unit()}</Button>
            ) : null}
            <Link className="t-button" to="/resources/units">
              {m.action_back_to_units()}
            </Link>
          </div>
        </div>
      </header>
      <p className="t-field-hint">{m.unit_started_hint()}</p>
      {setEndMutation.error ? (
        <Banner tone="conflict">{failureText(setEndMutation.error)}</Banner>
      ) : null}
      {setEndMutation.isSuccess ? (
        <Banner tone="ok">
          {m.end_saved({ date: formatTime(setEndMutation.data.end, { year: true }) })}
        </Banner>
      ) : null}
      <div className="resource-layout">
        <div className="unit-side">
          <section className="t-panel" aria-labelledby="members-title">
            <h2 id="members-title">{m.section_members()}</h2>
            <dl className="member-list">
              {member(m.col_power_unit(), unit.powerUnit, '')}
              {member(m.col_trailer(), unit.trailer, m.no_trailer())}
              {member(m.col_driver(), unit.driver, m.no_driver())}
            </dl>
          </section>
          {unit.state === 'running' ? (
            <form
              className="t-panel form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (endInstant) setEndMutation.mutate();
              }}
            >
              <h2 className="span-2">{m.action_set_end()}</h2>
              <Field label={m.field_end()}>
                <input
                  type="datetime-local"
                  className="datetime-input"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </Field>
              <div className="form-submit">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!endInstant || setEndMutation.isPending}
                >
                  {m.action_set_end()}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
        <section className="t-panel" aria-labelledby="documents-title">
          <MembersDocuments documents={unit.documents} />
        </section>
      </div>
      {changing ? (
        <ChangeDialog
          unit={unit}
          onClose={() => setChanging(false)}
          onChanged={(started) =>
            navigate({ to: '/resources/units/$id', params: { id: started.id } })
          }
        />
      ) : null}
    </div>
  );
}
