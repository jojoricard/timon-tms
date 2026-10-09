// biome-ignore-all lint/suspicious/noExplicitAny: response bodies are read loosely in these tests.

import { createRepositories } from '@timon/db';
import { createTestDatabase, type TestDatabase } from '@timon/db/testing';
import { GeocoderUnavailableError } from '@timon/geocoding';
import { createApp } from '@timon/http';
import { Temporal } from 'temporal-polyfill';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// SPEC-002 through the HTTP API, on PGlite in-process, and on PostgreSQL 18 when
// TEST_DATABASE_URL is set (CI). The geocoder is a fake: tests never reach the network.

const velizy = {
  label: "2 Avenue de l'Europe 78140 Vélizy-Villacoublay",
  street: "2 Avenue de l'Europe",
  postcode: '78140',
  city: 'Vélizy-Villacoublay',
  country: 'FR',
  latitude: 48.784357,
  longitude: 2.218975,
  precision: 'address' as const,
  score: 0.97,
};

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
/** What the fake geocoder does: answer, find nothing, or be unreachable. */
let geocoding: 'answer' | 'nothing' | 'unreachable' = 'answer';
const queries: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  const now = Temporal.Instant.from('2026-10-08T10:00:00Z');
  app = createApp({
    ...createRepositories(database.db, { now: () => now }),
    geocoder: {
      search: async (query) => {
        queries.push(query);
        if (geocoding === 'unreachable') throw new GeocoderUnavailableError('down');
        if (geocoding === 'nothing' || query.startsWith('77 ')) return [];
        return [velizy];
      },
    },
  });
});

afterAll(() => database.close());

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text,
  };
}

const customer = (changes: Record<string, unknown> = {}) => ({
  code: 'DUPONT-MAT',
  name: 'Dupont Matériaux',
  country: 'FR',
  siret: '749 008 934 00012',
  vatNumber: 'FR86749008934',
  contacts: [{ name: 'Sandrine Dupont', role: 'Responsable transport', phone: '04 78 70 21 45' }],
  siteIds: [],
  ...changes,
});

const site = (changes: Record<string, unknown> = {}) => ({
  name: 'Plateforme Saint-Priest — quai B',
  street1: '14 rue des Frères Lumière',
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  latitude: 45.6906,
  longitude: 4.9488,
  locatedBy: 'by-hand',
  openings: [{ weekday: 1, startMinute: 300, endMinute: 1260 }],
  bookingRequired: true,
  bookingMethod: 'portal',
  bookingDetail: 'rdv.plateforme-stpriest.fr',
  protectiveEquipmentIds: ['60000000-0000-4000-8000-000000000001'],
  loadingDock: true,
  semiTrailersAccepted: true,
  ...changes,
});

describe('customers', () => {
  it('criterion 1: a wrong check digit is refused, the right one accepted', async () => {
    const wrong = await call(
      'POST',
      '/customers',
      customer({ code: 'C1', siret: '404 833 048 00015' }),
    );
    expect(wrong).toMatchObject({
      status: 400,
      body: { issues: [{ field: 'siret', code: 'siret-invalid' }] },
    });
    const right = await call(
      'POST',
      '/customers',
      customer({ code: 'C1', siret: '404 833 048 00014', vatNumber: 'FR83404833048' }),
    );
    expect(right).toMatchObject({
      status: 201,
      body: { siret: '40483304800014', vatNumber: 'FR83404833048' },
    });
  });

  it('criterion 2: the same SIRET is refused while the first customer is active, naming it', async () => {
    const second = await call(
      'POST',
      '/customers',
      customer({ code: 'C2', siret: '40483304800014' }),
    );
    expect(second).toMatchObject({
      status: 409,
      body: { error: 'siret-taken', owner: { code: 'C1', archived: false } },
    });
  });

  it('criterion 3: the code of an archived customer is refused, whatever its case', async () => {
    const first = await call('POST', '/customers', customer({ code: 'DUPONT-IDF', siret: null }));
    await call('POST', `/customers/${first.body.id}/archive`);
    const again = await call('POST', '/customers', customer({ code: 'dupont-idf', siret: null }));
    expect(again).toMatchObject({
      status: 409,
      body: { error: 'code-taken', owner: { archived: true } },
    });
  });

  it('criterion 4: a contact needs a phone or an email', async () => {
    const result = await call(
      'POST',
      '/customers',
      customer({ code: 'C4', siret: null, contacts: [{ name: 'Yanis Mercier' }] }),
    );
    expect(result).toMatchObject({
      status: 400,
      body: { issues: [{ field: 'contacts.0', code: 'contact-unreachable' }] },
    });
  });

  it('criterion 11: a removed contact no longer exists anywhere, archived lists included', async () => {
    const created = await call(
      'POST',
      '/customers',
      customer({
        code: 'C11',
        siret: null,
        contacts: [
          { name: 'Gardé', phone: '01' },
          { name: 'Supprimé', email: 'x@y.fr' },
        ],
      }),
    );
    const [kept] = created.body.contacts;
    await call(
      'PUT',
      `/customers/${created.body.id}`,
      customer({ code: 'C11', siret: null, contacts: [kept] }),
    );
    const all = await call('GET', '/customers?archived=true');
    const names = all.body.customers.flatMap((c: any) => c.contacts.map((x: any) => x.name));
    expect(names).toContain('Gardé');
    expect(names).not.toContain('Supprimé');
  });
});

describe('sites', () => {
  it('criterion 5: the suggestion of "2 avenue de l\'Europe" locates the site by address', async () => {
    const suggestions = await call(
      'GET',
      `/geocoding/search?q=${encodeURIComponent("2 avenue de l'Europe 78140 Vélizy-Villacoublay")}`,
    );
    expect(suggestions.body).toEqual({ available: true, candidates: [velizy] });
    const saved = await call(
      'POST',
      '/sites',
      site({
        name: 'Vélizy',
        street1: velizy.street,
        postcode: velizy.postcode,
        city: velizy.city,
        latitude: velizy.latitude,
        longitude: velizy.longitude,
        locatedBy: 'address',
      }),
    );
    expect(saved).toMatchObject({
      status: 201,
      body: { site: { locatedBy: 'address', postcode: '78140' } },
    });
  });

  it('criterion 6: a site in Germany placed by hand is in Europe/Berlin', async () => {
    const saved = await call(
      'POST',
      '/sites',
      site({
        name: 'Lager München',
        country: 'DE',
        postcode: '80331',
        city: 'München',
        latitude: 48.137,
        longitude: 11.575,
      }),
    );
    expect(saved.body.site).toMatchObject({ locatedBy: 'by-hand', timeZone: 'Europe/Berlin' });
  });

  it('criterion 7: with the geocoder unreachable, a French site is saved as not located', async () => {
    geocoding = 'unreachable';
    const saved = await call(
      'POST',
      '/sites',
      site({ name: 'Hors ligne', latitude: null, longitude: null, locatedBy: 'not-located' }),
    );
    geocoding = 'answer';
    expect(saved).toMatchObject({
      status: 201,
      body: { site: { locatedBy: 'not-located', latitude: null } },
    });
    const list = await call('GET', '/sites?filter=not-located');
    expect(list.body.sites.map((s: any) => s.name)).toEqual(['Hors ligne']);
  });

  it('criterion 8: a site 30 metres from an active one is saved with a warning naming it', async () => {
    const quaiB = (await call('POST', '/sites', site())).body.site;
    const north = 30 / 111_195;
    const nearby = await call('POST', '/sites/nearby', {
      street1: '16 rue des Frères Lumière',
      postcode: '69800',
      country: 'FR',
      latitude: 45.6906 + north,
      longitude: 4.9488,
    });
    expect(nearby.body).toEqual([
      { id: quaiB.id, name: quaiB.name, distanceMetres: 30, sameStreet: false },
    ]);
    const saved = await call(
      'POST',
      '/sites',
      site({
        name: 'Plateforme Saint-Priest — quai C',
        street1: '16 rue des Frères Lumière',
        latitude: 45.6906 + north,
      }),
    );
    expect(saved).toMatchObject({
      status: 201,
      body: { nearby: [{ name: quaiB.name, distanceMetres: 30 }] },
    });
  });

  it('criterion 9: overlapping hours are refused, a night over two days is saved', async () => {
    const overlap = await call(
      'POST',
      '/sites',
      site({
        name: 'Chevauchement',
        openings: [
          { weekday: 1, startMinute: 360, endMinute: 720 },
          { weekday: 1, startMinute: 660, endMinute: 1080 },
        ],
      }),
    );
    expect(overlap).toMatchObject({ status: 400, body: { issues: [{ code: 'opening-overlap' }] } });
    const night = await call(
      'POST',
      '/sites',
      site({
        name: 'Nuit',
        openings: [
          { weekday: 1, startMinute: 1320, endMinute: 1440 },
          { weekday: 2, startMinute: 0, endMinute: 300 },
        ],
      }),
    );
    expect(night.status).toBe(201);
  });

  it('criterion 10: archiving one of two customers leaves the site active and linked to the other', async () => {
    const shared = (
      await call('POST', '/sites', site({ name: 'Partagé', latitude: 46, longitude: 5 }))
    ).body.site;
    const a = await call(
      'POST',
      '/customers',
      customer({ code: 'A10', siret: null, siteIds: [shared.id] }),
    );
    const b = await call(
      'POST',
      '/customers',
      customer({ code: 'B10', siret: null, siteIds: [shared.id] }),
    );
    await call('POST', `/customers/${a.body.id}/archive`);
    const after = await call('GET', `/sites/${shared.id}`);
    expect(after.body.site).toMatchObject({ archived: false });
    expect((await call('GET', `/customers/${b.body.id}`)).body.sites.map((s: any) => s.id)).toEqual(
      [shared.id],
    );
  });
});

describe('GET /api/geocoding/search', () => {
  it('is not an open proxy: bounded query, France only, five results at most', async () => {
    const before = queries.length;
    for (const query of [
      'q=ab',
      `q=${'x'.repeat(201)}`,
      'q=Berlin&country=DE',
      'q=Lyon&limit=6',
      '',
    ]) {
      expect((await call('GET', `/geocoding/search?${query}`)).status, query).toBe(400);
    }
    expect(queries.length).toBe(before);
    expect((await call('GET', '/geocoding/search?q=%20%20Lyon%20%20&limit=5')).status).toBe(200);
  });
});

describe('imports', () => {
  const header = 'name;street;postcode;city;monday';
  const sites = (count: number, broken?: number) =>
    [
      header,
      ...Array.from({ length: count }, (_, i) => {
        const line = i + 2;
        return `Import ${line};${line} rue de Lyon;${line === broken ? '7814' : '69800'};Saint-Priest;06:00-12:00`;
      }),
    ].join('\n');

  it('criterion 12: "7814" on line 42 stops 300 sites, with the line in the preview', async () => {
    const check = await call('POST', '/imports/sites/check', { csv: sites(300, 42) });
    expect(check.body.rows.filter((r: any) => r.issues.length > 0)).toMatchObject([
      { line: 42, issues: [{ field: 'postcode', code: 'postcode-invalid' }] },
    ]);
    const refused = await call('POST', '/imports/sites', { csv: sites(300, 42), locations: [] });
    expect(refused).toMatchObject({ status: 422, body: { error: 'import-invalid' } });
  });

  it('criterion 13: 300 sites, one matching no address, are 299 located and one not located', async () => {
    const before = (await call('GET', '/sites')).body.counts;
    const check = await call('POST', '/imports/sites/check', { csv: sites(300) });
    expect(check.body.summary).toMatchObject({ valid: 300, address: 299, notLocated: 1 });
    const locations = check.body.rows.map((r: any) => ({
      line: r.line,
      latitude: r.latitude,
      longitude: r.longitude,
      locatedBy: r.locatedBy,
    }));
    const done = await call('POST', '/imports/sites', { csv: sites(300), locations });
    expect(done).toEqual({ status: 201, body: { imported: 300, notLocated: 1 } });
    const after = (await call('GET', '/sites')).body.counts;
    expect(after.all - before.all).toBe(300);
    expect(after['not-located'] - before['not-located']).toBe(1);
  });

  it('treats returned locations as user input: anything invalid becomes not located', async () => {
    const csv = `${header}\nForgé;1 rue Haute;69800;Saint-Priest;\nInventé;2 rue Basse;69800;Saint-Priest;`;
    const done = await call('POST', '/imports/sites', {
      csv,
      locations: [
        { line: 2, latitude: 123, longitude: 4, locatedBy: 'address' },
        { line: 3, latitude: 45, longitude: 4, locatedBy: 'teleported' },
      ],
    });
    expect(done).toEqual({ status: 201, body: { imported: 2, notLocated: 2 } });
  });

  it('imports customers all or nothing, and gives both templates', async () => {
    const refused = await call('POST', '/imports/customers', {
      csv: 'code;name\nNEW-1;Nouveau\nC1;Doublon',
    });
    expect(refused).toMatchObject({ status: 422 });
    expect(
      (await call('POST', '/imports/customers', { csv: 'code;name\nNEW-1;Nouveau' })).body,
    ).toEqual({ imported: 1 });
    expect((await call('GET', '/imports/sites/template?lang=fr')).body).toMatch(/^nom;adresse;/);
    expect((await call('GET', '/imports/customers/template')).body).toMatch(
      /^code;name;country;siret;/,
    );
  });
});

describe('driver protective equipment', () => {
  it('criterion 14: the driver keeps the equipment ticked, in its form and in the list', async () => {
    const shoes = '60000000-0000-4000-8000-000000000001';
    const vest = '60000000-0000-4000-8000-000000000002';
    const created = await call('POST', '/resources', {
      kind: 'driver',
      lastName: 'Moreau',
      firstName: 'Samuel',
      protectiveEquipmentIds: [shoes, vest],
    });
    expect(created.body.protectiveEquipmentIds).toEqual([shoes, vest]);
    const list = await call('GET', '/resources?kind=driver&q=Moreau');
    expect(list.body.resources[0].protectiveEquipmentIds).toEqual([shoes, vest]);
    const lists = await call('GET', '/reference-lists');
    expect(lists.body.protectiveEquipment).toHaveLength(5);
  });
});
