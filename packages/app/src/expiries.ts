import type { ResourceKind, Temporal } from '@timon/domain';
import type { Ports } from './ports.ts';
import { type PlateOwner, plateOwner } from './resources.ts';
import { compareExpiries, type DocumentView, resourceView, statusDay } from './views.ts';

export type Expiry = DocumentView & { readonly resource: PlateOwner };

export type ExpiryList = {
  readonly day: Temporal.PlainDate;
  /** Over every document needing attention, whatever the filters. */
  readonly summary: {
    readonly expiredBlocking: number;
    readonly expiredNotBlocking: number;
    /** Expiring within 30 days. */
    readonly withinThirtyDays: number;
    /** Expiring in more than 30 days: types with a longer warning period. */
    readonly longerLeadTime: number;
  };
  readonly expiries: readonly Expiry[];
};

/**
 * Every document of an active resource that is expired or within the warning period of its
 * type, expired first, then by date.
 */
export async function listExpiries(
  ports: Ports,
  options: { kind?: ResourceKind; blockingOnly?: boolean } = {},
): Promise<ExpiryList> {
  const day = statusDay(ports.clock.now());
  const [stored, lists] = await Promise.all([
    ports.resources.list({ includeArchived: false }),
    ports.referenceLists.get(),
  ]);
  const all = stored
    .flatMap((r) => {
      const view = resourceView(r, lists.documentTypes, day);
      return view.documents.map((d): Expiry => ({ ...d, resource: plateOwner(r) }));
    })
    .filter((d) => d.status !== 'valid')
    .sort(compareExpiries);

  const expiring = all.filter((d) => d.status === 'expiring');
  return {
    day,
    summary: {
      expiredBlocking: all.filter((d) => d.severity === 'expired-blocking').length,
      expiredNotBlocking: all.filter((d) => d.severity === 'expired-not-blocking').length,
      withinThirtyDays: expiring.filter((d) => d.daysUntil <= 30).length,
      longerLeadTime: expiring.filter((d) => d.daysUntil > 30).length,
    },
    expiries: all.filter(
      (d) =>
        (!options.kind || d.resource.kind === options.kind) &&
        (!options.blockingOnly || d.blocking),
    ),
  };
}
