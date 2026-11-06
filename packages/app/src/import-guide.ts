import {
  type ResourceKind,
  type VehicleCategory,
  vehicleCategories,
  vehicleKindsOf,
} from '@timon/domain';
import type { CsvColumn } from './csv.ts';
import { customerColumns } from './customer-import.ts';
import {
  bookingAliases,
  type ColumnKind,
  importColumns,
  noBookingAliases,
  valueAliases,
} from './import-format.ts';
import type { ListItem, ReferenceLists } from './ports.ts';
import { siteColumns } from './site-import.ts';

// SPEC-001, Import: the screen lists the values each column accepts. They are read from the
// tables the import itself reads, so that the screen cannot promise what the import refuses.

/** What a column accepts; the interface says it in its language. */
export type AcceptedValues =
  | {
      readonly kind:
        | 'text'
        | 'date'
        | 'weight'
        | 'number'
        | 'metres'
        | 'yes-no'
        | 'country'
        | 'hours';
    }
  /** One value, written any of the ways of its group: ["tractor", "tracteur"]. */
  | { readonly kind: 'one-of'; readonly values: readonly (readonly string[])[] }
  /** Several values separated by "|" or ",", each written any of the ways of its group. */
  | { readonly kind: 'list-of'; readonly values: readonly (readonly string[])[] };

export type GuideColumn = {
  readonly field: string;
  /** The column's name in the language of the template. */
  readonly header: string;
  readonly required: boolean;
  readonly accepts: AcceptedValues;
};

/** The ways an entry of a company list may be written: its code and aliases, or its name. */
function spellings(item: ListItem): readonly string[] {
  if (item.code === null) return item.name === null ? [] : [item.name];
  return valueAliases[item.code] ?? [item.code];
}

const entries = (items: readonly ListItem[]) =>
  items.map(spellings).filter((values) => values.length > 0);

const categoriesOf = (kind: ResourceKind): readonly VehicleCategory[] =>
  vehicleCategories.filter((c) => c.startsWith(kind === 'trailer' ? 'O' : 'N'));

export function resourceImportGuide(
  kind: ResourceKind,
  language: 'en' | 'fr',
  lists: ReferenceLists,
): GuideColumn[] {
  const accepts: Record<ColumnKind, () => AcceptedValues> = {
    text: () => ({ kind: 'text' }),
    weight: () => ({ kind: 'weight' }),
    document: () => ({ kind: 'date' }),
    'vehicle-kind': () => ({
      kind: 'one-of',
      values: vehicleKindsOf(kind === 'trailer' ? 'trailer' : 'power-unit').map(
        (k) => valueAliases[k] ?? [k],
      ),
    }),
    category: () => ({ kind: 'one-of', values: categoriesOf(kind).map((c) => [c]) }),
    'body-type': () => ({ kind: 'one-of', values: entries(lists.bodyTypes) }),
    'trade-label': () => ({ kind: 'one-of', values: entries(lists.tradeLabels) }),
    capabilities: () => ({ kind: 'list-of', values: entries(lists.capabilities) }),
    'protective-equipment': () => ({
      kind: 'list-of',
      values: entries(lists.protectiveEquipment),
    }),
  };
  return importColumns[kind].map((column) => ({
    field: column.field,
    header: column[language],
    required: column.required,
    accepts: accepts[column.kind](),
  }));
}

const guide = (
  columns: readonly CsvColumn[],
  language: 'en' | 'fr',
  accepts: (field: string) => AcceptedValues,
): GuideColumn[] =>
  columns.map((column) => ({
    field: column.field,
    header: column[language],
    required: column.required ?? false,
    accepts: accepts(column.field),
  }));

export function customerImportGuide(language: 'en' | 'fr'): GuideColumn[] {
  return guide(customerColumns, language, (field) =>
    field === 'country' ? { kind: 'country' } : { kind: 'text' },
  );
}

export function siteImportGuide(language: 'en' | 'fr', lists: ReferenceLists): GuideColumn[] {
  const byField: Record<string, AcceptedValues> = {
    country: { kind: 'country' },
    latitude: { kind: 'number' },
    longitude: { kind: 'number' },
    bookingMethod: {
      kind: 'one-of',
      values: [noBookingAliases, ...Object.values(bookingAliases)],
    },
    protectiveEquipmentIds: { kind: 'list-of', values: entries(lists.protectiveEquipment) },
    maxLengthCm: { kind: 'metres' },
    maxWeightKg: { kind: 'weight' },
    loadingDock: { kind: 'yes-no' },
    semiTrailersAccepted: { kind: 'yes-no' },
  };
  return guide(siteColumns, language, (field) =>
    field.startsWith('openings.') ? { kind: 'hours' } : (byField[field] ?? { kind: 'text' }),
  );
}
