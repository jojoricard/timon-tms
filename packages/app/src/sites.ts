import {
  type Coordinates,
  checkSite,
  companyDay,
  findDuplicateSites,
  type OpeningRange,
  type SiteDetails,
  type Temporal,
  timeZoneOf,
  type Weekday,
} from '@timon/domain';
import { locateAddress } from './geocoding.ts';
import type { Ports, ReferenceLists, SiteRecord, StoredSite } from './ports.ts';
import { OpeningOverlapError } from './ports.ts';
import type { FieldIssue } from './resources.ts';
import { searchable } from './search.ts';

/** A site near the one being saved (rule 5): a warning, never a refusal. */
export type NearbySite = {
  readonly id: string;
  readonly name: string;
  readonly distanceMetres: number | null;
  readonly sameStreet: boolean;
};

export type SiteView = StoredSite & {
  /** Today in the site's own time zone, and its opening ranges on that day. */
  readonly today: { readonly weekday: Weekday; readonly openings: readonly OpeningRange[] };
};

export type SiteResult =
  | { readonly ok: true; readonly site: SiteView; readonly nearby: readonly NearbySite[] }
  | { readonly ok: false; readonly reason: 'not-found' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly FieldIssue[] };

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** Trims text, sorts the opening hours and takes the time zone from the country. */
export function normaliseSite(input: SiteDetails): SiteRecord {
  const country = input.country.trim().toUpperCase();
  const location = input.locatedBy === 'not-located' ? null : input.location;
  return {
    ...input,
    name: input.name.trim(),
    street1: input.street1.trim(),
    street2: clean(input.street2),
    postcode: country === 'FR' ? input.postcode.replace(/\s/g, '') : input.postcode.trim(),
    city: input.city.trim(),
    country,
    location,
    locatedBy: location ? input.locatedBy : 'not-located',
    openings: [...input.openings].sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
    ),
    bookingMethod: input.bookingRequired ? input.bookingMethod : null,
    bookingDetail: input.bookingRequired ? clean(input.bookingDetail) : null,
    protectiveEquipmentIds: [...new Set(input.protectiveEquipmentIds)],
    gatePhone: clean(input.gatePhone),
    instructions: clean(input.instructions),
    timeZone: timeZoneOf(country),
  };
}

export function checkSiteRecord(site: SiteRecord, lists: ReferenceLists): FieldIssue[] {
  const issues: FieldIssue[] = [...checkSite(site)];
  if (
    site.protectiveEquipmentIds.some((id) => !lists.protectiveEquipment.some((p) => p.id === id))
  ) {
    issues.push({ field: 'protectiveEquipmentIds', code: 'unknown-value' });
  }
  return issues;
}

export function siteView(site: StoredSite, now: Temporal.Instant): SiteView {
  const weekday = companyDay(now, site.timeZone).dayOfWeek as Weekday;
  return {
    ...site,
    today: { weekday, openings: site.openings.filter((o) => o.weekday === weekday) },
  };
}

const asDuplicateCandidate = (site: StoredSite) => ({
  id: site.id,
  archived: site.archived,
  street1: site.street1,
  postcode: site.postcode,
  country: site.country,
  location: site.location,
});

type DuplicateCandidate = {
  street1: string;
  postcode: string;
  country: string;
  location: Coordinates | null;
};

/** The sites of `sites` within 50 metres of `site`, or on the same street line (rule 5). */
export function nearbyAmong(
  sites: readonly StoredSite[],
  site: DuplicateCandidate,
  exceptId?: string,
): NearbySite[] {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return findDuplicateSites(site, sites.map(asDuplicateCandidate), { exceptId }).map((d) => ({
    id: d.site.id,
    name: byId.get(d.site.id)?.name ?? '',
    distanceMetres: d.distanceMetres,
    sameStreet: d.sameStreet,
  }));
}

/** The active sites near `site`, the site being edited left out. */
export async function findNearbySites(
  ports: Ports,
  site: DuplicateCandidate,
  exceptId?: string,
): Promise<NearbySite[]> {
  return nearbyAmong(await ports.sites.list({ includeArchived: false }), site, exceptId);
}

/**
 * Saves a site. A French site without coordinates is located from its address; a failed
 * lookup saves it as not located (never an error). Nearby sites come back as a warning.
 */
async function save(
  ports: Ports,
  input: SiteDetails,
  write: (site: SiteRecord) => Promise<StoredSite | undefined>,
): Promise<SiteResult> {
  let site = normaliseSite(input);
  const issues = checkSiteRecord(site, await ports.referenceLists.get());
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  if (!site.location) site = { ...site, ...(await locateAddress(ports.geocoder, site)) };

  let saved: StoredSite | undefined;
  try {
    saved = await write(site);
  } catch (error) {
    if (error instanceof OpeningOverlapError) {
      return {
        ok: false,
        reason: 'invalid',
        issues: [{ field: 'openings', code: 'opening-overlap' }],
      };
    }
    throw error;
  }
  if (!saved) return { ok: false, reason: 'not-found' };
  return {
    ok: true,
    site: siteView(saved, ports.clock.now()),
    nearby: await findNearbySites(ports, saved, saved.id),
  };
}

export function createSite(ports: Ports, input: SiteDetails) {
  return save(ports, input, (s) => ports.sites.create(s));
}

export function updateSite(ports: Ports, id: string, input: SiteDetails) {
  return save(ports, input, (s) => ports.sites.update(id, s));
}

export async function getSite(ports: Ports, id: string) {
  const site = await ports.sites.get(id);
  if (!site) return undefined;
  return {
    site: siteView(site, ports.clock.now()),
    nearby: site.archived ? [] : await findNearbySites(ports, site, site.id),
  };
}

/** Rule 6: never deleted, only archived. Archiving a site leaves the customers using it alone. */
export async function setSiteArchived(
  ports: Ports,
  id: string,
  archived: boolean,
): Promise<SiteResult> {
  const saved = await ports.sites.setArchived(id, archived);
  if (!saved) return { ok: false, reason: 'not-found' };
  return { ok: true, site: siteView(saved, ports.clock.now()), nearby: [] };
}

export const siteFilters = ['all', 'not-located', 'booking', 'protective-equipment'] as const;
export type SiteFilter = (typeof siteFilters)[number];

const matchesFilter: Record<SiteFilter, (site: StoredSite) => boolean> = {
  all: () => true,
  'not-located': (site) => site.locatedBy === 'not-located',
  booking: (site) => site.bookingRequired,
  'protective-equipment': (site) => site.protectiveEquipmentIds.length > 0,
};

export type SiteList = {
  readonly day: Temporal.PlainDate;
  readonly counts: Readonly<Record<SiteFilter, number>>;
  readonly sites: readonly SiteView[];
};

/** The address book, by name; filtering happens here, a company has a few hundred sites. */
export async function listSites(
  ports: Ports,
  options: { query?: string; filter?: SiteFilter; includeArchived?: boolean } = {},
): Promise<SiteList> {
  const now = ports.clock.now();
  const query = searchable(options.query?.trim() ?? '');
  const sites = (await ports.sites.list({ includeArchived: options.includeArchived ?? false }))
    .filter(
      (site) =>
        query === '' ||
        query
          .split(/\s+/)
          .every((word) => searchable(`${site.name} ${site.postcode} ${site.city}`).includes(word)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }));
  const counts = Object.fromEntries(
    Object.entries(matchesFilter).map(([filter, test]) => [filter, sites.filter(test).length]),
  ) as Record<SiteFilter, number>;
  const filter = matchesFilter[options.filter ?? 'all'];
  return {
    day: companyDay(now),
    counts,
    sites: sites.filter(filter).map((site) => siteView(site, now)),
  };
}
