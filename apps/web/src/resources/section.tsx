import { Link } from '@tanstack/react-router';
import type { ResourceKind } from '@timon/domain';
import { PageHeader as BasePageHeader, Count, Tabs } from '@timon/ui';
import type { ComponentProps, ReactNode } from 'react';
import { useSummary } from '../data.ts';
import { kindSlugs, tabLabel } from '../kinds.ts';
import { m } from '../paraglide/messages.js';

const kinds: ResourceKind[] = ['driver', 'power-unit', 'trailer'];

/** Drivers, power units, trailers, units and expiries: links, the current one marked. */
export function SectionTabs({ current }: { current: ResourceKind | 'units' | 'expiries' }) {
  const summary = useSummary().data;
  return (
    <Tabs label={m.tabs_label()}>
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
        <Link to="/resources/units" aria-current={current === 'units' ? 'page' : undefined}>
          {m.tab_units()}
          {summary ? <Count>{summary.units}</Count> : null}
        </Link>
      </li>
      <li>
        <Link to="/resources/expiries" aria-current={current === 'expiries' ? 'page' : undefined}>
          {m.tab_expiries()}
          {summary ? <Count tone="conflict">{summary.expiries}</Count> : null}
        </Link>
      </li>
    </Tabs>
  );
}

export function Breadcrumb({ children }: { children: ReactNode }) {
  return (
    <nav aria-label={m.breadcrumb()} className="breadcrumb">
      <ol>{children}</ol>
    </nav>
  );
}

/** The page header of the design system, with the breadcrumb given as its items. */
export function PageHeader({
  breadcrumb,
  ...props
}: Omit<ComponentProps<typeof BasePageHeader>, 'breadcrumb'> & { breadcrumb: ReactNode }) {
  return <BasePageHeader breadcrumb={<Breadcrumb>{breadcrumb}</Breadcrumb>} {...props} />;
}
