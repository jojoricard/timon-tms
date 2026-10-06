import type { ReactNode } from 'react';

export function Banner({
  tone,
  children,
}: {
  tone: 'conflict' | 'warning' | 'ok';
  children: ReactNode;
}) {
  return (
    <div className="t-banner" data-tone={tone} role={tone === 'ok' ? 'status' : 'alert'}>
      {children}
    </div>
  );
}
