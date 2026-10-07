import { cloneElement, type ReactElement, type ReactNode, useId } from 'react';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

/**
 * A label above its control, with an optional hint and error below. The control is the only
 * child; it receives the id the label points to and the ids of the texts that describe it.
 */
export function Field({
  label,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  /** Text appended to the label, e.g. "(optional)". */
  optional?: string | undefined;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<ControlProps>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className="t-field" data-invalid={error ? 'true' : undefined}>
      <label className="t-field-label" htmlFor={id}>
        {label}
        {optional ? <span className="t-field-optional"> {optional}</span> : null}
      </label>
      {cloneElement(children, {
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {error ? (
        <span className="t-field-error" id={errorId}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="t-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
