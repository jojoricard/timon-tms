import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** A request started by this button is running: the button is disabled and says so. */
  busy?: boolean;
};

export function Button({
  variant = 'secondary',
  type = 'button',
  busy = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className="t-button"
      data-variant={variant}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    />
  );
}
