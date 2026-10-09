import Papa from 'papaparse';

// Reading an import file, whatever it holds: limits, separator, header in English or French,
// line numbers. Each import then reads its own columns from the lines.

/** Larger files are refused before they are read. */
export const importLimits = { maxBytes: 1_000_000, maxLines: 2_000 } as const;

export type FileProblem =
  | { readonly code: 'too-large'; readonly params: { maxBytes: number } }
  | { readonly code: 'too-many-lines'; readonly params: { maxLines: number } }
  | { readonly code: 'empty' }
  | { readonly code: 'missing-columns'; readonly params: { fields: readonly string[] } };

export type CsvColumn = {
  /** The field of the record the column fills. */
  readonly field: string;
  readonly en: string;
  readonly fr: string;
  readonly required: boolean;
};

export type CsvLine = {
  /** Line in the file, the header being line 1. */
  readonly line: number;
  /** The cells as typed, trimmed, by field; columns the file does not have are absent. */
  readonly cells: Readonly<Record<string, string>>;
};

/** Lower case, no accents, words joined by single spaces. */
export function simplify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A header line in English or French, separated by semicolons as French spreadsheets expect. */
export function csvTemplate(columns: readonly CsvColumn[], language: 'en' | 'fr'): string {
  return `${columns.map((c) => c[language]).join(';')}\r\n`;
}

export function readCsv(
  csv: string,
  columns: readonly CsvColumn[],
): { readonly problem: FileProblem } | { readonly lines: readonly CsvLine[] } {
  if (new TextEncoder().encode(csv).byteLength > importLimits.maxBytes) {
    return { problem: { code: 'too-large', params: { maxBytes: importLimits.maxBytes } } };
  }
  const { data } = Papa.parse<string[]>(csv.replace(/^﻿/, ''), {
    delimiter: '',
    delimitersToGuess: [';', ',', '\t'],
    skipEmptyLines: false,
  });
  const [header = [], ...rows] = data;
  const filled = rows
    .map((cells, index) => ({ cells, line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  if (filled.length === 0) return { problem: { code: 'empty' } };
  if (filled.length > importLimits.maxLines) {
    return { problem: { code: 'too-many-lines', params: { maxLines: importLimits.maxLines } } };
  }

  const positions = new Map<string, number>();
  header.forEach((title, index) => {
    const column = columns.find((c) =>
      [c.en, c.fr, c.field].some((name) => simplify(name) === simplify(title)),
    );
    if (column && !positions.has(column.field)) positions.set(column.field, index);
  });
  const missing = columns.filter((c) => c.required && !positions.has(c.field)).map((c) => c.field);
  if (missing.length > 0)
    return { problem: { code: 'missing-columns', params: { fields: missing } } };

  return {
    lines: filled.map(({ cells, line }) => ({
      line,
      cells: Object.fromEntries(
        [...positions].map(([field, index]) => [field, (cells[index] ?? '').trim()]),
      ),
    })),
  };
}

/** "yes", "oui", "1", "x", "true" → true; empty → undefined; anything else → false. */
export function parseYesNo(value: string): boolean | undefined {
  const text = simplify(value);
  if (text === '') return undefined;
  return ['yes', 'oui', 'y', 'o', '1', 'x', 'true', 'vrai'].includes(text);
}

/** Runs `task` over `items` with at most `concurrency` at once, keeping the order of results. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
