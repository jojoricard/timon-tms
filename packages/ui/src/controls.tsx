import { type ReactNode, useId } from 'react';

export type Tone = 'ok' | 'warning' | 'conflict' | 'neutral' | 'petrol';

/**
 * A choice among a few options, as radio buttons in a fieldset: one tab stop, arrow keys move
 * between the options, the legend names the group.
 */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
  error,
}: {
  legend: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  error?: ReactNode;
}) {
  const name = useId();
  const describedBy = `${name}-text`;
  return (
    <fieldset className="t-segmented" aria-describedby={error || hint ? describedBy : undefined}>
      <legend>{legend}</legend>
      <div className="t-segmented-options">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <span className="t-field-error" id={describedBy}>
          {error}
        </span>
      ) : hint ? (
        <span className="t-field-hint" id={describedBy}>
          {hint}
        </span>
      ) : null}
    </fieldset>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="t-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A set of filters, named for assistive technologies by a hidden legend. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="t-chip-group">
      <legend className="t-visually-hidden">{label}</legend>
      {children}
    </fieldset>
  );
}

/** A filter that is on or off: a button with aria-pressed. */
export function Chip({
  pressed,
  onClick,
  count,
  tone,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  tone?: 'warning' | 'conflict';
  children: ReactNode;
}) {
  return (
    <button type="button" className="t-chip" aria-pressed={pressed} onClick={onClick}>
      {tone ? <span className="t-chip-dot" data-tone={tone} aria-hidden="true" /> : null}
      {children}
      {count !== undefined ? <span className="t-chip-count">{count}</span> : null}
    </button>
  );
}

/** A status in words, coloured by tone. Colour is never the only carrier of meaning. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="t-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Plate({ children }: { children: ReactNode }) {
  return <span className="t-plate">{children}</span>;
}

export function Count({ tone, children }: { tone?: 'conflict'; children: ReactNode }) {
  return (
    <span className="t-count" data-tone={tone}>
      {children}
    </span>
  );
}

/** A row of key figures, as a description list. */
export function Metrics({ children }: { children: ReactNode }) {
  return <dl className="t-metrics">{children}</dl>;
}

export function Metric({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: ReactNode;
  tone?: 'warning' | 'conflict';
  children?: ReactNode;
}) {
  return (
    <div className="t-metric">
      <dt>{label}</dt>
      <dd>
        <span className="t-metric-value" data-tone={tone}>
          {value}
        </span>
        {children ? <span className="t-secondary">{children}</span> : null}
      </dd>
    </div>
  );
}

export type StepState = 'done' | 'current' | 'todo';

/** The steps of a process; the current one is marked for assistive technologies. */
export function Steps({ steps }: { steps: readonly { label: string; state: StepState }[] }) {
  return (
    <ol className="t-steps">
      {steps.map((step, index) => (
        <li
          key={step.label}
          data-state={step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="t-step-number" aria-hidden="true">
            {step.state === 'done' ? '✓' : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
