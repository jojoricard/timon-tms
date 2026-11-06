import type { UnitMemberJson, UnitOptionsJson } from '@timon/http';
import { StatusBadge } from '@timon/ui';
import { useId, useState } from 'react';
import { formatNumber } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { reasonText } from './unit-labels.ts';
import { memberDetails } from './units-page.tsx';

// The resources a unit can take, as the unit form and the change dialog list them: those that
// cannot be chosen stay visible, greyed, with the reason (SPEC-003, Screens).

type Role = 'power-unit' | 'trailer' | 'driver';

export function CandidateColumn({
  place,
  title,
  required,
  placeholder,
  hint,
  noneLabel,
  options,
  except,
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
  /** A resource left out of the list: the one a change replaces. */
  except?: string | undefined;
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
      c.resource.id !== except &&
      (words === '' ||
        [c.resource.name, c.resource.fullName, c.resource.makeModel ?? '']
          .join(' ')
          .toLocaleLowerCase()
          .includes(words)),
  );
  // Unique on the page: the change dialog lists candidates over the unit's own page.
  const name = `unit-${place}-${useId()}`;
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
  const weight = (kg: number | null) => (kg === null ? '' : `${formatNumber(kg)} ${m.kg()}`);
  if (member.kind === 'driver') return memberDetails(member);
  return [memberDetails(member), member.category, weight(member.gvwKg)].filter(Boolean).join(' · ');
}
