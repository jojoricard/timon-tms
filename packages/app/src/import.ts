import {
  plateKey,
  type ResourceDetails,
  type ResourceKind,
  Temporal,
  type VehicleCategory,
  type VehicleKind,
  vehicleCategories,
  vehicleKinds,
} from '@timon/domain';
import Papa from 'papaparse';
import { type ImportColumn, importColumns, simplify, valueAliases } from './import-format.ts';
import {
  type ListItem,
  type NewDocument,
  type NewResource,
  PlateTakenError,
  type Ports,
  type ReferenceLists,
} from './ports.ts';
import {
  checkDetails,
  type FieldIssue,
  normalise,
  type PlateOwner,
  plateOwner,
} from './resources.ts';

/** Larger files are refused before they are read. */
export const importLimits = { maxBytes: 1_000_000, maxLines: 2_000 } as const;

export type ImportIssue =
  | FieldIssue
  | {
      readonly field: 'plate';
      readonly code: 'plate-taken';
      readonly params: { readonly owner: PlateOwner };
    }
  | {
      readonly field: 'plate';
      readonly code: 'plate-duplicated';
      readonly params: { line: number };
    };

export type ImportRow = {
  /** Line in the file, the header being line 1. */
  readonly line: number;
  /** The cells as typed, by field. */
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: readonly ImportIssue[];
  readonly documents: number;
};

export type FileProblem =
  | { readonly code: 'too-large'; readonly params: { maxBytes: number } }
  | { readonly code: 'too-many-lines'; readonly params: { maxLines: number } }
  | { readonly code: 'empty' }
  | { readonly code: 'missing-columns'; readonly params: { fields: readonly string[] } };

export type ImportCheck = {
  readonly kind: ResourceKind;
  readonly problem: FileProblem | null;
  readonly rows: readonly ImportRow[];
  readonly summary: {
    readonly lines: number;
    readonly valid: number;
    readonly invalid: number;
    readonly alreadyInTimon: number;
    readonly documents: number;
  };
  /** True when every line is valid: the import may go ahead. */
  readonly ready: boolean;
};

type ParsedRow = ImportRow & { readonly resource: NewResource | null };

/** A header line in English or French, separated by semicolons as French spreadsheets expect. */
export function importTemplate(kind: ResourceKind, language: 'en' | 'fr'): string {
  return `${importColumns[kind].map((c) => c[language]).join(';')}\r\n`;
}

function findItem(items: readonly ListItem[], value: string): ListItem | undefined {
  const wanted = simplify(value);
  return items.find(
    (item) =>
      (item.code !== null &&
        (simplify(item.code) === wanted ||
          (valueAliases[item.code] ?? []).some((alias) => simplify(alias) === wanted))) ||
      (item.name !== null && simplify(item.name) === wanted),
  );
}

function parseDate(value: string): Temporal.PlainDate | undefined {
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  try {
    if (french) {
      const [, day, month, year] = french.map(Number);
      return Temporal.PlainDate.from({ year, month, day } as Temporal.PlainDateLike, {
        overflow: 'reject',
      });
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? Temporal.PlainDate.from(value) : undefined;
  } catch {
    return undefined;
  }
}

function parseRow(
  kind: ResourceKind,
  line: number,
  cells: Record<string, string>,
  lists: ReferenceLists,
): ParsedRow {
  const issues: ImportIssue[] = [];
  const documents: NewDocument[] = [];
  const value = (field: string) => cells[field] ?? '';
  let complete = true;

  const pick = <T>(column: ImportColumn, parse: (raw: string) => T | undefined): T | null => {
    const raw = value(column.field);
    if (raw === '') {
      if (column.required) {
        issues.push({ field: column.field, code: 'required' });
        complete = false;
      }
      return null;
    }
    const parsed = parse(raw);
    if (parsed === undefined) {
      const code =
        column.kind === 'weight'
          ? 'invalid-number'
          : column.kind === 'document'
            ? 'invalid-date'
            : 'unknown-value';
      issues.push({ field: column.field, code, params: { value: raw } });
      complete = false;
      return null;
    }
    return parsed;
  };

  const values: Record<string, unknown> = {};
  for (const column of importColumns[kind]) {
    switch (column.kind) {
      case 'text':
        values[column.field] = pick(column, (raw) => raw);
        break;
      case 'weight':
        values[column.field] = pick(column, (raw) => {
          const n = Number(raw.replace(/[\s  ]/g, ''));
          return Number.isInteger(n) ? n : undefined;
        });
        break;
      case 'vehicle-kind':
        values[column.field] = pick(column, (raw) =>
          vehicleKinds.find(
            (k) => k === raw || (valueAliases[k] ?? []).some((a) => simplify(a) === simplify(raw)),
          ),
        );
        break;
      case 'category':
        values[column.field] = pick(column, (raw) =>
          vehicleCategories.find((c) => c === raw.trim().toUpperCase()),
        );
        break;
      case 'body-type':
        values[column.field] = pick(column, (raw) => findItem(lists.bodyTypes, raw)?.id);
        break;
      case 'trade-label':
        values[column.field] = pick(column, (raw) => findItem(lists.tradeLabels, raw)?.id);
        break;
      case 'capabilities':
        values[column.field] =
          pick(column, (raw) => {
            const ids = raw
              .split(/[|,]/)
              .map((part) => part.trim())
              .filter((part) => part !== '')
              .map((part) => findItem(lists.capabilities, part)?.id);
            return ids.every((id) => id !== undefined) ? (ids as string[]) : undefined;
          }) ?? [];
        break;
      case 'document': {
        const code = column.field.slice('document:'.length);
        const type = lists.documentTypes.find((t) => t.code === code);
        const expiresOn = pick(column, parseDate);
        if (type && expiresOn) {
          documents.push({ documentTypeId: type.id, reference: null, issuedOn: null, expiresOn });
        }
        break;
      }
    }
  }

  let resource: NewResource | null = null;
  if (complete) {
    const details = normalise(
      kind === 'driver'
        ? {
            kind,
            lastName: (values.lastName as string | null) ?? '',
            firstName: (values.firstName as string | null) ?? '',
            displayName: (values.displayName as string | null) ?? '',
            employeeNumber: values.employeeNumber as string | null,
            phone: values.phone as string | null,
          }
        : {
            kind,
            plate: (values.plate as string | null) ?? '',
            vehicleKind: values.vehicleKind as VehicleKind,
            category: values.category as VehicleCategory,
            gvwKg: values.gvwKg as number,
            gcwKg: (values.gcwKg as number | null | undefined) ?? null,
            makeModel: values.makeModel as string | null,
            bodyTypeId: values.bodyTypeId as string | null,
            tradeLabelId: values.tradeLabelId as string | null,
            capabilityIds: values.capabilityIds as string[],
          },
    ) satisfies ResourceDetails;
    const ruleIssues = checkDetails(details, lists);
    issues.push(...ruleIssues);
    if (ruleIssues.length === 0) resource = { details, documents };
  }
  return { line, cells, issues, documents: documents.length, resource };
}

const empty = (kind: ResourceKind, problem: FileProblem): ImportCheck => ({
  kind,
  problem,
  rows: [],
  summary: { lines: 0, valid: 0, invalid: 0, alreadyInTimon: 0, documents: 0 },
  ready: false,
});

async function parse(
  ports: Ports,
  kind: ResourceKind,
  csv: string,
): Promise<{ check: ImportCheck; resources: NewResource[] }> {
  if (new TextEncoder().encode(csv).byteLength > importLimits.maxBytes) {
    return {
      check: empty(kind, { code: 'too-large', params: { maxBytes: importLimits.maxBytes } }),
      resources: [],
    };
  }
  const { data } = Papa.parse<string[]>(csv.replace(/^﻿/, ''), {
    delimiter: '',
    delimitersToGuess: [';', ',', '\t'],
    skipEmptyLines: false,
  });
  const [header = [], ...lines] = data;
  const filled = lines
    .map((cells, index) => ({ cells, line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  if (filled.length === 0) return { check: empty(kind, { code: 'empty' }), resources: [] };
  if (filled.length > importLimits.maxLines) {
    return {
      check: empty(kind, { code: 'too-many-lines', params: { maxLines: importLimits.maxLines } }),
      resources: [],
    };
  }

  const columns = importColumns[kind];
  const positions = new Map<string, number>();
  header.forEach((title, index) => {
    const column = columns.find((c) =>
      [c.en, c.fr, c.field].some((name) => simplify(name) === simplify(title)),
    );
    if (column && !positions.has(column.field)) positions.set(column.field, index);
  });
  const missing = columns.filter((c) => c.required && !positions.has(c.field)).map((c) => c.field);
  if (missing.length > 0) {
    return {
      check: empty(kind, { code: 'missing-columns', params: { fields: missing } }),
      resources: [],
    };
  }

  const lists = await ports.referenceLists.get();
  const rows = filled.map(({ cells, line }) =>
    parseRow(
      kind,
      line,
      Object.fromEntries(
        [...positions].map(([field, index]) => [field, (cells[index] ?? '').trim()]),
      ),
      lists,
    ),
  );

  // Rule 1, within the file and against the resources already in Timon.
  let alreadyInTimon = 0;
  const firstLine = new Map<string, number>();
  const checked: ParsedRow[] = [];
  for (const row of rows) {
    const details = row.resource?.details;
    if (!details || details.kind === 'driver') {
      checked.push(row);
      continue;
    }
    const key = plateKey(details.plate);
    const earlier = firstLine.get(key);
    const owner = await ports.resources.findActiveByPlate(key);
    const issues: ImportIssue[] = [];
    if (earlier !== undefined) {
      issues.push({ field: 'plate', code: 'plate-duplicated', params: { line: earlier } });
    } else {
      firstLine.set(key, row.line);
    }
    if (owner) {
      alreadyInTimon += 1;
      issues.push({ field: 'plate', code: 'plate-taken', params: { owner: plateOwner(owner) } });
    }
    checked.push(issues.length > 0 ? { ...row, issues, resource: null } : row);
  }

  const invalid = checked.filter((row) => row.issues.length > 0).length;
  const check: ImportCheck = {
    kind,
    problem: null,
    rows: checked.map(({ resource: _, ...row }) => row),
    summary: {
      lines: checked.length,
      valid: checked.length - invalid,
      invalid,
      alreadyInTimon,
      documents: checked.reduce((sum, row) => sum + row.documents, 0),
    },
    ready: invalid === 0,
  };
  return { check, resources: checked.flatMap((row) => (row.resource ? [row.resource] : [])) };
}

/** The preview: every line with its issues. Nothing is written. */
export async function checkImport(ports: Ports, kind: ResourceKind, csv: string) {
  return (await parse(ports, kind, csv)).check;
}

export type ImportResult =
  | { readonly ok: true; readonly imported: number }
  | { readonly ok: false; readonly check: ImportCheck };

/** Rule 6: all or nothing. One invalid line and nothing is imported. */
export async function importResources(
  ports: Ports,
  kind: ResourceKind,
  csv: string,
): Promise<ImportResult> {
  const { check, resources } = await parse(ports, kind, csv);
  if (!check.ready) return { ok: false, check };
  try {
    return { ok: true, imported: await ports.resources.createMany(resources) };
  } catch (error) {
    // A plate was taken since the check: check again to say which.
    if (error instanceof PlateTakenError)
      return { ok: false, check: await checkImport(ports, kind, csv) };
    throw error;
  }
}
