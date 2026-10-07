import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className="t-button" data-variant={variant} />;
}
