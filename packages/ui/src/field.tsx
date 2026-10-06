import type { ReactNode } from 'react';

/** A label above its control. The control is passed as the child. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child, labelled by nesting.
    <label className="t-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
