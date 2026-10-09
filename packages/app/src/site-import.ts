import {
  type BookingMethod,
  type Coordinates,
  isLocatedBy,
  isValidCoordinates,
  type LocatedBy,
  type OpeningRange,
  parseOpeningDay,
  type SiteDetails,
  weekdays,
} from '@timon/domain';
import { parseCountry } from './countries.ts';
import {
  type CsvColumn,
  csvTemplate,
  type FileProblem,
  mapWithConcurrency,
  parseYesNo,
  readCsv,
  simplify,
} from './csv.ts';
import { type Located, locateAddress, notLocated } from './geocoding.ts';
import type { Ports, ReferenceLists, SiteRecord } from './ports.ts';
import type { FieldIssue } from './resources.ts';
import { checkSiteRecord, type NearbySite, nearbyAmong, normaliseSite } from './sites.ts';

const column = (field: string, en: string, fr: string, required = false): CsvColumn => ({
  field,
  en,
  fr,
  required,
});

const dayColumns: readonly [string, string][] = [
  ['monday', 'lundi'],
  ['tuesday', 'mardi'],
  ['wednesday', 'mercredi'],
  ['thursday', 'jeudi'],
  ['friday', 'vendredi'],
  ['saturday', 'samedi'],
  ['sunday', 'dimanche'],
];

/** One line per site; opening hours as 06:00-12:00/13:00-17:00, one column per day. */
export const siteColumns: readonly CsvColumn[] = [
  column('name', 'name', 'nom', true),
  column('street1', 'street', 'adresse', true),
  column('street2', 'street2', 'complement_adresse'),
  column('postcode', 'postcode', 'code_postal'),
  column('city', 'city', 'ville', true),
  column('country', 'country', 'pays'),
  column('latitude', 'latitude', 'latitude'),
  column('longitude', 'longitude', 'longitude'),
  ...dayColumns.map(([en, fr], index) => column(`openings.${index + 1}`, en, fr)),
  column('bookingMethod', 'booking', 'rendez_vous'),
  column('bookingDetail', 'booking_detail', 'detail_rendez_vous'),
  column('protectiveEquipmentIds', 'protective_equipment', 'epi'),
  column('maxLengthCm', 'max_length_m', 'longueur_max_m'),
  column('maxWeightKg', 'max_weight_kg', 'poids_max_kg'),
  column('loadingDock', 'loading_dock', 'quai'),
  column('semiTrailersAccepted', 'semi_trailers', 'semi_remorques'),
  column('gatePhone', 'gate_phone', 'telephone_accueil'),
  column('instructions', 'instructions', 'consignes'),
];

const bookingAliases: Record<BookingMethod, readonly string[]> = {
  phone: ['phone', 'telephone', 'tel'],
  email: ['email', 'e mail', 'mail', 'courriel'],
  portal: ['portal', 'web portal', 'portail', 'web', 'site web'],
};

const equipmentAliases: Record<string, readonly string[]> = {
  'safety-shoes': ['safety shoes', 'shoes', 'chaussures de securite', 'chaussures'],
  'high-visibility-vest': ['high visibility vest', 'vest', 'gilet haute visibilite', 'gilet'],
  'hard-hat': ['hard hat', 'helmet', 'casque'],
  'safety-glasses': ['safety glasses', 'glasses', 'lunettes de securite', 'lunettes'],
  gloves: ['gloves', 'gants'],
};

export type SiteImportRow = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: readonly FieldIssue[];
  /** How the line is, or will be, located; null while it has errors. */
  readonly locatedBy: LocatedBy | null;
  readonly location: Coordinates | null;
  /** Active sites within 50 metres or on the same street: a warning, not an error. */
  readonly nearby: readonly NearbySite[];
};

export type SiteImportCheck = {
  readonly problem: FileProblem | null;
  readonly rows: readonly SiteImportRow[];
  readonly summary: {
    readonly lines: number;
    readonly valid: number;
    readonly invalid: number;
    readonly address: number;
    readonly approximate: number;
    readonly byHand: number;
    readonly notLocated: number;
    readonly nearExisting: number;
  };
  readonly ready: boolean;
};

/** A location sent back with a confirmation: what the preview found for one line. */
export type PreviewLocation = {
  readonly line: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly locatedBy: string;
};

export function siteTemplate(language: 'en' | 'fr') {
  return csvTemplate(siteColumns, language);
}

function parseNumber(value: string): number | undefined {
  const n = Number(value.replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

type ParsedLine = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: FieldIssue[];
  readonly site: SiteRecord | null;
  /** Coordinates given in the file are kept as they are, as placed by hand. */
  readonly fromFile: boolean;
};

function parseLine(
  line: number,
  cells: Readonly<Record<string, string>>,
  lists: ReferenceLists,
): ParsedLine {
  const value = (field: string) => cells[field] ?? '';
  const issues: FieldIssue[] = [];
  const unknown = (field: string) =>
    issues.push({ field, code: 'unknown-value', params: { value: value(field) } });

  const country = parseCountry(value('country'));
  if (country === undefined) unknown('country');

  const openings: OpeningRange[] = [];
  for (const weekday of weekdays) {
    const day = parseOpeningDay(weekday, value(`openings.${weekday}`));
    if (day === undefined) unknown(`openings.${weekday}`);
    else openings.push(...day);
  }

  const bookingText = simplify(value('bookingMethod'));
  const bookingMethod =
    bookingText === '' || ['no', 'non', 'none', 'aucun'].includes(bookingText)
      ? null
      : ((Object.keys(bookingAliases) as BookingMethod[]).find((m) =>
          bookingAliases[m].includes(bookingText),
        ) ?? undefined);
  if (bookingMethod === undefined) unknown('bookingMethod');

  const equipment = value('protectiveEquipmentIds')
    .split(/[|,]/)
    .map((part) => simplify(part))
    .filter((part) => part !== '')
    .map(
      (part) =>
        lists.protectiveEquipment.find(
          (item) =>
            (item.code !== null &&
              (simplify(item.code) === part ||
                (equipmentAliases[item.code] ?? []).includes(part))) ||
            (item.name !== null && simplify(item.name) === part),
        )?.id,
    );
  if (equipment.some((id) => id === undefined)) unknown('protectiveEquipmentIds');

  const number = (field: string, scale = 1) => {
    if (value(field) === '') return null;
    const n = parseNumber(value(field));
    if (n === undefined) {
      issues.push({ field, code: 'invalid-number', params: { value: value(field) } });
      return null;
    }
    return Math.round(n * scale);
  };
  const maxLengthCm = number('maxLengthCm', 100);
  const maxWeightKg = number('maxWeightKg');

  const latitude = value('latitude') === '' ? null : parseNumber(value('latitude'));
  const longitude = value('longitude') === '' ? null : parseNumber(value('longitude'));
  let location: Coordinates | null = null;
  if (latitude !== null || longitude !== null) {
    if (
      latitude === undefined ||
      longitude === undefined ||
      latitude === null ||
      longitude === null ||
      !isValidCoordinates(latitude, longitude)
    ) {
      issues.push({ field: 'location', code: 'location-invalid' });
    } else {
      location = { latitude, longitude };
    }
  }

  const site = normaliseSite({
    name: value('name'),
    street1: value('street1'),
    street2: value('street2'),
    postcode: value('postcode'),
    city: value('city'),
    country: country ?? 'FR',
    location,
    locatedBy: location ? 'by-hand' : 'not-located',
    openings,
    bookingRequired: Boolean(bookingMethod),
    bookingMethod: bookingMethod ?? null,
    bookingDetail: value('bookingDetail'),
    protectiveEquipmentIds: equipment.filter((id): id is string => id !== undefined),
    maxLengthCm,
    maxWeightKg,
    loadingDock: parseYesNo(value('loadingDock')) ?? true,
    semiTrailersAccepted: parseYesNo(value('semiTrailersAccepted')) ?? true,
    gatePhone: value('gatePhone'),
    instructions: value('instructions'),
  } satisfies SiteDetails);
  if (issues.length === 0) issues.push(...checkSiteRecord(site, lists));
  return {
    line,
    cells,
    issues,
    site: issues.length === 0 ? site : null,
    fromFile: location !== null,
  };
}

function summarise(rows: readonly SiteImportRow[]): SiteImportCheck {
  const valid = rows.filter((r) => r.issues.length === 0);
  const count = (test: (r: SiteImportRow) => boolean) => valid.filter(test).length;
  return {
    problem: null,
    rows,
    summary: {
      lines: rows.length,
      valid: valid.length,
      invalid: rows.length - valid.length,
      address: count((r) => r.locatedBy === 'address'),
      approximate: count((r) => r.locatedBy === 'street' || r.locatedBy === 'city'),
      byHand: count((r) => r.locatedBy === 'by-hand'),
      notLocated: count((r) => r.locatedBy === 'not-located'),
      nearExisting: count((r) => r.nearby.length > 0),
    },
    ready: valid.length === rows.length,
  };
}

const emptyCheck = (problem: FileProblem): SiteImportCheck => ({
  ...summarise([]),
  problem,
  ready: false,
});

async function read(ports: Ports, csv: string) {
  const file = readCsv(csv, siteColumns);
  if ('problem' in file) return { problem: file.problem, lines: [] as ParsedLine[] };
  const lists = await ports.referenceLists.get();
  return {
    problem: null,
    lines: file.lines.map(({ line, cells }) => parseLine(line, cells, lists)),
  };
}

async function toRows(
  ports: Ports,
  lines: readonly ParsedLine[],
  locate: (line: ParsedLine & { site: SiteRecord }) => Promise<Located>,
): Promise<(SiteImportRow & { site: SiteRecord | null })[]> {
  const existing = await ports.sites.list({ includeArchived: false });
  // Located a few at a time; the geocoder adapter keeps under the service's rate limit.
  return mapWithConcurrency(lines, 8, async (parsed) => {
    if (!parsed.site) {
      return {
        line: parsed.line,
        cells: parsed.cells,
        issues: parsed.issues,
        locatedBy: null,
        location: null,
        nearby: [],
        site: null,
      };
    }
    const located =
      parsed.fromFile || parsed.site.location
        ? { location: parsed.site.location, locatedBy: parsed.site.locatedBy }
        : await locate({ ...parsed, site: parsed.site });
    const site = { ...parsed.site, ...located };
    return {
      line: parsed.line,
      cells: parsed.cells,
      issues: [],
      locatedBy: site.locatedBy,
      location: site.location,
      nearby: nearbyAmong(existing, site),
      site,
    };
  });
}

/**
 * The preview. French lines without coordinates are located now; a line that cannot be
 * located is not an error, it will be imported as not located (rule 7). Nothing is written.
 */
export async function checkSiteImport(ports: Ports, csv: string): Promise<SiteImportCheck> {
  const { problem, lines } = await read(ports, csv);
  if (problem) return emptyCheck(problem);
  const rows = await toRows(ports, lines, ({ site }) => locateAddress(ports.geocoder, site));
  return summarise(rows.map(({ site: _, ...row }) => row));
}

/**
 * A location sent back by the client for a line. It is the user's own input, like the rest of
 * the file: kept only if the coordinates are valid and the way it was located is one of the
 * five; anything else gives a site that is not located.
 */
export function acceptPreviewLocation(sent: PreviewLocation | undefined): Located {
  if (!sent || !isLocatedBy(sent.locatedBy) || sent.locatedBy === 'not-located') return notLocated;
  if (sent.latitude === null || sent.longitude === null) return notLocated;
  if (!isValidCoordinates(sent.latitude, sent.longitude)) return notLocated;
  return {
    location: { latitude: sent.latitude, longitude: sent.longitude },
    locatedBy: sent.locatedBy,
  };
}

export type SiteImportResult =
  | { readonly ok: true; readonly imported: number; readonly notLocated: number }
  | { readonly ok: false; readonly check: SiteImportCheck };

/**
 * Rule 7: all or nothing. The locations found by the preview come back with the file, so that
 * confirming does not query the geocoder again; they are checked like the file itself.
 */
export async function importSites(
  ports: Ports,
  csv: string,
  locations: readonly PreviewLocation[],
): Promise<SiteImportResult> {
  const { problem, lines } = await read(ports, csv);
  if (problem) return { ok: false, check: emptyCheck(problem) };
  const byLine = new Map(locations.map((l) => [l.line, l]));
  const rows = await toRows(ports, lines, async ({ line }) =>
    acceptPreviewLocation(byLine.get(line)),
  );
  const check = summarise(rows.map(({ site: _, ...row }) => row));
  if (!check.ready) return { ok: false, check };
  const sites = rows.flatMap((r) => (r.site ? [r.site] : []));
  const imported = await ports.sites.createMany(sites);
  return {
    ok: true,
    imported,
    notLocated: sites.filter((s) => s.locatedBy === 'not-located').length,
  };
}
