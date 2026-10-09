import type { ResourceKind } from '@timon/domain';

// The CSV format of an import: one line per resource, one column per document expiry.
// Column names are accepted in English or French, with or without accents, case or spaces.

export type ColumnKind =
  | 'text'
  | 'weight'
  | 'vehicle-kind'
  | 'category'
  | 'body-type'
  | 'trade-label'
  | 'capabilities'
  | 'document';

export type ImportColumn = {
  /** The field of the record, or `document:<type code>` for a document expiry. */
  readonly field: string;
  readonly en: string;
  readonly fr: string;
  readonly required: boolean;
  readonly kind: ColumnKind;
};

const text = (field: string, en: string, fr: string, required = false): ImportColumn => ({
  field,
  en,
  fr,
  required,
  kind: 'text',
});
const expiry = (code: string, en: string, fr: string): ImportColumn => ({
  field: `document:${code}`,
  en,
  fr,
  required: false,
  kind: 'document',
});

const vehicleColumns = (withCombination: boolean): ImportColumn[] => [
  text('plate', 'plate', 'immatriculation', true),
  { field: 'vehicleKind', en: 'kind', fr: 'type', required: true, kind: 'vehicle-kind' },
  { field: 'category', en: 'category', fr: 'categorie', required: true, kind: 'category' },
  { field: 'gvwKg', en: 'gvw_kg', fr: 'ptac_kg', required: true, kind: 'weight' },
  ...(withCombination
    ? [{ field: 'gcwKg', en: 'gcw_kg', fr: 'ptra_kg', required: false, kind: 'weight' } as const]
    : []),
  text('makeModel', 'make_model', 'marque_modele'),
  { field: 'bodyTypeId', en: 'body_type', fr: 'carrosserie', required: false, kind: 'body-type' },
  {
    field: 'tradeLabelId',
    en: 'trade_label',
    fr: 'appellation',
    required: false,
    kind: 'trade-label',
  },
  {
    field: 'capabilityIds',
    en: 'capabilities',
    fr: 'aptitudes',
    required: false,
    kind: 'capabilities',
  },
  expiry('roadworthiness', 'roadworthiness', 'controle_technique'),
  ...(withCombination ? [expiry('tachograph', 'tachograph', 'chronotachygraphe')] : []),
  expiry('atp', 'atp', 'atp'),
  expiry('adr-approval', 'adr_approval', 'agrement_adr'),
];

export const importColumns: Record<ResourceKind, readonly ImportColumn[]> = {
  driver: [
    text('lastName', 'last_name', 'nom', true),
    text('firstName', 'first_name', 'prenom', true),
    text('displayName', 'display_name', 'nom_affiche'),
    text('employeeNumber', 'employee_number', 'matricule'),
    text('phone', 'phone', 'telephone'),
    expiry('licence-b', 'licence_b', 'permis_b'),
    expiry('licence-c1', 'licence_c1', 'permis_c1'),
    expiry('licence-c', 'licence_c', 'permis_c'),
    expiry('licence-ce', 'licence_ce', 'permis_ce'),
    expiry('licence-c1e', 'licence_c1e', 'permis_c1e'),
    expiry('cpc', 'cpc', 'fimo_fco'),
    expiry('driver-card', 'driver_card', 'carte_conducteur'),
    expiry('adr-certificate', 'adr_certificate', 'certificat_adr'),
    expiry('health-check', 'health_check', 'visite_medicale'),
  ],
  'power-unit': vehicleColumns(true),
  trailer: vehicleColumns(false),
};

export { simplify } from './csv.ts';

// Values accepted for the coded lists, besides the code itself.
export const valueAliases: Record<string, readonly string[]> = {
  tractor: ['tractor', 'tracteur'],
  'rigid-truck': ['rigid truck', 'rigid', 'porteur'],
  'light-van': ['light van', 'van', 'vul', 'utilitaire', 'vehicule utilitaire leger'],
  'semi-trailer': ['semi trailer', 'semi remorque', 'semi'],
  'drawbar-trailer': ['drawbar trailer', 'drawbar', 'remorque'],
  curtainsider: ['curtainsider', 'tautliner', 'savoyarde', 'rideaux coulissants', 'bachee'],
  box: ['box', 'fourgon'],
  refrigerated: ['refrigerated', 'reefer', 'frigorifique', 'frigo'],
  flatbed: ['flatbed', 'plateau'],
  tipper: ['tipper', 'benne'],
  tanker: ['tanker', 'citerne'],
  'tail-lift': ['tail lift', 'hayon'],
  crane: ['crane', 'grue'],
  'side-loading': ['side loading', 'chargement lateral'],
  'temperature-control': ['temperature control', 'temperature dirigee', 'temperature controlee'],
};
