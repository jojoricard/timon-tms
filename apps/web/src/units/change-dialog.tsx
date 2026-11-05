import type { UnitJson } from '@timon/http';
import { Banner, Button, Field, SegmentedControl } from '@timon/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, ok } from '../api.ts';
import { bannerError, IssueBanner, useFormIssues } from '../form.tsx';
import { failureText } from '../issues.ts';
import { m } from '../paraglide/messages.js';
import { useSubmit } from '../submit.ts';
import {
  formatTime,
  fromLocal,
  type LocalTime,
  nextHourLocal,
  useRefreshUnits,
  useUnitOptions,
} from './unit-data.ts';

type Role = 'driver' | 'trailer';
const none = '';

/**
 * From a running unit: a new driver or trailer from a date and time. Shows the two units that
 * will result; only the resources free from then that fit the unit are offered.
 */
export function ChangeDialog({
  unit,
  onClose,
  onChanged,
}: {
  unit: UnitJson;
  onClose: () => void;
  onChanged?: (started: UnitJson) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useRefreshUnits();
  const [role, setRole] = useState<Role>('driver');
  const [from, setFrom] = useState<LocalTime>(nextHourLocal());
  const [chosen, setChosen] = useState<string>(none);
  const fromInstant = fromLocal(from);
  const resourceField = role === 'driver' ? 'driverId' : 'trailerId';
  const form = useFormIssues({
    issues: fromInstant ? [] : [{ field: 'from', code: 'required' }],
    placed: ['from', 'driverId', 'trailerId', 'resourceId'],
  });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const options = useUnitOptions(
    fromInstant
      ? {
          start: fromInstant,
          ...(unit.end ? { end: unit.end } : {}),
          powerUnitId: unit.powerUnit.id,
          ...(role === 'driver' && unit.trailer ? { trailerId: unit.trailer.id } : {}),
          ...(role === 'trailer' && unit.driver ? { driverId: unit.driver.id } : {}),
          exceptUnitId: unit.id,
        }
      : undefined,
  );
  const current = role === 'driver' ? unit.driver : unit.trailer;
  const candidates = (options.data?.candidates[role] ?? []).filter(
    (c) => c.reason === null && c.resource.id !== current?.id,
  );
  const picked = candidates.find((c) => c.resource.id === chosen)?.resource ?? null;

  const change = useSubmit({
    mutationFn: async () =>
      ok(
        await api.units[':id'].change.$post({
          param: { id: unit.id },
          json: { role, resourceId: chosen === none ? null : chosen, from: fromInstant ?? '' },
        }),
      ),
    onSuccess: async (result) => {
      await refresh();
      onChanged?.(result.unit);
      onClose();
    },
    onError: form.refused,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.submit()) change.mutate();
  };
  const changeError = bannerError(change.error);

  /** The vehicles of a unit, without repeating its name when it is named after its plate. */
  const members = (name: string | null, trailer: string | null) =>
    [unit.powerUnit.name, trailer].filter((v) => v && v !== name).join(' · ');
  const newDriver = role === 'driver' ? (picked?.name ?? null) : (unit.driver?.name ?? null);
  const newTrailer = role === 'trailer' ? (picked?.name ?? null) : (unit.trailer?.name ?? null);
  const startedName = unit.customName ?? newDriver ?? unit.powerUnit.name;
  const fromText = fromInstant ? formatTime(fromInstant) : '';
  const changeLabel =
    role === 'driver'
      ? m.action_change_driver_from({ from: fromText })
      : m.action_change_trailer_from({ from: fromText });

  return (
    <dialog
      ref={dialog}
      className="t-panel change-dialog"
      aria-labelledby="change-title"
      onClose={onClose}
    >
      <form ref={form.formRef} onSubmit={submit} className="change-form" noValidate>
        <div className="panel-title-row">
          <h2 id="change-title">{m.change_title({ name: unit.name })}</h2>
          <Button variant="link" onClick={onClose} aria-label={m.action_close()}>
            ×
          </Button>
        </div>
        <p className="t-field-hint">
          {members(null, unit.trailer?.name ?? null)} ·{' '}
          {m.since_time({ start: formatTime(unit.start, { year: true }) })}
        </p>
        <div className="change-fields">
          <SegmentedControl<Role>
            legend={m.change_what()}
            value={role}
            options={[
              { value: 'driver', label: m.col_driver() },
              { value: 'trailer', label: m.col_trailer() },
            ]}
            onChange={(value) => {
              setRole(value);
              setChosen(none);
              form.forgetServer();
            }}
          />
          <Field label={m.field_from()} error={form.errorFor('from')}>
            <input
              type="datetime-local"
              className="datetime-input"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                form.touch('from');
              }}
            />
          </Field>
          <Field
            label={role === 'driver' ? m.field_new_driver() : m.field_new_trailer()}
            error={form.errorFor(resourceField) ?? form.errorFor('resourceId')}
          >
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value);
                form.touch(resourceField);
                form.touch('resourceId');
              }}
            >
              <option value={none}>{role === 'driver' ? m.no_driver() : m.no_trailer()}</option>
              {candidates.map((c) => (
                <option key={c.resource.id} value={c.resource.id}>
                  {c.resource.kind === 'driver'
                    ? `${c.resource.fullName} (${c.resource.licences.join(' · ')})`
                    : c.resource.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <h3 className="label-heading">{m.change_recorded()}</h3>
        <ul className="change-result">
          <li>
            <span className="t-badge" data-tone="neutral">
              {m.change_ends()}
            </span>
            <span>
              <strong>{unit.name}</strong> · {members(unit.name, unit.trailer?.name ?? null)}
            </span>
            <span className="t-mono">
              {formatTime(unit.start)} → {fromText}
            </span>
          </li>
          <li data-tone="petrol">
            <span className="t-badge" data-tone="petrol">
              {m.change_starts()}
            </span>
            <span>
              <strong>{startedName}</strong> · {members(startedName, newTrailer)}
            </span>
            <span className="t-mono">
              {fromText} → {unit.end ? formatTime(unit.end) : m.open_ended()}
            </span>
          </li>
        </ul>

        {picked && options.data?.licence && options.data.licence !== 'unsupported' ? (
          <Banner tone="ok">
            {role === 'driver'
              ? m.change_driver_ok({
                  name: picked.fullName,
                  from: fromText,
                  needs: options.data.licence,
                })
              : m.change_trailer_ok({ name: picked.name, from: fromText })}
          </Banner>
        ) : null}
        {changeError ? <Banner tone="conflict">{failureText(changeError)}</Banner> : null}
        <IssueBanner issues={form.unplaced} />

        <div className="t-actions dialog-actions">
          <Button onClick={onClose}>{m.action_cancel()}</Button>
          <Button type="submit" variant="primary" busy={change.isPending}>
            {changeLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
