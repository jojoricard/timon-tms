import { type Driver, Temporal, type Vehicle } from '@timon/domain';
import { describe, expect, it } from 'vitest';
import {
  addDocument,
  createResource,
  listExpiries,
  listResources,
  type ResourceView,
  setArchived,
  updateDocument,
  updateResource,
} from '../src/index.ts';
import { memoryPorts } from './memory.ts';

const date = (iso: string) => Temporal.PlainDate.from(iso);

const driver = (lastName: string, firstName = 'Test'): Driver => ({
  kind: 'driver',
  lastName,
  firstName,
  displayName: '',
  employeeNumber: null,
  phone: null,
});

const tractor = (plate: string): Vehicle => ({
  kind: 'power-unit',
  plate,
  vehicleKind: 'tractor',
  category: 'N3',
  gvwKg: 19_000,
  gcwKg: 44_000,
  makeModel: null,
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
});

const trailer = (plate: string): Vehicle => ({
  ...tractor(plate),
  kind: 'trailer',
  vehicleKind: 'semi-trailer',
  category: 'O4',
  gvwKg: 35_000,
  gcwKg: null,
});

async function created(result: Promise<{ ok: boolean }>) {
  const value = (await result) as { ok: true; resource: ResourceView };
  expect(value.ok).toBe(true);
  return value.resource;
}

describe('createResource', () => {
  it('fills the display name of a driver', async () => {
    const { ports } = memoryPorts();
    const resource = await created(createResource(ports, driver('Benali', 'Karim')));
    expect(resource).toMatchObject({ displayName: 'K. Benali' });
  });

  it('criterion 5: refuses a plate already active, written differently, and names its owner', async () => {
    const { ports } = memoryPorts();
    const first = await created(createResource(ports, tractor('AB-123-CD')));
    expect(await createResource(ports, tractor('ab 123 cd'))).toEqual({
      ok: false,
      reason: 'plate-taken',
      owner: { id: first.id, name: 'AB-123-CD', kind: 'power-unit', vehicleKind: 'tractor' },
    });
  });

  it('criterion 6: refuses a light van in N3', async () => {
    const { ports } = memoryPorts();
    const van = { ...tractor('FG-204-HJ'), vehicleKind: 'light-van', gvwKg: 3_500, gcwKg: null };
    expect(await createResource(ports, van as Vehicle)).toMatchObject({
      ok: false,
      reason: 'invalid',
      issues: [{ field: 'category', code: 'category-not-allowed', params: { allowed: 'N1' } }],
    });
  });

  it('refuses an entry that is not in the company lists', async () => {
    const { ports } = memoryPorts();
    const result = await createResource(ports, { ...trailer('SR-4471'), bodyTypeId: 'nope' });
    expect(result).toMatchObject({ reason: 'invalid', issues: [{ field: 'bodyTypeId' }] });
  });

  it('lets a resource keep its own plate when edited', async () => {
    const { ports } = memoryPorts();
    const resource = await created(createResource(ports, tractor('CD-456-EF')));
    const result = await updateResource(ports, resource.id, {
      ...tractor('cd 456 ef'),
      makeModel: 'Renault T 480',
    });
    expect(result).toMatchObject({ ok: true, resource: { makeModel: 'Renault T 480' } });
  });
});

describe('archiving', () => {
  it('criterion 11: hides an archived driver unless asked, and restores it', async () => {
    const { ports } = memoryPorts();
    const girard = await created(createResource(ports, driver('Girard', 'Thomas')));
    await setArchived(ports, girard.id, true);
    const names = async (includeArchived: boolean) =>
      (await listResources(ports, { kind: 'driver', includeArchived })).resources.map((r) => r.id);
    expect(await names(false)).toEqual([]);
    expect(await names(true)).toEqual([girard.id]);
    expect(await setArchived(ports, girard.id, false)).toMatchObject({
      ok: true,
      resource: { archived: false },
    });
    expect(await names(false)).toEqual([girard.id]);
  });

  it('frees the plate of an archived vehicle, and refuses to restore it once reused', async () => {
    const { ports } = memoryPorts();
    const old = await created(createResource(ports, trailer('SR-4480')));
    await setArchived(ports, old.id, true);
    await created(createResource(ports, trailer('SR 4480')));
    expect(await setArchived(ports, old.id, false)).toMatchObject({
      ok: false,
      reason: 'plate-taken',
    });
  });
});

describe('documents', () => {
  it('holds one document per type; a renewal changes its dates', async () => {
    const { ports } = memoryPorts();
    const fabre = await created(createResource(ports, driver('Fabre', 'Lucie')));
    const cpc = {
      documentTypeId: 'type-cpc',
      reference: null,
      issuedOn: null,
      expiresOn: date('2026-12-12'),
    };
    const added = await created(addDocument(ports, fabre.id, cpc));
    expect(await addDocument(ports, fabre.id, cpc)).toEqual({
      ok: false,
      reason: 'document-type-taken',
    });
    const [document] = added.documents;
    const renewed = await created(
      updateDocument(ports, document?.id ?? '', { ...cpc, expiresOn: date('2031-12-12') }),
    );
    expect(renewed.documents.map((d) => d.status)).toEqual(['valid']);
  });

  it('refuses a document type that does not apply to the resource', async () => {
    const { ports } = memoryPorts();
    const fabre = await created(createResource(ports, driver('Fabre')));
    const result = await addDocument(ports, fabre.id, {
      documentTypeId: 'type-roadworthiness',
      reference: null,
      issuedOn: null,
      expiresOn: date('2027-01-01'),
    });
    expect(result).toMatchObject({ reason: 'invalid', issues: [{ field: 'documentTypeId' }] });
  });
});

describe('status in lists', () => {
  it('criteria 1 and 4: the resource takes the worst status, a lapsed health check only warns', async () => {
    const { ports } = memoryPorts('2026-10-25T08:00:00Z');
    const benali = await created(createResource(ports, driver('Benali', 'Karim')));
    const licence = {
      documentTypeId: 'type-licence-ce',
      reference: null,
      issuedOn: null,
      expiresOn: date('2026-11-20'),
    };
    await addDocument(ports, benali.id, licence);
    let [listed] = (await listResources(ports, { kind: 'driver' })).resources;
    expect(listed).toMatchObject({ severity: 'expiring', nextExpiry: { status: 'expiring' } });

    await addDocument(ports, benali.id, {
      ...licence,
      documentTypeId: 'type-health-check',
      expiresOn: date('2026-10-24'),
    });
    [listed] = (await listResources(ports, { kind: 'driver' })).resources;
    expect(listed).toMatchObject({
      severity: 'expired-not-blocking',
      nextExpiry: { status: 'expired', blocking: false },
    });
    const { counts } = await listResources(ports, { kind: 'driver', status: 'expired' });
    expect(counts).toEqual({ all: 1, expiring: 0, expired: 1 });
  });

  it('finds a driver by name without accents or case', async () => {
    const { ports } = memoryPorts();
    await created(createResource(ports, driver('Marchand', 'Élodie')));
    await created(createResource(ports, driver('Roux', 'Julien')));
    const { resources } = await listResources(ports, { kind: 'driver', query: 'elodie' });
    expect(resources.map((r) => r.kind === 'driver' && r.lastName)).toEqual(['Marchand']);
  });
});

describe('listExpiries', () => {
  it('criterion 8: expired first, then by date; a test in 45 days is not listed', async () => {
    const { ports } = memoryPorts('2026-10-06T10:00:00Z');
    const today = date('2026-10-06');
    for (const [plate, days] of [
      ['SR-1', 45],
      ['SR-2', 20],
      ['SR-3', -3],
      ['SR-4', 5],
    ] as const) {
      const resource = await created(createResource(ports, trailer(plate)));
      await addDocument(ports, resource.id, {
        documentTypeId: 'type-roadworthiness',
        reference: null,
        issuedOn: null,
        expiresOn: today.add({ days }),
      });
    }
    const { expiries, summary } = await listExpiries(ports);
    expect(expiries.map((e) => [e.resource.name, e.status, e.daysUntil])).toEqual([
      ['SR-3', 'expired', -3],
      ['SR-4', 'expiring', 5],
      ['SR-2', 'expiring', 20],
    ]);
    expect(summary).toEqual({
      expiredBlocking: 1,
      expiredNotBlocking: 0,
      withinThirtyDays: 2,
      longerLeadTime: 0,
    });
  });

  it('criterion 12: an FCO in 75 days is listed, because the CPC warns 90 days ahead', async () => {
    const { ports } = memoryPorts('2026-10-06T10:00:00Z');
    const fabre = await created(createResource(ports, driver('Fabre', 'Lucie')));
    await addDocument(ports, fabre.id, {
      documentTypeId: 'type-cpc',
      reference: null,
      issuedOn: null,
      expiresOn: date('2026-10-06').add({ days: 75 }),
    });
    const { expiries, summary } = await listExpiries(ports);
    expect(expiries.map((e) => [e.type.code, e.status, e.daysUntil])).toEqual([
      ['cpc', 'expiring', 75],
    ]);
    expect(summary.longerLeadTime).toBe(1);
  });

  it('leaves out archived resources and filters by kind and blocking', async () => {
    const { ports } = memoryPorts('2026-10-06T10:00:00Z');
    const benali = await created(createResource(ports, driver('Benali')));
    await addDocument(ports, benali.id, {
      documentTypeId: 'type-health-check',
      reference: null,
      issuedOn: null,
      expiresOn: date('2026-10-02'),
    });
    expect((await listExpiries(ports)).expiries).toHaveLength(1);
    expect((await listExpiries(ports, { blockingOnly: true })).expiries).toHaveLength(0);
    expect((await listExpiries(ports, { kind: 'trailer' })).expiries).toHaveLength(0);
    await setArchived(ports, benali.id, true);
    expect((await listExpiries(ports)).expiries).toHaveLength(0);
  });
});
