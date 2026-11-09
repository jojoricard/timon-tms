import { Link } from '@tanstack/react-router';
import type { ResourceJson, UnitJson } from '@timon/http';
import { Banner, Button, Count, Plate, StatusBadge, TableFrame } from '@timon/ui';
import { useState } from 'react';
import { errorText } from '../data.ts';
import { m } from '../paraglide/messages.js';
import { ChangeDialog } from './change-dialog.tsx';
import { formatTime, useResourceUnits } from './unit-data.ts';
import { periodText, unitStateLabel, unitStateTone } from './unit-labels.ts';

const changedNote = {
  driver: m.note_driver_changed,
  trailer: m.note_trailer_changed,
  'power-unit': m.note_power_unit_changed,
} as const;

const newUnitLabel = {
  driver: m.action_new_unit_with_driver,
  'power-unit': m.action_new_unit_with_power_unit,
  trailer: m.action_new_unit_with_trailer,
} as const;

const searchParam = { driver: 'driver', 'power-unit': 'powerUnit', trailer: 'trailer' } as const;

/** SPEC-003 on the resource form: the units of the resource, past, running and future. */
export function ResourceUnits({ resource }: { resource: ResourceJson }) {
  const units = useResourceUnits(resource.id);
  const [changing, setChanging] = useState<UnitJson | undefined>();
  const current = units.data?.find((u) => u.state !== 'ended');
  const running = units.data?.find((u) => u.state === 'running');
  // SPEC-003, Screens: a unit with no end holds the resource for good; a new one cannot start.
  const endless = units.data?.find((u) => u.state !== 'ended' && u.end === null);

  return (
    <section className="t-panel" aria-labelledby="units-title">
      <div className="panel-title-row">
        <h2 id="units-title">
          {m.section_units()} {units.data ? <Count>{units.data.length}</Count> : null}
        </h2>
        <div className="t-actions">
          {running ? (
            <button type="button" className="t-button" onClick={() => setChanging(running)}>
              {m.action_change_from_date()}
            </button>
          ) : null}
          {/* Offered once the units are known: a unit with no end disables it (SPEC-003). */}
          {resource.archived || !units.data ? null : endless ? (
            <Button disabled aria-describedby="new-unit-reason">
              {newUnitLabel[resource.kind]()}
            </Button>
          ) : (
            <Link
              className="t-button"
              to="/resources/units/new"
              search={{ [searchParam[resource.kind]]: resource.id }}
            >
              {newUnitLabel[resource.kind]()}
            </Link>
          )}
        </div>
      </div>
      {endless && !resource.archived ? (
        <p id="new-unit-reason" className="t-field-hint">
          {m.new_unit_unavailable({ unit: endless.name })}
        </p>
      ) : null}
      {units.error ? <Banner tone="conflict">{errorText(units.error)}</Banner> : null}
      {units.data && units.data.length === 0 ? (
        <p className="t-field-hint">{m.resource_units_empty()}</p>
      ) : null}
      {units.data && units.data.length > 0 ? (
        <TableFrame>
          <table className="t-table">
            <caption className="t-visually-hidden">{m.section_units()}</caption>
            <thead>
              <tr>
                <th scope="col">{m.col_state()}</th>
                <th scope="col">{m.col_unit()}</th>
                <th scope="col">{m.col_power_unit()}</th>
                <th scope="col">{m.col_trailer()}</th>
                <th scope="col">{m.col_driver()}</th>
                <th scope="col">{m.col_from()}</th>
                <th scope="col">{m.col_until()}</th>
                <th scope="col">{m.col_note()}</th>
              </tr>
            </thead>
            <tbody>
              {units.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <StatusBadge tone={unitStateTone[u.state]}>
                      {unitStateLabel[u.state]()}
                    </StatusBadge>
                  </td>
                  <th scope="row">
                    <Link to="/resources/units/$id" params={{ id: u.id }} className="row-link">
                      {u.name}
                    </Link>
                  </th>
                  <td>
                    <Plate>{u.powerUnit.name}</Plate>
                  </td>
                  <td>
                    {u.trailer ? (
                      <Plate>{u.trailer.name}</Plate>
                    ) : (
                      <span className="muted">{m.no_trailer()}</span>
                    )}
                  </td>
                  <td>
                    {u.driver ? u.driver.fullName : <span className="muted">{m.no_driver()}</span>}
                  </td>
                  <td className="t-mono">{formatTime(u.start, { year: true })}</td>
                  <td className="t-mono">
                    {u.end ? formatTime(u.end, { year: true }) : m.open_ended()}
                  </td>
                  <td>{u.changed ? changedNote[u.changed]() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      ) : null}
      {current && !resource.archived ? (
        <p className="unit-note">
          {m.archive_unavailable({
            name:
              resource.kind === 'driver'
                ? `${resource.firstName} ${resource.lastName}`
                : resource.name,
            unit: current.name,
            period: periodText(current.start, current.end),
          })}
        </p>
      ) : null}
      {changing ? <ChangeDialog unit={changing} onClose={() => setChanging(undefined)} /> : null}
    </section>
  );
}
