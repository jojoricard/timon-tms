import { Link, useNavigate } from '@tanstack/react-router';
import { textLimits, unitFields } from '@timon/domain';
import type {
  IssueJson,
  UnitDocumentsJson,
  UnitJson,
  UnitMemberJson,
  UnitOptionsJson,
} from '@timon/http';
import {
  Banner,
  Button,
  CardRow,
  CardStack,
  Field,
  FormGrid,
  Plate,
  StatusBadge,
  TableFrame,
} from '@timon/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText } from '../data.ts';
import { bannerError, IssueBanner, useFormIssues } from '../form.tsx';
import { type FieldLabels, failureText } from '../issues.ts';
import { formatDate } from '../labels.ts';
import { changed, useLeaveGuard } from '../leave-guard.tsx';
import { m } from '../paraglide/messages.js';
import { PageHeader } from '../resources/section.tsx';
import { useSubmit } from '../submit.ts';
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

/** On this form, `name` is the name of the unit. */
const unitLabels: FieldLabels = { name: m.field_unit_name };

/** The inputs that show their own error; `members` and the rest go to the banner. */
const unitInputs = ['name', 'start', 'end', 'powerUnitId', 'trailerId', 'driverId'];

/** What the form checks before sending: a start, a readable end after it, a vehicle. */
function unitIssues({
  start,
  startInstant,
  end,
  endInstant,
  powerUnit,
}: {
  start: string;
  startInstant: string | undefined;
  end: string;
  endInstant: string | undefined;
  powerUnit: string | null;
}): IssueJson[] {
  const issues: IssueJson[] = [];
  if (!powerUnit) issues.push({ field: 'powerUnitId', code: 'required' });
  if (!start || !startInstant) issues.push({ field: 'start', code: 'required' });
  if (end && !endInstant) issues.push({ field: 'end', code: 'required' });
  if (startInstant && endInstant && Date.parse(endInstant) <= Date.parse(startInstant)) {
    issues.push({ field: 'end', code: 'end-not-after-start' });
  }
  return issues;
}

function unitBreadcrumb(name: string) {
  return (
    <>
      <li>
        <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
          {m.resources_title()}
        </Link>
      </li>
      <li>
        <Link to="/resources/units">{m.units_title()}</Link>
      </li>
      <li aria-current="page">{name}</li>
    </>
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
  const [opened] = useState(() => ({ name, start, end, members }));
  const guard = useLeaveGuard(changed(opened, { name, start, end, members }));
  const startInstant = fromLocal(start);
  const endInstant = end ? fromLocal(end) : undefined;
  const form = useFormIssues({
    issues: unitIssues({ start, startInstant, end, endInstant, powerUnit: members['power-unit'] }),
    placed: unitInputs,
    labels: unitLabels,
  });
  const { errorFor } = form;
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
  const save = useSubmit({
    mutationFn: async () =>
      ok(
        unit
          ? await api.units[':id'].$put({ param: { id: unit.id }, json })
          : await api.units.$post({ json }),
      ),
    onSuccess: async (saved) => {
      guard.release();
      await refresh();
      await navigate({ to: '/resources/units', search: { at: toLocal(saved.start) } });
    },
    onError: form.refused,
  });
  const remove = useSubmit({
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
    if (form.submit()) save.mutate();
  };

  const choose = (role: Role, id: string | null) => {
    setMembers((current) => ({ ...current, [role]: id }));
    form.touch(unitFields[role]);
    form.touch('members');
  };
  const title = unit ? unit.name : m.new_unit();
  const writeError = bannerError(save.error) ?? remove.error;

  return (
    <div className="page">
      <PageHeader
        breadcrumb={unitBreadcrumb(title)}
        title={title}
        subtitle={m.unit_form_hint()}
        badges={
          unit ? (
            <StatusBadge tone={unitStateTone[unit.state]}>
              {unitStateLabel[unit.state]()}
            </StatusBadge>
          ) : null
        }
        actions={
          <>
            {unit ? (
              <Button variant="danger" onClick={() => remove.mutate()} busy={remove.isPending}>
                {m.action_delete_unit()}
              </Button>
            ) : null}
            <Link className="t-button" to="/resources/units">
              {m.action_cancel()}
            </Link>
            <Button type="submit" form="unit-form" variant="primary" busy={save.isPending}>
              {m.action_save_unit()}
            </Button>
          </>
        }
      />

      {guard.dialog}
      <IssueBanner issues={form.unplaced} labels={unitLabels} />
      {writeError ? <Banner tone="conflict">{failureText(writeError)}</Banner> : null}

      <form id="unit-form" ref={form.formRef} className="unit-form" onSubmit={submit} noValidate>
        <CandidateColumn
          place="power-unit"
          title={m.col_power_unit()}
          required
          placeholder={m.search_plate_or_model()}
          hint={m.power_unit_hint()}
          options={options.data}
          error={errorFor('powerUnitId')}
          chosen={members['power-unit']}
          onChoose={(id) => choose('power-unit', id)}
        />
        <CandidateColumn
          place="trailer"
          title={m.col_trailer()}
          placeholder={m.search_plate()}
          noneLabel={m.no_trailer()}
          options={options.data}
          error={errorFor('trailerId')}
          chosen={members.trailer}
          onChoose={(id) => choose('trailer', id)}
        />
        <CandidateColumn
          place="driver"
          title={m.col_driver()}
          placeholder={m.search_name()}
          noneLabel={m.no_driver()}
          options={options.data}
          error={errorFor('driverId')}
          chosen={members.driver}
          onChoose={(id) => choose('driver', id)}
        />
        <div className="unit-side">
          <section className="t-panel" aria-labelledby="period-title">
            <h2 id="period-title">{m.period_title()}</h2>
            <FormGrid>
              <Field label={m.field_start()} error={errorFor('start')}>
                <input
                  type="datetime-local"
                  className="datetime-input"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    form.touch('start');
                    form.touch('end');
                  }}
                />
              </Field>
              <Field label={m.field_end()} optional={m.optional()} error={errorFor('end')}>
                <input
                  type="datetime-local"
                  className="datetime-input"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    form.touch('end');
                  }}
                />
              </Field>
              <p className="t-field-hint t-span-all">{m.period_hint()}</p>
              <div className="t-span-all">
                <Field
                  label={m.field_unit_name()}
                  optional={m.optional()}
                  hint={m.unit_name_hint()}
                  error={errorFor('name')}
                >
                  <input
                    value={name}
                    maxLength={textLimits.unit.name}
                    onChange={(e) => {
                      setName(e.target.value);
                      form.touch('name');
                    }}
                  />
                </Field>
              </div>
            </FormGrid>
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
  error,
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
  error?: string | undefined;
  chosen: string | null;
  onChoose: (id: string | null) => void;
}) {
  const errorId = `unit-${place}-error`;
  const invalid = error
    ? ({ 'aria-invalid': true, 'aria-describedby': errorId } as const)
    : ({} as const);
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
    <fieldset className="t-panel candidate-column" data-invalid={error ? 'true' : undefined}>
      <legend className="candidate-title">
        {title}{' '}
        {required ? (
          <StatusBadge tone="petrol">{m.required_tag()}</StatusBadge>
        ) : (
          <span className="t-field-optional">{m.optional()}</span>
        )}
      </legend>
      {error ? (
        <p className="t-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
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
                {...invalid}
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
                  {...invalid}
                  onChange={() => onChoose(resource.id)}
                />
                <span className="candidate-text">
                  <span
                    className={
                      resource.kind === 'driver' ? 'candidate-name' : 'candidate-name t-nowrap'
                    }
                  >
                    {resource.kind === 'driver' ? resource.fullName : resource.name}
                  </span>
                  <span className="t-secondary">{candidateDetails(resource)}</span>
                  {reason ? <span className="candidate-reason">{reasonText(reason)}</span> : null}
                </span>
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
          <TableFrame>
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
                    <td className="t-nowrap">{d.member}</td>
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
          </TableFrame>
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
  const endForm = useFormIssues({
    issues: endInstant ? [] : [{ field: 'end', code: 'required' }],
    placed: ['end'],
  });
  const setEndMutation = useSubmit({
    mutationFn: async () =>
      ok(
        await api.units[':id'].end.$post({
          param: { id: unit.id },
          json: { end: endInstant ?? '' },
        }),
      ),
    onSuccess: refresh,
    onError: endForm.refused,
  });
  const endError = bannerError(setEndMutation.error);
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
      <PageHeader
        breadcrumb={unitBreadcrumb(unit.name)}
        title={unit.name}
        subtitle={<span className="t-mono">{periodText(unit.start, unit.end)}</span>}
        badges={
          <>
            <StatusBadge tone={unitStateTone[unit.state]}>
              {unitStateLabel[unit.state]()}
            </StatusBadge>
            <StatusBadge tone={memberStatusTone[unit.documents.status]}>
              {documentsText(unit.documents)}
            </StatusBadge>
          </>
        }
        actions={
          <>
            {unit.state === 'running' ? (
              <Button onClick={() => setChanging(true)}>{m.action_change_unit()}</Button>
            ) : null}
            <Link className="t-button" to="/resources/units">
              {m.action_back_to_units()}
            </Link>
          </>
        }
      />
      <p className="t-field-hint">{m.unit_started_hint()}</p>
      {endError ? <Banner tone="conflict">{failureText(endError)}</Banner> : null}
      <IssueBanner issues={endForm.unplaced} />
      {setEndMutation.isSuccess ? (
        <Banner tone="ok">
          {m.end_saved({ date: formatTime(setEndMutation.data.end, { year: true }) })}
        </Banner>
      ) : null}
      <CardRow columns={['2fr', '3fr']}>
        <CardStack>
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
              ref={endForm.formRef}
              className="t-panel"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (endForm.submit()) setEndMutation.mutate();
              }}
            >
              <h2>{m.action_set_end()}</h2>
              <FormGrid>
                <Field label={m.field_end()} error={endForm.errorFor('end')}>
                  <input
                    type="datetime-local"
                    className="datetime-input"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      endForm.touch('end');
                    }}
                  />
                </Field>
                <div className="form-submit">
                  <Button type="submit" variant="primary" busy={setEndMutation.isPending}>
                    {m.action_set_end()}
                  </Button>
                </div>
              </FormGrid>
            </form>
          ) : null}
        </CardStack>
        <section className="t-panel" aria-labelledby="documents-title">
          <MembersDocuments documents={unit.documents} />
        </section>
      </CardRow>
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
