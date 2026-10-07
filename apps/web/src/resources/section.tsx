import { Link } from '@tanstack/react-router';
import type { ResourceKind } from '@timon/domain';
import { Count } from '@timon/ui';
import type { ReactNode } from 'react';
import { useSummary } from '../data.ts';
import { kindSlugs, tabLabel } from '../kinds.ts';
import { m } from '../paraglide/messages.js';

const kinds: ResourceKind[] = ['driver', 'power-unit', 'trailer'];

/** Drivers, power units, trailers and expiries: links, the current one marked. */
export function SectionTabs({ current }: { current: ResourceKind | 'expiries' }) {
  const summary = useSummary().data;
  return (
    <nav aria-label={m.tabs_label()}>
      <ul className="t-tabs">
        {kinds.map((kind) => (
          <li key={kind}>
            <Link
              to="/resources/$kind"
              params={{ kind: kindSlugs[kind] }}
              aria-current={current === kind ? 'page' : undefined}
              activeOptions={{ exact: true, includeSearch: false }}
            >
              {tabLabel[kind]()}
              {summary ? <Count>{summary.active[kind]}</Count> : null}
            </Link>
          </li>
        ))}
        <li>
          <Link to="/resources/expiries" aria-current={current === 'expiries' ? 'page' : undefined}>
            {m.tab_expiries()}
            {summary ? <Count tone="conflict">{summary.expiries}</Count> : null}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function Breadcrumb({ children }: { children: ReactNode }) {
  return (
    <nav aria-label={m.breadcrumb()} className="breadcrumb">
      <ol>{children}</ol>
    </nav>
  );
}

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  children,
}: {
  breadcrumb: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <Breadcrumb>{breadcrumb}</Breadcrumb>
      <div className="page-title-row">
        <div className="page-title">
          <h1>{title}</h1>
          {subtitle ? <span className="page-subtitle">{subtitle}</span> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
