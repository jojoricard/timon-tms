import { Link } from '@tanstack/react-router';
import type { LocatedBy } from '@timon/domain';
import type { ListItemJson, OpeningJson } from '@timon/http';
import { Count, StatusBadge } from '@timon/ui';
import { m } from '../paraglide/messages.js';
import { useCustomerSummary } from './customer-data.ts';
import { equipmentLabel, formatRange, locatedByLabel, locatedByTone } from './customer-labels.ts';

/** Customers and sites: links, the current one marked. */
export function CustomerTabs({ current }: { current: 'customers' | 'sites' }) {
  const summary = useCustomerSummary().data;
  return (
    <nav aria-label={m.customer_tabs_label()}>
      <ul className="t-tabs">
        <li>
          <Link
            to="/customers"
            activeOptions={{ exact: true }}
            aria-current={current === 'customers' ? 'page' : undefined}
          >
            {m.tab_customers()}
            {summary ? <Count>{summary.customers}</Count> : null}
          </Link>
        </li>
        <li>
          <Link to="/customers/sites" aria-current={current === 'sites' ? 'page' : undefined}>
            {m.tab_sites()}
            {summary ? <Count>{summary.sites}</Count> : null}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function LocatedBadge({ locatedBy }: { locatedBy: LocatedBy }) {
  return <StatusBadge tone={locatedByTone[locatedBy]}>{locatedByLabel[locatedBy]()}</StatusBadge>;
}

/** Protective equipment as short tags, in the order of the company list. */
export function EquipmentTags({
  ids,
  list,
}: {
  ids: readonly string[];
  list: readonly ListItemJson[];
}) {
  const items = list.filter((item) => ids.includes(item.id));
  if (items.length === 0) return <span aria-hidden="true">—</span>;
  return (
    <ul className="t-tags">
      {items.map((item) => (
        <li key={item.id} title={equipmentLabel(item)}>
          {equipmentLabel(item, true)}
        </li>
      ))}
    </ul>
  );
}

/** "06:00–12:00  13:00–17:30": a narrow column breaks between ranges, never inside one. */
export function DayRanges({ openings }: { openings: readonly OpeningJson[] }) {
  const ranges = [...openings].sort((a, b) => a.startMinute - b.startMinute);
  return (
    <span className="day-ranges">
      {ranges.map((range) => (
        <span key={range.startMinute}>{formatRange(range)}</span>
      ))}
    </span>
  );
}
