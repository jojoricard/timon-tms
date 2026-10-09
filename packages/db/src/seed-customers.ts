import type { ContactInput, CustomerInput, SiteRecord } from '@timon/app';
import {
  type BookingMethod,
  type Coordinates,
  type LocatedBy,
  type OpeningRange,
  parseTime,
  timeZoneOf,
  type Weekday,
} from '@timon/domain';
import type { Repositories } from './repositories.ts';

// The customers and sites of the SPEC-002 mockups. Coordinates were taken once from the IGN
// geocoding service and are written here: the seed never calls the network. Data is in French,
// like the haulier's; sites keep the names shown on the mockups, translated.

const equipment = {
  shoes: '60000000-0000-4000-8000-000000000001',
  vest: '60000000-0000-4000-8000-000000000002',
  hat: '60000000-0000-4000-8000-000000000003',
  glasses: '60000000-0000-4000-8000-000000000004',
  gloves: '60000000-0000-4000-8000-000000000005',
} as const;
type Equipment = keyof typeof equipment;

/** "06:00-12:00/13:00-17:30" on the given days (1 is Monday). */
function hours(days: readonly Weekday[], ranges: string): OpeningRange[] {
  return days.flatMap((weekday) =>
    ranges.split('/').map((range) => {
      const [start = '', end = ''] = range.split('-');
      return { weekday, startMinute: parseTime(start) ?? 0, endMinute: parseTime(end) ?? 0 };
    }),
  );
}
const weekdaysOnly: Weekday[] = [1, 2, 3, 4, 5];

type SiteRow = {
  key: string;
  name: string;
  street1: string;
  postcode: string;
  city: string;
  country?: string;
  location: Coordinates | null;
  locatedBy: LocatedBy;
  openings: OpeningRange[];
  booking?: [BookingMethod, string];
  equipment: Equipment[];
  maxLengthCm?: number;
  maxWeightKg?: number;
  loadingDock?: boolean;
  semiTrailersAccepted?: boolean;
  gatePhone?: string;
  instructions?: string;
};

const at = (latitude: number, longitude: number): Coordinates => ({ latitude, longitude });
const stPriest = hours([...weekdaysOnly], '05:00-21:00').concat(hours([6], '06:00-12:00'));

const sites: SiteRow[] = [
  {
    key: 'chassieu',
    name: 'Bricolage Chassieu',
    street1: '50 avenue du Progrès',
    postcode: '69680',
    city: 'Chassieu',
    location: at(45.732684, 4.96444),
    locatedBy: 'address',
    openings: hours(weekdaysOnly, '07:00-11:30'),
    equipment: ['vest'],
  },
  {
    key: 'part-dieu',
    name: 'Chantier Part-Dieu, lot 3',
    street1: 'Rue Garibaldi',
    postcode: '69003',
    city: 'Lyon',
    location: at(45.756911, 4.852761),
    locatedBy: 'street',
    openings: hours(weekdaysOnly, '07:30-15:00'),
    equipment: ['shoes', 'vest', 'hat', 'gloves'],
    maxLengthCm: 1200,
    semiTrailersAccepted: false,
    instructions:
      'Accès chantier par la rue Garibaldi, côté grue. Casque obligatoire dès le portail.',
  },
  {
    key: 'corbas',
    name: 'Hub de Corbas — cross-dock',
    street1: '2 rue Marcel Mérieux',
    postcode: '69960',
    city: 'Corbas',
    location: at(45.669884, 4.922143),
    locatedBy: 'address',
    openings: hours([1, 2, 3, 4, 5, 6, 7], '00:00-24:00'),
    booking: ['portal', 'rdv.hub-corbas.fr'],
    equipment: ['shoes', 'vest'],
  },
  {
    key: 'vercors',
    name: 'Fromageries du Vercors',
    street1: '180 avenue du Général de Gaulle',
    postcode: '38250',
    city: 'Villard-de-Lans',
    location: at(45.072158, 5.552267),
    locatedBy: 'address',
    openings: hours(weekdaysOnly, '06:30-11:00/14:00-16:30'),
    booking: ['phone', '04 76 95 12 30'],
    equipment: [],
    maxWeightKg: 19_000,
    loadingDock: false,
  },
  {
    key: 'laiterie',
    name: 'Laiterie, quai réception',
    street1: 'ZA de la Gabelotière',
    postcode: '42330',
    city: 'Saint-Symphorien-sur-Coise',
    location: at(45.63215, 4.45861),
    locatedBy: 'by-hand',
    openings: hours([1, 2, 3, 4, 5, 6], '04:00-10:00'),
    booking: ['phone', '04 77 54 30 21'],
    equipment: ['shoes', 'vest'],
  },
  {
    key: 'meyzieu',
    name: 'Entrepôt pharma Meyzieu',
    street1: '8 rue du Berry',
    postcode: '69330',
    city: 'Meyzieu',
    location: at(45.759949, 5.014551),
    locatedBy: 'address',
    openings: hours(weekdaysOnly, '08:00-12:00/13:30-16:00'),
    booking: ['email', 'rdv.meyzieu@pharmalp.fr'],
    equipment: ['shoes', 'vest', 'glasses'],
  },
  {
    key: 'dock-b',
    name: 'Plateforme Saint-Priest — quai B',
    street1: '14 rue des Frères Lumière',
    postcode: '69800',
    city: 'Saint-Priest',
    location: at(45.6906, 4.9488),
    locatedBy: 'by-hand',
    openings: stPriest,
    booking: ['portal', 'rdv.plateforme-stpriest.fr'],
    equipment: ['shoes', 'vest', 'hat'],
    maxLengthCm: 1650,
    maxWeightKg: 44_000,
    gatePhone: '04 72 23 18 90',
    instructions: 'Porte 3, se présenter au poste de garde avec le numéro de rendez-vous.',
  },
  {
    key: 'dock-c',
    name: 'Plateforme Saint-Priest — quai C',
    street1: '14 rue des Frères Lumière',
    postcode: '69800',
    city: 'Saint-Priest',
    location: null,
    locatedBy: 'not-located',
    openings: stPriest,
    booking: ['portal', 'rdv.plateforme-stpriest.fr'],
    equipment: ['shoes', 'vest', 'hat'],
    maxLengthCm: 1650,
    maxWeightKg: 44_000,
    gatePhone: '04 72 23 18 90',
    instructions:
      'Porte 3, se présenter au poste de garde avec le numéro de rendez-vous. Moteur coupé pendant l’attente.',
  },
  {
    key: 'torino',
    name: 'Transalpina magazzino',
    street1: 'Via Pianezza 123',
    postcode: '10151',
    city: 'Torino',
    country: 'IT',
    location: at(45.0977, 7.6447),
    locatedBy: 'by-hand',
    openings: hours(weekdaysOnly, '08:00-12:00/14:00-17:00'),
    booking: ['email', 'magazzino@transalpina.it'],
    equipment: ['shoes', 'vest'],
  },
  {
    key: 'venissieux',
    name: 'Dépôt de Vénissieux',
    street1: '8 rue Antoine Billon',
    postcode: '69200',
    city: 'Vénissieux',
    location: at(45.698486, 4.881764),
    locatedBy: 'address',
    openings: hours(weekdaysOnly, '06:00-12:00/13:00-17:30'),
    equipment: ['shoes', 'vest'],
    loadingDock: false,
  },
  {
    key: 'vienne',
    name: 'Silo de Vienne',
    street1: 'Chemin du Silo',
    postcode: '38200',
    city: 'Vienne',
    location: at(45.526486, 4.88366),
    locatedBy: 'city',
    openings: hours([1, 2, 3, 5], '07:00-16:00'),
    equipment: ['shoes', 'vest', 'hat'],
    maxWeightKg: 32_000,
    loadingDock: false,
  },
  {
    key: 'villeurbanne',
    name: 'Brasserie de Villeurbanne',
    street1: '75 cours Émile Zola',
    postcode: '69100',
    city: 'Villeurbanne',
    location: at(45.771158, 4.86971),
    locatedBy: 'address',
    openings: hours(weekdaysOnly, '06:00-13:00'),
    booking: ['phone', '04 78 85 40 12'],
    equipment: ['vest'],
    maxLengthCm: 1000,
    loadingDock: false,
  },
];

const contact = (
  name: string,
  role: string,
  phone: string | null,
  email: string | null,
): ContactInput => ({
  name,
  role,
  phone,
  email,
});

type CustomerRow = {
  code: string;
  name: string;
  country?: string;
  siret: string | null;
  vatNumber: string | null;
  street: string;
  postcode: string;
  city: string;
  notes?: string;
  contacts: ContactInput[];
  sites: string[];
};

const customers: CustomerRow[] = [
  {
    code: 'ALPES-FROID',
    name: 'Alpes Froid Logistique',
    siret: '36227586900018',
    vatNumber: 'FR43362275869',
    street: '210 avenue de la Boisse',
    postcode: '73000',
    city: 'Chambéry',
    contacts: [
      contact(
        'Céline Rivoire',
        'Responsable transport',
        '04 79 62 11 08',
        'c.rivoire@alpesfroid.fr',
      ),
      contact('Exploitation', 'Quai froid', '04 79 62 11 10', null),
      contact('Comptabilité', 'Factures', null, 'compta@alpesfroid.fr'),
    ],
    sites: ['corbas', 'vienne'],
  },
  {
    code: 'BRASS-RHONE',
    name: 'Brasserie du Rhône',
    siret: '53053041900015',
    vatNumber: 'FR40530530419',
    street: '75 cours Émile Zola',
    postcode: '69100',
    city: 'Villeurbanne',
    contacts: [
      contact('Julien Faure', 'Logistique', '04 78 85 40 10', 'j.faure@brasserie-rhone.fr'),
      contact('Accueil', 'Livraisons', '04 78 85 40 12', null),
    ],
    sites: ['villeurbanne', 'corbas'],
  },
  {
    code: 'DUPONT-MAT',
    name: 'Dupont Matériaux',
    siret: '74900893400012',
    vatNumber: 'FR86749008934',
    street: '8 rue du Lyonnais',
    postcode: '69200',
    city: 'Vénissieux',
    notes: 'Factures par e-mail uniquement, numéro de bon de commande sur chaque facture.',
    contacts: [
      contact(
        'Sandrine Dupont',
        'Responsable transport',
        '04 78 70 21 45',
        's.dupont@dupont-materiaux.fr',
      ),
      contact('Comptabilité fournisseurs', 'Factures', null, 'factures@dupont-materiaux.fr'),
      contact('Yanis Mercier', 'Cour, Vénissieux', '06 12 48 30 77', null),
    ],
    sites: ['venissieux', 'dock-b', 'chassieu', 'part-dieu'],
  },
  {
    code: 'GARNIER-BOIS',
    name: 'Garnier Bois et Panneaux',
    siret: '35324611900013',
    vatNumber: 'FR80353246119',
    street: '12 rue de la Scierie',
    postcode: '38300',
    city: 'Bourgoin-Jallieu',
    contacts: [contact('Pascal Garnier', 'Gérant', '04 74 93 25 60', 'p.garnier@garnier-bois.fr')],
    sites: ['corbas'],
  },
  {
    code: 'LUMIERE-EM',
    name: 'Lumière Électroménager',
    siret: '63122983800018',
    vatNumber: 'FR42631229838',
    street: '3 rue des Frères Lumière',
    postcode: '69800',
    city: 'Saint-Priest',
    contacts: [
      contact('Nathalie Brun', 'Supply chain', '04 72 23 40 50', 'n.brun@lumiere-em.fr'),
      contact('Service client', 'Litiges', null, 'sav@lumiere-em.fr'),
    ],
    sites: ['corbas', 'dock-b', 'chassieu', 'dock-c'],
  },
  {
    code: 'MONTS-LAIT',
    name: 'Laiterie des Monts du Lyonnais',
    siret: '62239003700019',
    vatNumber: 'FR51622390037',
    street: 'ZA de la Gabelotière',
    postcode: '42330',
    city: 'Saint-Symphorien-sur-Coise',
    contacts: [
      contact('Marc Thiollier', 'Expéditions', '04 77 54 30 20', 'expeditions@laiterie-monts.fr'),
      contact('Quai réception', 'Ramasse', '04 77 54 30 21', null),
    ],
    sites: ['laiterie'],
  },
  {
    code: 'PHARMALP',
    name: 'Pharmalp Distribution',
    siret: '66520360000028',
    vatNumber: 'FR33665203600',
    street: '8 rue du Berry',
    postcode: '69330',
    city: 'Meyzieu',
    contacts: [
      contact('Dr Hélène Morel', 'Pharmacien responsable', '04 72 02 33 10', 'h.morel@pharmalp.fr'),
      contact('Réception', 'Rendez-vous', null, 'rdv.meyzieu@pharmalp.fr'),
      contact('Qualité', 'Chaîne du froid', '04 72 02 33 14', null),
    ],
    sites: ['meyzieu'],
  },
  {
    code: 'RHONE-AGRO',
    name: 'Rhône Agro Services',
    siret: '48044056900014',
    vatNumber: 'FR77480440569',
    street: '5 quai Riondet',
    postcode: '38200',
    city: 'Vienne',
    contacts: [
      contact('Olivier Chapuis', 'Responsable silo', '04 74 85 12 40', 'o.chapuis@rhone-agro.fr'),
      contact('Bascule', 'Pesée', '04 74 85 12 41', null),
    ],
    sites: ['vienne', 'corbas'],
  },
  {
    code: 'SAVOIE-PAP',
    name: 'Papeterie de Savoie',
    siret: '60272081500011',
    vatNumber: 'FR07602720815',
    street: '1 avenue des Chasseurs Alpins',
    postcode: '73200',
    city: 'Albertville',
    contacts: [
      contact('Logistique', 'Expéditions', '04 79 32 08 00', 'logistique@papeterie-savoie.fr'),
    ],
    sites: ['dock-b'],
  },
  {
    code: 'TEXT-CROIX',
    name: 'Textiles de la Croix-Rousse',
    siret: '30439547800015',
    vatNumber: 'FR25304395478',
    street: '22 rue d’Austerlitz',
    postcode: '69004',
    city: 'Lyon',
    contacts: [contact('Claire Besson', 'Atelier', '04 78 28 14 60', null)],
    sites: [],
  },
  {
    code: 'TRANSALP-IT',
    name: 'Transalpina Ricambi S.r.l.',
    country: 'IT',
    siret: null,
    vatNumber: 'IT08839120017',
    street: 'Via Pianezza 123',
    postcode: '10151',
    city: 'Torino',
    contacts: [
      contact('Giulia Ferrero', 'Logistica', '+39 011 456 7820', 'g.ferrero@transalpina.it'),
      contact('Magazzino', 'Ricevimento', null, 'magazzino@transalpina.it'),
    ],
    sites: ['torino'],
  },
  {
    code: 'VERCORS-FRO',
    name: 'Fromageries du Vercors',
    siret: null,
    vatNumber: null,
    street: '180 avenue du Général de Gaulle',
    postcode: '38250',
    city: 'Villard-de-Lans',
    notes: 'SIRET en cours d’immatriculation.',
    contacts: [contact('Bernard Arnaud', 'Fromager', '04 76 95 12 30', null)],
    sites: ['vercors'],
  },
];

function siteRecord(row: SiteRow): SiteRecord {
  const country = row.country ?? 'FR';
  return {
    name: row.name,
    street1: row.street1,
    street2: null,
    postcode: row.postcode,
    city: row.city,
    country,
    location: row.location,
    locatedBy: row.locatedBy,
    timeZone: timeZoneOf(country),
    openings: row.openings,
    bookingRequired: row.booking !== undefined,
    bookingMethod: row.booking?.[0] ?? null,
    bookingDetail: row.booking?.[1] ?? null,
    protectiveEquipmentIds: row.equipment.map((e) => equipment[e]),
    maxLengthCm: row.maxLengthCm ?? null,
    maxWeightKg: row.maxWeightKg ?? null,
    loadingDock: row.loadingDock ?? true,
    semiTrailersAccepted: row.semiTrailersAccepted ?? true,
    gatePhone: row.gatePhone ?? null,
    instructions: row.instructions ?? null,
  };
}

/** The protective equipment Samuel Moreau holds on the driver mockup. */
export const moreauEquipment = [equipment.shoes, equipment.vest, equipment.gloves];

/** Writes the customers and sites of the mockups, linked as the mockups show. */
export async function seedCustomers(repositories: Repositories): Promise<void> {
  const ids = new Map<string, string>();
  for (const row of sites) {
    const created = await repositories.sites.create(siteRecord(row));
    ids.set(row.key, created.id);
  }
  for (const row of customers) {
    const input: CustomerInput = {
      code: row.code,
      name: row.name,
      country: row.country ?? 'FR',
      siret: row.siret,
      vatNumber: row.vatNumber,
      billingStreet1: row.street,
      billingStreet2: null,
      billingPostcode: row.postcode,
      billingCity: row.city,
      notes: row.notes ?? null,
      contacts: row.contacts,
      siteIds: row.sites.flatMap((key) => {
        const id = ids.get(key);
        return id ? [id] : [];
      }),
    };
    await repositories.customers.create(input);
  }
}
