import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({ variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className="t-button" data-variant={variant} />;
}
