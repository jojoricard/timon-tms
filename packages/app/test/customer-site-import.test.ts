import { describe, expect, it } from 'vitest';
import {
  acceptPreviewLocation,
  checkCustomerImport,
  checkSiteImport,
  customerTemplate,
  importCustomers,
  importSites,
  listSites,
  siteTemplate,
} from '../src/index.ts';
import { createFakeGeocoder, velizy } from './fake-geocoder.ts';
import { memoryPorts } from './memory.ts';

const header = 'name;street;postcode;city;country;monday;booking;protective_equipment';

/** 300 French sites without coordinates; `postcode(n)` may break one. */
function sites(count: number, postcode = (_line: number) => '69800') {
  const lines = [header];
  for (let line = 2; line <= count + 1; line += 1) {
    lines.push(
      `Site ${line};${line} rue de Lyon;${postcode(line)};Saint-Priest;FR;06:00-12:00/13:00-17:00;;shoes|vest`,
    );
  }
  return lines.join('\n');
}

describe('site import', () => {
  it('criterion 12: postcode "7814" on line 42 stops the import of 300 sites', async () => {
    const { ports, sites: stored } = memoryPorts();
    const csv = sites(300, (line) => (line === 42 ? '7814' : '69800'));
    const check = await checkSiteImport(ports, csv);
    expect(check.ready).toBe(false);
    expect(check.rows.filter((r) => r.issues.length > 0)).toMatchObject([
      { line: 42, issues: [{ field: 'postcode', code: 'postcode-invalid' }] },
    ]);
    expect(await importSites(ports, csv, [])).toMatchObject({ ok: false });
    expect(stored).toHaveLength(0);
  });

  it('criterion 13: 300 sites, one matching no address, are 299 located and 1 not located', async () => {
    const geocoder = createFakeGeocoder((q) => (q.startsWith('77 ') ? [] : [velizy]));
    const { ports } = memoryPorts(undefined, geocoder);
    const csv = sites(300);
    const check = await checkSiteImport(ports, csv);
    expect(check.summary).toMatchObject({ lines: 300, valid: 300, address: 299, notLocated: 1 });
    expect(geocoder.queries).toHaveLength(300);

    const locations = check.rows.map((r) => ({
      line: r.line,
      latitude: r.location?.latitude ?? null,
      longitude: r.location?.longitude ?? null,
      locatedBy: r.locatedBy ?? 'not-located',
    }));
    expect(await importSites(ports, csv, locations)).toEqual({
      ok: true,
      imported: 300,
      notLocated: 1,
    });
    // Confirming does not query the geocoder again.
    expect(geocoder.queries).toHaveLength(300);
    const { counts } = await listSites(ports);
    expect(counts).toMatchObject({ all: 300, 'not-located': 1 });
  });

  it('keeps coordinates given in the file, as placed by hand, without asking the geocoder', async () => {
    const geocoder = createFakeGeocoder(() => [velizy]);
    const { ports } = memoryPorts(undefined, geocoder);
    const csv =
      'nom;adresse;code_postal;ville;pays;latitude;longitude\nMagazzino;Via Roma 1;10156;Torino;Italie;45,1;7,7';
    const check = await checkSiteImport(ports, csv);
    expect(check.rows[0]).toMatchObject({
      issues: [],
      locatedBy: 'by-hand',
      location: { latitude: 45.1, longitude: 7.7 },
    });
    expect(geocoder.queries).toEqual([]);
  });

  it('does not locate a site abroad: it is imported as not located', async () => {
    const geocoder = createFakeGeocoder(() => [velizy]);
    const { ports } = memoryPorts(undefined, geocoder);
    const check = await checkSiteImport(
      ports,
      'name;street;city;country\nLager;Hauptstr. 1;Berlin;DE',
    );
    expect(check.rows[0]).toMatchObject({ issues: [], locatedBy: 'not-located' });
    expect(geocoder.queries).toEqual([]);
  });

  it('reads booking, equipment and hours, and lists unreadable cells by line', async () => {
    const { ports } = memoryPorts();
    const csv = [
      'name;street;postcode;city;monday;booking;protective_equipment;max_length_m',
      'Dock;1 rue A;69800;Saint-Priest;05:00-21:00;portail;casque;16,50',
      'Yard;2 rue B;69800;Saint-Priest;6 to 12;fax;parachute;long',
    ].join('\n');
    const check = await checkSiteImport(ports, csv);
    expect(check.rows.map((r) => r.issues.map((i) => `${i.field}:${i.code}`))).toEqual([
      [],
      [
        'openings.1:unknown-value',
        'bookingMethod:unknown-value',
        'protectiveEquipmentIds:unknown-value',
        'maxLengthCm:invalid-number',
      ],
    ]);
  });

  it('gives templates in both languages', () => {
    expect(siteTemplate('en')).toMatch(
      /^name;street;street2;postcode;city;country;latitude;longitude;monday;/,
    );
    expect(siteTemplate('fr')).toMatch(/^nom;adresse;complement_adresse;code_postal;ville;pays;/);
    expect(customerTemplate('fr')).toMatch(/^code;raison_sociale;pays;siret;/);
  });
});

describe('acceptPreviewLocation', () => {
  it('keeps a valid location found by the preview', () => {
    expect(
      acceptPreviewLocation({ line: 2, latitude: 45.7, longitude: 4.9, locatedBy: 'street' }),
    ).toEqual({
      location: { latitude: 45.7, longitude: 4.9 },
      locatedBy: 'street',
    });
  });

  it('falls back to not located for anything else', () => {
    const notLocated = { location: null, locatedBy: 'not-located' };
    expect(acceptPreviewLocation(undefined)).toEqual(notLocated);
    expect(
      acceptPreviewLocation({ line: 2, latitude: 91, longitude: 4.9, locatedBy: 'address' }),
    ).toEqual(notLocated);
    expect(
      acceptPreviewLocation({ line: 2, latitude: 45, longitude: 4, locatedBy: 'teleported' }),
    ).toEqual(notLocated);
    expect(
      acceptPreviewLocation({ line: 2, latitude: null, longitude: 4, locatedBy: 'address' }),
    ).toEqual(notLocated);
    expect(
      acceptPreviewLocation({ line: 2, latitude: Number.NaN, longitude: 4, locatedBy: 'address' }),
    ).toEqual(notLocated);
  });
});

describe('customer import', () => {
  it('imports customers with a contact, and refuses duplicates by line', async () => {
    const { ports, customers } = memoryPorts();
    const csv = [
      'code;name;country;siret;contact_name;contact_phone',
      'DUPONT-MAT;Dupont Matériaux;France;749 008 934 00012;Sandrine Dupont;04 78 70 21 45',
      'transalp-it;Transalpina Ricambi;Italy;;;',
    ].join('\n');
    expect(await importCustomers(ports, csv)).toEqual({ ok: true, imported: 2 });
    expect(customers.map((c) => [c.code, c.country, c.contacts.length])).toEqual([
      ['DUPONT-MAT', 'FR', 1],
      ['TRANSALP-IT', 'IT', 0],
    ]);

    const again = await checkCustomerImport(
      ports,
      'code;name;siret\nDUPONT-MAT;Dupont;\nNEW;New;74900893400012\nNEW;Newer;40483304800015',
    );
    expect(again.rows.map((r) => r.issues.map((i) => i.code))).toEqual([
      ['code-taken'],
      ['siret-taken'],
      ['siret-invalid'],
    ]);
  });
});
