import { Link, useNavigate } from '@tanstack/react-router';
import type { UnitJson, UnitMemberJson, UnitsAtJson } from '@timon/http';
import {
  Banner,
  Button,
  CardRow,
  Chip,
  ChipGroup,
  Columns,
  Plate,
  StatusBadge,
  TableFrame,
} from '@timon/ui';
import { useState } from 'react';
import { errorText, useReferenceLists } from '../data.ts';
import { entryLabel, vehicleKindLabel } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { PageHeader, SectionTabs } from '../resources/section.tsx';
import { ChangeDialog } from './change-dialog.tsx';
import {
  addDays,
  formatTime,
  fromLocal,
  type LocalTime,
  nowLocal,
  toLocal,
  useUnitsAt,
} from './unit-data.ts';
import { documentsText, memberStatusTone } from './unit-labels.ts';

type Filter = 'all' | 'documents' | 'no-driver';

const groups = [
  { kind: 'tractor', label: m.group_tractors },
  { kind: 'rigid-truck', label: m.group_rigid_trucks },
  { kind: 'light-van', label: m.group_light_vans },
] as const;

/** Lower case and without accents, for a search that forgives both. */
const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const hasDocumentProblem = (u: UnitJson) =>
  u.documents.status === 'expired' || u.documents.status === 'missing';

function matches(unit: UnitJson, query: string): boolean {
  const words = [
    unit.name,
    unit.powerUnit.name,
    unit.powerUnit.makeModel ?? '',
    unit.trailer?.name ?? '',
    unit.driver?.fullName ?? '',
    unit.driver?.name ?? '',
  ];
  const haystack = searchable(words.join(' '));
  return searchable(query)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** The units valid at a date and time, now by default, and the resources left free. */
export function UnitsPage({ at }: { at?: LocalTime | undefined }) {
  const navigate = useNavigate();
  const data = useUnitsAt(at);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [changing, setChanging] = useState<UnitJson | undefined>();
  const shown = at ?? (data.data ? toLocal(data.data.at) : nowLocal());
  const go = (next: LocalTime | undefined) =>
    navigate({ to: '/resources/units', search: next ? { at: next } : {} });

  const units = data.data?.units ?? [];
  const searched = units.filter((u) => query.trim() === '' || matches(u, query.trim()));
  const counts: Record<Filter, number> = {
    all: searched.length,
    documents: searched.filter(hasDocumentProblem).length,
    'no-driver': searched.filter((u) => !u.driver).length,
  };
  const visible = searched.filter(
    (u) => filter === 'all' || (filter === 'documents' ? hasDocumentProblem(u) : u.driver === null),
  );

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
            <li aria-current="page">{m.units_title()}</li>
          </>
        }
        title={m.units_title()}
        subtitle={data.data ? m.units_subtitle({ count: units.length }) : null}
        actions={
          <Link
            className="t-button"
            data-variant="primary"
            to="/resources/units/new"
            search={at ? { start: at } : {}}
          >
            {m.action_new_unit()}
          </Link>
        }
      >
        <SectionTabs current="units" />
      </PageHeader>

      <div className="toolbar">
        <div className="toolbar-start">
          <div className="moment-picker">
            <Button aria-label={m.units_previous_day()} onClick={() => go(addDays(shown, -1))}>
              ‹
            </Button>
            <label>
              <span className="t-visually-hidden">{m.units_at_label()}</span>
              <input
                type="datetime-local"
                className="datetime-input"
                value={shown}
                onChange={(e) => {
                  if (fromLocal(e.target.value)) go(e.target.value);
                }}
              />
            </label>
            <Button aria-label={m.units_next_day()} onClick={() => go(addDays(shown, 1))}>
              ›
            </Button>
            <Button onClick={() => go(undefined)}>{m.units_now()}</Button>
          </div>
          <label className="search">
            <span className="t-visually-hidden">{m.search_label()}</span>
            <input
              type="search"
              value={query}
              placeholder={m.search_units()}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <ChipGroup label={m.filters_label()}>
          <Chip pressed={filter === 'all'} onClick={() => setFilter('all')} count={counts.all}>
            {m.filter_all()}
          </Chip>
          <Chip
            pressed={filter === 'documents'}
            onClick={() => setFilter('documents')}
            count={counts.documents}
            tone="conflict"
          >
            {m.filter_document_problem()}
          </Chip>
          <Chip
            pressed={filter === 'no-driver'}
            onClick={() => setFilter('no-driver')}
            count={counts['no-driver']}
          >
            {m.no_driver()}
          </Chip>
        </ChipGroup>
      </div>

      {data.error ? <Banner tone="conflict">{errorText(data.error)}</Banner> : null}
      {data.data ? (
        <CardRow columns={['1fr', 'var(--well-width)']} stackBelow="wide">
          <div className="units-main">
            <TableFrame>
              <UnitTable units={visible} onChange={setChanging} />
            </TableFrame>
            <p className="footnote">{m.units_footer()}</p>
          </div>
          <FreePanel free={data.data.free} at={data.data.at} />
        </CardRow>
      ) : (
        <p>{m.loading()}</p>
      )}
      {changing ? <ChangeDialog unit={changing} onClose={() => setChanging(undefined)} /> : null}
    </div>
  );
}

function UnitTable({
  units,
  onChange,
}: {
  units: readonly UnitJson[];
  onChange: (unit: UnitJson) => void;
}) {
  const lists = useReferenceLists().data;
  const bodyType = (member: UnitMemberJson | null) =>
    entryLabel(lists?.bodyTypes.find((b) => b.id === member?.bodyTypeId));
  return (
    <table className="t-table">
      <caption className="t-visually-hidden">{m.units_title()}</caption>
      <Columns widths={[10, 12, 12, 15, 9, 9, 25, 8]} />
      <thead>
        <tr>
          <th scope="col">{m.col_unit()}</th>
          <th scope="col">{m.col_power_unit()}</th>
          <th scope="col">{m.col_trailer()}</th>
          <th scope="col">{m.col_driver()}</th>
          <th scope="col">{m.col_since()}</th>
          <th scope="col">{m.col_until()}</th>
          <th scope="col" className="t-end">
            {m.col_members_documents()}
          </th>
          <th scope="col">
            <span className="t-visually-hidden">{m.col_actions()}</span>
          </th>
        </tr>
      </thead>
      {units.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={8}>{m.units_empty()}</td>
          </tr>
        </tbody>
      ) : null}
      {groups.map((group) => {
        const rows = units.filter((u) => u.powerUnit.vehicleKind === group.kind);
        if (rows.length === 0) return null;
        return (
          <tbody key={group.kind}>
            <tr className="group-row">
              <th scope="colgroup" colSpan={8}>
                {group.label()} · {rows.length}
              </th>
            </tr>
            {rows.map((u) => (
              <tr key={u.id}>
                <th scope="row">
                  <Link to="/resources/units/$id" params={{ id: u.id }} className="row-link">
                    {u.name}
                  </Link>
                </th>
                <td>
                  <Plate>{u.powerUnit.name}</Plate>
                  <span className="t-secondary">{u.powerUnit.makeModel}</span>
                </td>
                <td>
                  {u.trailer ? (
                    <>
                      <Plate>{u.trailer.name}</Plate>
                      <span className="t-secondary">{bodyType(u.trailer)}</span>
                    </>
                  ) : (
                    <>
                      <span className="muted">{m.no_trailer()}</span>
                      <span className="t-secondary">{bodyType(u.powerUnit)}</span>
                    </>
                  )}
                </td>
                <td>
                  {u.driver ? (
                    <>
                      {u.driver.fullName}
                      <span className="t-secondary t-mono">{u.driver.licences.join(' · ')}</span>
                    </>
                  ) : (
                    <StatusBadge tone="warning">{m.no_driver()}</StatusBadge>
                  )}
                </td>
                <td className="t-mono">{formatTime(u.start)}</td>
                <td className="t-mono">{u.end ? formatTime(u.end) : m.open_ended()}</td>
                <td className="t-end">
                  <StatusBadge tone={memberStatusTone[u.documents.status]}>
                    {documentsText(u.documents)}
                  </StatusBadge>
                </td>
                <td className="t-end">
                  {u.state === 'running' ? (
                    <Button
                      variant="link"
                      onClick={() => onChange(u)}
                      aria-label={m.action_change_unit_named({ name: u.name })}
                    >
                      {m.action_change_short()}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

const shortList = 3;

function FreePanel({ free, at }: { free: UnitsAtJson['free']; at: string }) {
  const sections = [
    { role: 'driver', title: m.free_drivers, param: 'driver' },
    { role: 'power-unit', title: m.free_power_units, param: 'powerUnit' },
    { role: 'trailer', title: m.free_trailers, param: 'trailer' },
  ] as const;
  return (
    <aside className="t-panel free-panel" aria-labelledby="free-title">
      <div className="panel-title-row">
        <h2 id="free-title">{m.free_title()}</h2>
        <span className="t-mono muted">{formatTime(at)}</span>
      </div>
      <p className="t-field-hint">{m.free_hint()}</p>
      <div className="free-lists">
        {sections.map((section) => (
          <FreeList
            key={section.role}
            title={section.title({ count: free[section.role].length })}
            members={free[section.role]}
            start={toLocal(at)}
            param={section.param}
          />
        ))}
      </div>
    </aside>
  );
}

function FreeList({
  title,
  members,
  start,
  param,
}: {
  title: string;
  members: readonly UnitMemberJson[];
  start: LocalTime;
  param: 'driver' | 'powerUnit' | 'trailer';
}) {
  const [all, setAll] = useState(false);
  const shown = all ? members : members.slice(0, shortList);
  return (
    <section className="free-list" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {shown.map((member) => (
          <li key={member.id}>
            <span>
              <span className="free-name">
                {member.kind === 'driver' ? member.fullName : member.name}
              </span>
              <span className="t-secondary">{memberDetails(member)}</span>
            </span>
            <Link
              to="/resources/units/new"
              search={{ start, [param]: member.id }}
              aria-label={m.action_start_unit_named({ name: member.fullName })}
            >
              {m.action_start_unit()}
            </Link>
          </li>
        ))}
      </ul>
      {members.length > shortList && !all ? (
        <Button variant="link" onClick={() => setAll(true)}>
          {m.free_more({ count: members.length - shortList })}
        </Button>
      ) : null}
    </section>
  );
}

/** "C · CE" for a driver, "Tractor · Renault T 480" for a vehicle. */
export function memberDetails(member: UnitMemberJson): string {
  if (member.kind === 'driver') return member.licences.join(' · ');
  return [member.vehicleKind ? vehicleKindLabel[member.vehicleKind]() : '', member.makeModel]
    .filter(Boolean)
    .join(' · ');
}
