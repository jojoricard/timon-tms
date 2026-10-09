import type { NewDocument, NewResource, ReferenceLists } from '@timon/app';
import {
  companyDay,
  type Driver,
  defaultDisplayName,
  Temporal,
  type Vehicle,
  type VehicleCategory,
  type VehicleKind,
} from '@timon/domain';
import { count } from 'drizzle-orm';
import type { Database } from './database.ts';
import { createRepositories } from './repositories.ts';
import { customer, documentType, resource } from './schema.ts';
import { moreauEquipment, seedCustomers } from './seed-customers.ts';

// The haulier of the mockups, south of Lyon: 18 drivers, 12 power units, 15 trailers. Dates
// are written as on the mockups, dated Tuesday 6 October 2026, and moved by as many days as
// separate that date from today: the demo always shows the same deadlines, in the same order.
const mockupDay = Temporal.PlainDate.from('2026-10-06');

const companyId = '10000000-0000-4000-8000-000000000001';
const insuranceTypeId = '20000000-0000-4000-8000-000000000100';

type DriverRow = {
  first: string;
  last: string;
  licences: Partial<Record<'c1' | 'c' | 'ce', string>>;
  cpc: string;
  card: string;
  adr?: string;
  health?: string;
};

const drivers: DriverRow[] = [
  {
    first: 'Karim',
    last: 'Benali',
    licences: { c: '2030-05-15', ce: '2030-05-15' },
    cpc: '2031-03-15',
    card: '2029-02-15',
    health: '2026-10-02',
  },
  {
    first: 'Lucie',
    last: 'Fabre',
    licences: { c: '2031-04-15', ce: '2031-04-15' },
    cpc: '2026-12-12',
    card: '2028-07-15',
    adr: '2027-09-15',
  },
  {
    first: 'Marc',
    last: 'Laurent',
    licences: { c: '2030-09-15', ce: '2030-09-15' },
    cpc: '2029-05-15',
    card: '2026-10-21',
  },
  {
    first: 'Samuel',
    last: 'Moreau',
    licences: { c: '2029-11-15', ce: '2029-11-15' },
    cpc: '2026-10-18',
    card: '2028-11-15',
    adr: '2027-06-15',
  },
  {
    first: 'Nadia',
    last: 'Bensaïd',
    licences: { c: '2028-08-15' },
    cpc: '2030-04-15',
    card: '2030-01-15',
  },
  {
    first: 'Thomas',
    last: 'Girard',
    licences: { c: '2030-02-15', ce: '2030-02-15' },
    cpc: '2026-09-28',
    card: '2027-03-15',
  },
  {
    first: 'Hugo',
    last: 'Perrin',
    licences: { c: '2030-06-15', ce: '2030-06-15' },
    cpc: '2028-06-15',
    card: '2029-09-15',
    adr: '2028-02-15',
  },
  {
    first: 'Élodie',
    last: 'Marchand',
    licences: { c1: '2029-07-15' },
    cpc: '2029-11-15',
    card: '2030-05-15',
  },
  {
    first: 'Julien',
    last: 'Roux',
    licences: { c: '2031-01-15', ce: '2031-01-15' },
    cpc: '2030-02-15',
    card: '2027-12-15',
    adr: '2027-01-15',
  },
  {
    first: 'Sofiane',
    last: 'Haddad',
    licences: { c: '2030-10-15', ce: '2030-10-15' },
    cpc: '2029-07-15',
    card: '2028-08-15',
  },
  {
    first: 'Pierre',
    last: 'Vidal',
    licences: { c: '2031-06-15', ce: '2031-06-15' },
    cpc: '2031-01-15',
    card: '2029-04-15',
    adr: '2028-10-15',
  },
  {
    first: 'Camille',
    last: 'Dupuis',
    licences: { c: '2029-03-15' },
    cpc: '2028-03-15',
    card: '2027-06-15',
  },
  {
    first: 'Antoine',
    last: 'Lefèvre',
    licences: { c: '2029-12-15', ce: '2029-12-15' },
    cpc: '2027-08-15',
    card: '2026-11-02',
  },
  {
    first: 'Yanis',
    last: 'Morel',
    licences: { c: '2031-03-15', ce: '2031-03-15' },
    cpc: '2029-09-15',
    card: '2029-01-15',
  },
  {
    first: 'Claire',
    last: 'Besson',
    licences: { c: '2030-08-15' },
    cpc: '2030-06-15',
    card: '2028-12-15',
  },
  {
    first: 'Mehdi',
    last: 'Chérif',
    licences: { c: '2030-12-15', ce: '2030-12-15' },
    cpc: '2028-10-15',
    card: '2029-06-15',
    adr: '2028-05-15',
  },
  {
    first: 'Laura',
    last: 'Giraud',
    licences: { c1: '2031-02-15' },
    cpc: '2029-03-15',
    card: '2030-03-15',
  },
  {
    first: 'Olivier',
    last: 'Brun',
    licences: { c: '2029-08-15', ce: '2029-08-15' },
    cpc: '2028-09-15',
    card: '2027-09-15',
  },
];

type DocumentRow = { expires: string; reference?: string; issued?: string };
type VehicleRow = {
  plate: string;
  kind: VehicleKind;
  category: VehicleCategory;
  gvw: number;
  gcw?: number;
  model?: string;
  body?: string;
  label?: string;
  capabilities?: string[];
  documents: Record<string, DocumentRow | string>;
};

const tractor = (plate: string, model: string, documents: VehicleRow['documents']): VehicleRow => ({
  plate,
  kind: 'tractor',
  category: 'N3',
  gvw: 19_000,
  gcw: 44_000,
  model,
  label: 'PL',
  documents,
});

const powerUnits: VehicleRow[] = [
  tractor('AB-123-CD', 'Volvo FH 460', { roadworthiness: '2027-04-15', tachograph: '2027-11-15' }),
  tractor('CD-456-EF', 'Renault T 480', {
    roadworthiness: { expires: '2027-03-12', issued: '2026-03-12', reference: 'CT-2026-0412' },
    tachograph: { expires: '2026-10-22', issued: '2024-10-22', reference: 'TACH-88213' },
    'adr-approval': { expires: '2027-06-30', issued: '2026-06-30', reference: 'ADR-69-1187' },
    insurance: { expires: '2026-12-31', issued: '2026-01-01', reference: 'AXA 4471-PL' },
  }),
  tractor('EF-789-GH', 'DAF XF 480', { roadworthiness: '2027-05-15', tachograph: '2028-01-15' }),
  tractor('QR-678-ST', 'Scania R 450', { roadworthiness: '2027-02-15', tachograph: '2027-08-15' }),
  tractor('IJ-345-KL', 'Mercedes Actros 1845', {
    roadworthiness: '2027-06-15',
    tachograph: '2028-03-15',
  }),
  tractor('ST-234-UV', 'Iveco S-Way 490', {
    roadworthiness: '2027-01-20',
    tachograph: '2027-07-15',
  }),
  tractor('KL-678-MN', 'MAN TGX 18.470', {
    roadworthiness: '2027-03-20',
    tachograph: '2028-02-15',
  }),
  {
    plate: 'GH-012-IJ',
    kind: 'rigid-truck',
    category: 'N3',
    gvw: 19_000,
    model: 'Renault D Wide',
    body: 'refrigerated',
    label: 'GP',
    capabilities: ['temperature-control', 'tail-lift'],
    documents: { roadworthiness: '2027-02-15', tachograph: '2027-10-15', atp: '2026-11-24' },
  },
  {
    plate: 'MN-345-OP',
    kind: 'rigid-truck',
    category: 'N3',
    gvw: 19_000,
    model: 'Renault D Wide',
    body: 'box',
    label: 'GP',
    capabilities: ['tail-lift'],
    documents: { roadworthiness: '2027-04-25', tachograph: '2028-04-15' },
  },
  {
    plate: 'OP-901-QR',
    kind: 'rigid-truck',
    category: 'N2',
    gvw: 12_000,
    model: 'DAF LF 230',
    body: 'box',
    label: 'PP',
    capabilities: ['tail-lift'],
    documents: { roadworthiness: '2027-05-25', tachograph: '2027-12-15' },
  },
  {
    plate: 'FG-204-HJ',
    kind: 'light-van',
    category: 'N1',
    gvw: 3_500,
    model: 'Renault Master',
    body: 'box',
    documents: { roadworthiness: '2027-03-05' },
  },
  {
    plate: 'JK-318-LM',
    kind: 'light-van',
    category: 'N1',
    gvw: 3_500,
    model: 'Iveco Daily',
    body: 'box',
    capabilities: ['tail-lift'],
    documents: { roadworthiness: '2027-06-05' },
  },
];

const semiTrailer = (
  plate: string,
  body: string,
  documents: VehicleRow['documents'],
): VehicleRow => ({
  plate,
  kind: 'semi-trailer',
  category: 'O4',
  gvw: 35_000,
  body,
  capabilities: body === 'curtainsider' ? ['side-loading'] : [],
  documents,
});
const reefer = (plate: string, documents: VehicleRow['documents']): VehicleRow => ({
  ...semiTrailer(plate, 'refrigerated', documents),
  gvw: 34_000,
  capabilities: ['temperature-control'],
});
const drawbar = (plate: string, documents: VehicleRow['documents']): VehicleRow => ({
  plate,
  kind: 'drawbar-trailer',
  category: 'O3',
  gvw: 10_000,
  body: 'box',
  documents,
});

const trailers: VehicleRow[] = [
  semiTrailer('SR-4471', 'curtainsider', { roadworthiness: '2027-04-15' }),
  semiTrailer('SR-4472', 'curtainsider', { roadworthiness: '2027-09-02' }),
  semiTrailer('SR-4475', 'curtainsider', { roadworthiness: '2027-03-30' }),
  semiTrailer('SR-4480', 'curtainsider', { roadworthiness: '2026-10-29' }),
  semiTrailer('SR-4483', 'curtainsider', { roadworthiness: '2027-08-12' }),
  semiTrailer('SR-4486', 'box', { roadworthiness: '2027-02-28' }),
  semiTrailer('SR-4488', 'flatbed', { roadworthiness: '2027-06-18' }),
  semiTrailer('SR-4492', 'curtainsider', {
    roadworthiness: '2027-05-10',
    'adr-approval': '2027-04-30',
  }),
  semiTrailer('SR-4495', 'curtainsider', { roadworthiness: '2027-07-20' }),
  semiTrailer('SR-4501', 'curtainsider', { roadworthiness: '2027-01-25' }),
  reefer('FR-2210', { roadworthiness: '2027-01-20', atp: '2027-12-15' }),
  reefer('FR-2214', { roadworthiness: '2027-04-05', atp: '2028-03-15' }),
  reefer('FR-2219', { roadworthiness: '2027-08-05', atp: '2027-02-15' }),
  drawbar('RQ-0912', { roadworthiness: '2026-12-07' }),
  drawbar('RQ-0915', { roadworthiness: '2027-05-07' }),
];

function build(lists: ReferenceLists, shift: number) {
  const day = (iso: string) => Temporal.PlainDate.from(iso).add({ days: shift });
  const byCode = (items: ReferenceLists['bodyTypes'], code: string) => {
    const item = items.find((i) => i.code === code || i.name === code);
    if (!item) throw new Error(`No list entry ${code}`);
    return item.id;
  };
  const typeId = (code: string) =>
    code === 'insurance' ? insuranceTypeId : byCode(lists.documentTypes, code);
  const documents = (entries: Record<string, DocumentRow | string>): NewDocument[] =>
    Object.entries(entries).map(([code, row]) => {
      const { expires, issued, reference } = typeof row === 'string' ? { expires: row } : row;
      return {
        documentTypeId: typeId(code),
        reference: reference ?? null,
        issuedOn: issued ? day(issued) : null,
        expiresOn: day(expires),
      };
    });

  const people = drivers.map((d, index): NewResource => {
    const details: Driver = {
      kind: 'driver',
      lastName: d.last,
      firstName: d.first,
      displayName: defaultDisplayName(d.first, d.last),
      employeeNumber: `E-${1001 + index}`,
      phone: `06 12 34 ${20 + index} ${40 + index}`,
      // Samuel Moreau holds three of the five items on the driver mockup of SPEC-002.
      protectiveEquipmentIds: d.last === 'Moreau' ? moreauEquipment : [],
    };
    return {
      details,
      documents: documents({
        ...Object.fromEntries(
          Object.entries(d.licences).map(([c, date]) => [`licence-${c}`, date]),
        ),
        cpc: d.cpc,
        'driver-card': d.card,
        ...(d.adr ? { 'adr-certificate': d.adr } : {}),
        ...(d.health ? { 'health-check': d.health } : {}),
      }),
    };
  });

  const vehicle =
    (kind: Vehicle['kind']) =>
    (v: VehicleRow): NewResource => ({
      details: {
        kind,
        plate: v.plate,
        vehicleKind: v.kind,
        category: v.category,
        gvwKg: v.gvw,
        gcwKg: v.gcw ?? null,
        makeModel: v.model ?? null,
        bodyTypeId: v.body ? byCode(lists.bodyTypes, v.body) : null,
        tradeLabelId: v.label ? byCode(lists.tradeLabels, v.label) : null,
        capabilityIds: (v.capabilities ?? []).map((c) => byCode(lists.capabilities, c)),
      },
      documents: documents(v.documents),
    });

  return [...people, ...powerUnits.map(vehicle('power-unit')), ...trailers.map(vehicle('trailer'))];
}

/**
 * Writes the demo haulier: resources, then customers and sites. Each part is skipped when it
 * already exists, so it is safe to run at every start of the demo, and on a database seeded
 * before customers existed.
 */
export async function seed(
  db: Database,
  today = companyDay(Temporal.Now.instant()),
): Promise<boolean> {
  const repositories = createRepositories(db);
  const [resources] = await db.select({ n: count() }).from(resource);
  const [customers] = await db.select({ n: count() }).from(customer);
  const writeResources = (resources?.n ?? 0) === 0;
  const writeCustomers = (customers?.n ?? 0) === 0;

  if (writeResources) {
    // A list entry of this company, not one Timon provides: it has a name, not a code.
    await db
      .insert(documentType)
      .values({
        id: insuranceTypeId,
        companyId,
        name: "Attestation d'assurance",
        appliesTo: ['power-unit', 'trailer'],
        blocking: false,
        warnDays: 30,
        sortOrder: 100,
      })
      .onConflictDoNothing();
    const lists = await repositories.referenceLists.get();
    await repositories.resources.createMany(build(lists, mockupDay.until(today).days));
  }
  if (writeCustomers) await seedCustomers(repositories);
  return writeResources || writeCustomers;
}
