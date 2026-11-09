import {
  type AdrClass,
  adrClasses,
  checkOrder,
  companyDay,
  type GoodsLine,
  type Issue,
  type OrderDetails,
  type OrderStop,
  type OrderWarning,
  orderWarnings,
  type Packaging,
  packagings,
  parseTime,
  type StopKind,
  type Temporal,
  textLimits,
} from '@timon/domain';
import { type CsvColumn, csvTemplate, type FileProblem, readCsv, simplify } from './csv.ts';
import { findItem, parseDate } from './import.ts';
import { normaliseOrder, orderRecord } from './orders.ts';
import {
  ArchivedReferenceError,
  type NewOrderEvent,
  type OrderRecord,
  type Ports,
  type StoredCustomer,
  type StoredSite,
} from './ports.ts';
import type { FieldIssue } from './resources.ts';

// SPEC-004, Import: one line per goods line; the lines with the same customer and reference form
// one order. All or nothing, as the other imports; an order with several pickups and several
// deliveries, or a site not located, is imported to review.

const column = (field: string, en: string, fr: string, required = false): CsvColumn => ({
  field,
  en,
  fr,
  required,
});

export const orderColumns: readonly CsvColumn[] = [
  column('customerCode', 'customer_code', 'code_client', true),
  column('customerReference', 'customer_reference', 'reference_client'),
  column('pickupSite', 'pickup_site', 'site_enlevement', true),
  column('pickupDate', 'pickup_date', 'date_enlevement', true),
  column('pickupFrom', 'pickup_from', 'enlevement_debut', true),
  column('pickupTo', 'pickup_to', 'enlevement_fin', true),
  column('deliverySite', 'delivery_site', 'site_livraison', true),
  column('deliveryDate', 'delivery_date', 'date_livraison', true),
  column('deliveryFrom', 'delivery_from', 'livraison_debut', true),
  column('deliveryTo', 'delivery_to', 'livraison_fin', true),
  column('description', 'description', 'designation', true),
  column('quantity', 'quantity', 'quantite', true),
  column('packaging', 'packaging', 'conditionnement', true),
  column('weightKg', 'weight_kg', 'poids_kg', true),
  column('floorM', 'floor_m', 'metres_plancher'),
  column('unNumber', 'un_number', 'numero_onu'),
  column('adrClass', 'adr_class', 'classe_adr'),
  column('temperatureMin', 'temperature_min', 'temperature_min'),
  column('temperatureMax', 'temperature_max', 'temperature_max'),
  column('bodyType', 'body_type', 'carrosserie'),
  column('sideLoading', 'side_loading', 'chargement_lateral'),
  column('tailLift', 'tail_lift', 'hayon'),
  column('notes', 'notes', 'notes'),
];

/** The ways a packaging may be written, in English and French. */
export const packagingAliases: Record<Packaging, readonly string[]> = {
  'euro-pallet': ['euro pallet', 'palette europe', 'europe', 'epal'],
  pallet: ['pallet', 'palette'],
  parcel: ['parcel', 'colis'],
  bulk: ['bulk', 'vrac'],
};

const yes = ['yes', 'oui', 'y', 'o', '1', 'x', 'true', 'vrai'];
const no = ['no', 'non', 'n', '0', 'false', 'faux'];

/** The columns of the order: every line of an order must agree on them. */
const headerFields = ['bodyType', 'sideLoading', 'tailLift', 'notes'] as const;

export function orderTemplate(language: 'en' | 'fr') {
  return csvTemplate(orderColumns, language);
}

export type OrderImportRow = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: readonly FieldIssue[];
};

export type ImportWarning =
  | OrderWarning
  | {
      readonly code: 'no-reference';
      readonly stopId: null;
      readonly params: Readonly<Record<string, never>>;
    };

/** An order of the file, as it will be imported. */
export type OrderImportGroup = {
  readonly reference: string | null;
  readonly customer: { readonly code: string; readonly name: string } | null;
  /** Its lines in the file. */
  readonly lines: readonly number[];
  readonly pickups: number;
  readonly deliveries: number;
  readonly goodsLines: number;
  readonly result: 'ready' | 'to-review' | 'errors';
  readonly warnings: readonly ImportWarning[];
  /** Why it will be imported to review. */
  readonly review: readonly Issue[];
};

export type OrderImportCheck = {
  readonly problem: FileProblem | null;
  readonly rows: readonly OrderImportRow[];
  readonly orders: readonly OrderImportGroup[];
  readonly summary: {
    readonly lines: number;
    readonly orders: number;
    readonly ready: number;
    readonly toReview: number;
    readonly withErrors: number;
  };
  /** True when no line has an error: the import may go ahead. */
  readonly ready: boolean;
};

type ParsedStop = Omit<OrderStop, 'id' | 'kind'>;

type ParsedLine = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: FieldIssue[];
  readonly customer: StoredCustomer | null;
  readonly reference: string | null;
  readonly pickup: ParsedStop | null;
  readonly delivery: ParsedStop | null;
  readonly goods: Omit<GoodsLine, 'id' | 'fromStopId' | 'toStopId'> | null;
  readonly header: Pick<OrderDetails, 'bodyTypeId' | 'sideLoading' | 'tailLift' | 'notes'>;
};

type Lookup = {
  readonly customers: readonly StoredCustomer[];
  readonly sites: readonly StoredSite[];
  readonly bodyTypes: Awaited<ReturnType<Ports['referenceLists']['get']>>['bodyTypes'];
};

const integer = (raw: string) => {
  const n = Number(raw.replace(/[\s  ]/g, ''));
  return Number.isInteger(n) ? n : undefined;
};

const decimal = (raw: string) => {
  const n = Number(raw.replace(/[\s  ]/g, '').replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

function parseLine(
  line: number,
  cells: Readonly<Record<string, string>>,
  lookup: Lookup,
): ParsedLine {
  const issues: FieldIssue[] = [];
  const value = (field: string) => cells[field] ?? '';

  /** The cell read by `parse`; empty gives null, or an issue when the column is required. */
  const pick = <T>(
    field: string,
    parse: (raw: string) => T | undefined,
    code: 'unknown-value' | 'invalid-date' | 'invalid-time' | 'invalid-number',
  ): T | null => {
    const raw = value(field);
    const required = orderColumns.find((c) => c.field === field)?.required ?? false;
    if (raw === '') {
      if (required) issues.push({ field, code: 'required' });
      return null;
    }
    const parsed = parse(raw);
    if (parsed === undefined) {
      issues.push({ field, code, params: { value: raw } });
      return null;
    }
    return parsed;
  };
  const text = (field: string, max?: number) => {
    const raw = value(field);
    const required = orderColumns.find((c) => c.field === field)?.required ?? false;
    if (raw === '' && required) issues.push({ field, code: 'required' });
    if (max !== undefined && raw.length > max) {
      issues.push({ field, code: 'too-long', params: { max } });
    }
    return raw === '' ? null : raw;
  };

  const customer = pick(
    'customerCode',
    (raw) => lookup.customers.find((c) => c.code.toUpperCase() === raw.toUpperCase()),
    'unknown-value',
  );
  if (customer?.archived) issues.push({ field: 'customerCode', code: 'archived' });
  const reference = text('customerReference', textLimits.order.customerReference);

  const stop = (kind: StopKind): ParsedStop | null => {
    const siteField = `${kind}Site`;
    const name = value(siteField).trim();
    let siteId: string | null = null;
    if (name === '') issues.push({ field: siteField, code: 'required' });
    else {
      // A site by its exact name once spaces are trimmed; two active sites of that name are an
      // error, never a guess.
      const named = lookup.sites.filter((s) => s.name.trim() === name);
      const active = named.filter((s) => !s.archived);
      if (active.length > 1) {
        issues.push({
          field: siteField,
          code: 'site-ambiguous',
          params: { value: value(siteField), count: active.length },
        });
      } else if (active[0]) siteId = active[0].id;
      else if (named.length > 0) issues.push({ field: siteField, code: 'archived' });
      else {
        issues.push({
          field: siteField,
          code: 'unknown-value',
          params: { value: value(siteField) },
        });
      }
    }
    const date = pick(`${kind}Date`, parseDate, 'invalid-date');
    const startMinute = pick(`${kind}From`, parseTime, 'invalid-time');
    const endMinute = pick(`${kind}To`, parseTime, 'invalid-time');
    return siteId && date && startMinute !== null && endMinute !== null
      ? { siteId, date, startMinute, endMinute, bookingMade: false, bookingReference: null }
      : null;
  };
  const pickup = stop('pickup');
  const delivery = stop('delivery');

  const description = text('description', textLimits.goods.description);
  const quantity = pick('quantity', integer, 'invalid-number');
  const packaging = pick(
    'packaging',
    (raw) =>
      packagings.find(
        (p) => simplify(p) === simplify(raw) || packagingAliases[p].includes(simplify(raw)),
      ),
    'unknown-value',
  );
  const weightKg = pick('weightKg', integer, 'invalid-number');
  const floorM = pick('floorM', decimal, 'invalid-number');
  const unNumber = text('unNumber');
  const adrClass = pick(
    'adrClass',
    (raw) => adrClasses.find((c) => c === raw.trim().replace(',', '.')) as AdrClass | undefined,
    'unknown-value',
  );
  const temperatureMin = pick('temperatureMin', integer, 'invalid-number');
  const temperatureMax = pick('temperatureMax', integer, 'invalid-number');
  const bodyTypeId = pick(
    'bodyType',
    (raw) => findItem(lookup.bodyTypes, raw)?.id,
    'unknown-value',
  );
  const flag = (field: string) =>
    pick(
      field,
      (raw) =>
        yes.includes(simplify(raw)) ? true : no.includes(simplify(raw)) ? false : undefined,
      'unknown-value',
    ) ?? false;
  const sideLoading = flag('sideLoading');
  const tailLift = flag('tailLift');
  const notes = text('notes', textLimits.order.notes);

  const goods =
    description !== null && quantity !== null && packaging !== null && weightKg !== null
      ? {
          description,
          quantity,
          packaging,
          weightKg,
          floorDm: floorM === null ? null : Math.round(floorM * 10),
          unNumber,
          adrClass,
          temperatureMin,
          temperatureMax,
        }
      : null;
  return {
    line,
    cells,
    issues,
    customer,
    reference,
    pickup,
    delivery,
    goods,
    header: { bodyTypeId, sideLoading, tailLift, notes },
  };
}

/** The stop of a line, as the file wrote it: two lines with the same one share it. */
const stopKey = (cells: Readonly<Record<string, string>>, kind: StopKind) =>
  ['Site', 'Date', 'From', 'To'].map((part) => (cells[`${kind}${part}`] ?? '').trim()).join('|');

/** Where an issue of the order's check is shown in the file: a line, and its column. */
const stopColumns: Record<string, string> = {
  siteId: 'Site',
  date: 'Date',
  start: 'From',
  end: 'To',
};
const lineColumns: Record<string, string> = {
  floorDm: 'floorM',
  fromStopId: 'pickupSite',
  toStopId: 'deliverySite',
};

type Group = {
  readonly lines: ParsedLine[];
  /** The order to import; null while a line has an error. */
  order: OrderDetails | null;
  status: 'to-plan' | 'to-review';
  review: Issue[];
  warnings: ImportWarning[];
};

/** Lines of one customer with one reference make an order; a line without one, an order alone. */
function groupLines(lines: readonly ParsedLine[]): Group[] {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const code = (line.cells.customerCode ?? '').trim().toUpperCase();
    const key = line.reference === null ? `line ${line.line}` : `${code}\u0000${line.reference}`;
    const group = groups.get(key) ?? {
      lines: [],
      order: null,
      status: 'to-plan',
      review: [],
      warnings: [],
    };
    const first = group.lines[0];
    if (first) {
      for (const field of headerFields) {
        if ((line.cells[field] ?? '').trim() !== (first.cells[field] ?? '').trim()) {
          line.issues.push({ field, code: 'header-disagrees', params: { line: first.line } });
        }
      }
    }
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The order of a group of lines free of errors, with the file line of each stop and line. */
function buildOrder(group: Group) {
  const first = group.lines[0] as ParsedLine;
  const stops: OrderStop[] = [];
  const stopLines: number[] = [];
  const ids = new Map<string, string>();
  const stopOf = (line: ParsedLine, kind: StopKind) => {
    const key = `${kind}|${stopKey(line.cells, kind)}`;
    let id = ids.get(key);
    if (!id) {
      id = `s${stops.length + 1}`;
      ids.set(key, id);
      stops.push({ ...(line[kind] as ParsedStop), id, kind });
      stopLines.push(line.line);
    }
    return id;
  };
  // Pickups first, then deliveries, each in the order of the file.
  for (const line of group.lines) stopOf(line, 'pickup');
  for (const line of group.lines) stopOf(line, 'delivery');
  const lines = group.lines.map(
    (line, index): GoodsLine => ({
      ...(line.goods as NonNullable<ParsedLine['goods']>),
      id: `l${index + 1}`,
      fromStopId: stopOf(line, 'pickup'),
      toStopId: stopOf(line, 'delivery'),
    }),
  );
  const order: OrderDetails = {
    customerId: first.customer?.id ?? '',
    customerReference: first.reference,
    ...first.header,
    stops,
    lines,
  };
  return { order, stopLines };
}

async function examine(ports: Ports, csv: string) {
  const file = readCsv(csv, orderColumns);
  if ('problem' in file) return { problem: file.problem, groups: [] as Group[] };
  const [customers, sites, lists] = await Promise.all([
    ports.customers.list({ includeArchived: true }),
    ports.sites.list({ includeArchived: true }),
    ports.referenceLists.get(),
  ]);
  const lookup: Lookup = { customers, sites, bodyTypes: lists.bodyTypes };
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const groups = groupLines(file.lines.map(({ line, cells }) => parseLine(line, cells, lookup)));

  for (const group of groups) {
    if (group.lines.some((l) => l.issues.length > 0)) continue;
    const { order, stopLines } = buildOrder(group);
    const { blocking, review } = checkOrder(order, siteMap);
    for (const issue of blocking) {
      const [, part, index, name = ''] = /^(stops|lines)\.(\d+)\.(\w+)$/.exec(issue.field) ?? [];
      const at = Number(index);
      if (part === 'stops') {
        const kind = order.stops[at]?.kind ?? 'pickup';
        const line = group.lines.find((l) => l.line === stopLines[at]) ?? group.lines[0];
        line?.issues.push({ ...issue, field: `${kind}${stopColumns[name] ?? name}` });
      } else if (part === 'lines') {
        group.lines[at]?.issues.push({ ...issue, field: lineColumns[name] ?? name });
      } else group.lines[0]?.issues.push(issue);
    }
    if (blocking.length > 0) continue;
    group.order = order;
    group.review = [...review];
    group.status = review.length > 0 ? 'to-review' : 'to-plan';
    const sameReference = order.customerReference
      ? await ports.orders.findByReference(order.customerId, order.customerReference)
      : [];
    group.warnings = [
      ...(order.customerReference === null
        ? [{ code: 'no-reference', stopId: null, params: {} } as const]
        : []),
      ...orderWarnings(
        order,
        siteMap,
        sameReference.map((o) => o.number),
      ),
    ];
  }
  return { problem: null, groups, sites: siteMap };
}

/** "Pharmalp, quai froid|10/11/2026|07:00|08:00": the stops the lines name, counted as written. */
const countStops = (group: Group, kind: StopKind) =>
  new Set(group.lines.map((l) => stopKey(l.cells, kind))).size;

function summarise(problem: FileProblem | null, groups: readonly Group[]): OrderImportCheck {
  const rows = groups
    .flatMap((g) => g.lines)
    .sort((a, b) => a.line - b.line)
    .map(({ line, cells, issues }) => ({ line, cells, issues }));
  const orders = groups.map((group): OrderImportGroup => {
    const first = group.lines[0] as ParsedLine;
    const errors = group.lines.some((l) => l.issues.length > 0);
    return {
      reference: first.reference,
      customer: first.customer ? { code: first.customer.code, name: first.customer.name } : null,
      lines: group.lines.map((l) => l.line),
      pickups: countStops(group, 'pickup'),
      deliveries: countStops(group, 'delivery'),
      goodsLines: group.lines.length,
      result: errors ? 'errors' : group.status === 'to-review' ? 'to-review' : 'ready',
      warnings: errors ? [] : group.warnings,
      review: errors ? [] : group.review,
    };
  });
  const count = (result: OrderImportGroup['result']) =>
    orders.filter((o) => o.result === result).length;
  return {
    problem,
    rows,
    orders,
    summary: {
      lines: rows.length,
      orders: orders.length,
      ready: count('ready'),
      toReview: count('to-review'),
      withErrors: count('errors'),
    },
    ready: problem === null && rows.length > 0 && rows.every((r) => r.issues.length === 0),
  };
}

/** The preview (criteria 11 and 13): every line with its errors, every order. Nothing is written. */
export async function checkOrderImport(ports: Ports, csv: string): Promise<OrderImportCheck> {
  const { problem, groups } = await examine(ports, csv);
  return summarise(problem, groups);
}

export type OrderImportResult =
  | { readonly ok: true; readonly imported: number; readonly toReview: number }
  | { readonly ok: false; readonly check: OrderImportCheck };

/**
 * All or nothing, in one transaction. Each order's history records the file and its lines; an
 * order with something to fix is imported to review.
 */
export async function importOrders(
  ports: Ports,
  csv: string,
  fileName: string,
): Promise<OrderImportResult> {
  const examined = await examine(ports, csv);
  const check = summarise(examined.problem, examined.groups);
  if (!check.ready || !examined.sites) return { ok: false, check };
  const sites = examined.sites;
  const now: Temporal.Instant = ports.clock.now();
  const orders = examined.groups.map(({ order, status, lines }) => {
    const normalised = normaliseOrder(order as OrderDetails);
    const record: OrderRecord = orderRecord(normalised, status, sites);
    const event: NewOrderEvent = {
      at: now,
      kind: 'created',
      origin: 'import',
      status,
      source: null,
      fileName,
      fileLines: lines.map((l) => l.line),
    };
    return { order: record, event };
  });
  try {
    await ports.orders.createMany(orders, companyDay(now).year);
  } catch (error) {
    // A customer or a site archived since the preview: the file is checked again.
    if (!(error instanceof ArchivedReferenceError)) throw error;
    return { ok: false, check: await checkOrderImport(ports, csv) };
  }
  return {
    ok: true,
    imported: orders.length,
    toReview: orders.filter((o) => o.order.status === 'to-review').length,
  };
}
