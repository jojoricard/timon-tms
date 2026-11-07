import { type Driver, type SiteDetails, Temporal, type Vehicle } from '@timon/domain';
import { describe, expect, it } from 'vitest';
import {
  addDocument,
  type CustomerInput,
  changeUnit,
  createCustomer,
  createSite,
  createUnit,
  deleteUnit,
  endUnit,
  getResource,
  removeDocument,
  setArchived,
  setCustomerArchived,
  setSiteArchived,
  updateCustomer,
  updateDocument,
  updateResource,
  updateSite,
  updateUnit,
} from '../src/index.ts';
import { createResource } from '../src/resources.ts';
import { memoryPorts } from './memory.ts';

// ADR-005: a write from a version that is no longer current is refused with the current
// version, before any other rule, and leaves the record as the other write left it.

const instant = (iso: string) => Temporal.Instant.from(iso);

const driver = (changes: Partial<Driver> = {}): Driver => ({
  kind: 'driver',
  lastName: 'Garnier',
  firstName: 'Paul',
  displayName: null,
  employeeNumber: null,
  phone: null,
  protectiveEquipmentIds: [],
  ...changes,
});

const vehicle = (plate: string, vehicleKind: 'tractor' | 'semi-trailer'): Vehicle => ({
  kind: vehicleKind === 'tractor' ? 'power-unit' : 'trailer',
  plate,
  vehicleKind,
  category: vehicleKind === 'tractor' ? 'N3' : 'O4',
  gvwKg: vehicleKind === 'tractor' ? 19_000 : 35_000,
  gcwKg: null,
  makeModel: null,
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
});

async function ok<T extends { ok: boolean }>(result: Promise<T>) {
  const value = await result;
  expect(value.ok, JSON.stringify(value)).toBe(true);
  return value as Extract<T, { ok: true }>;
}

const stale = (version: number) => ({ ok: false, reason: 'stale', version });

describe('resources', () => {
  it('T-006: the second save from version 1 is refused and the phone number stays', async () => {
    const { ports } = memoryPorts();
    const { resource } = await ok(createResource(ports, driver()));
    expect(resource.version).toBe(1);
    const first = await ok(updateResource(ports, resource.id, 1, driver({ phone: '0612345678' })));
    expect(first.resource.version).toBe(2);
    expect(
      await updateResource(ports, resource.id, 1, driver({ employeeNumber: 'GP-118' })),
    ).toEqual(stale(2));
    expect(await getResource(ports, resource.id)).toMatchObject({
      version: 2,
      phone: '0612345678',
      employeeNumber: null,
    });
  });

  it('answers stale before checking the fields', async () => {
    const { ports } = memoryPorts();
    const { resource } = await ok(createResource(ports, driver()));
    await ok(updateResource(ports, resource.id, 1, driver({ phone: '0612345678' })));
    expect(await updateResource(ports, resource.id, 1, driver({ lastName: '' }))).toEqual(stale(2));
  });

  it('archives and restores under the version', async () => {
    const { ports } = memoryPorts();
    const { resource } = await ok(createResource(ports, driver()));
    expect((await ok(setArchived(ports, resource.id, 1, true))).resource.version).toBe(2);
    expect(await setArchived(ports, resource.id, 1, false)).toEqual(stale(2));
    expect(await setArchived(ports, 'unknown', 1, false)).toMatchObject({ reason: 'not-found' });
  });
});

describe('documents', () => {
  const cpc = (expiresOn: string) => ({
    documentTypeId: 'type-cpc',
    reference: null,
    issuedOn: null,
    expiresOn: Temporal.PlainDate.from(expiresOn),
  });

  it('a document is changed and removed under its own version', async () => {
    const { ports } = memoryPorts();
    const { resource } = await ok(createResource(ports, driver()));
    const added = await ok(addDocument(ports, resource.id, cpc('2027-05-15')));
    expect(added.resource.version).toBe(1);
    const document = added.resource.documents[0];
    expect(document?.version).toBe(1);
    const id = document?.id ?? '';
    await ok(updateDocument(ports, id, 1, cpc('2031-05-15')));
    expect(await updateDocument(ports, id, 1, cpc('2028-05-15'))).toEqual(stale(2));
    expect(await removeDocument(ports, id, 1)).toEqual(stale(2));
    const kept = await getResource(ports, resource.id);
    expect(kept?.documents[0]?.expiresOn.toString()).toBe('2031-05-15');
    expect(kept?.version).toBe(1);
    await ok(removeDocument(ports, id, 2));
  });
});

const customer = (changes: Partial<CustomerInput> = {}): CustomerInput => ({
  name: 'Dupont Matériaux SAS',
  code: 'DUPONT-MAT',
  country: 'FR',
  siret: null,
  vatNumber: null,
  billingStreet1: null,
  billingStreet2: null,
  billingPostcode: null,
  billingCity: null,
  notes: null,
  contacts: [{ name: 'Sandrine Dupont', role: null, phone: '04 78 70 21 45', email: null }],
  siteIds: [],
  ...changes,
});

describe('customers', () => {
  it('contacts are saved under the customer version', async () => {
    const { ports } = memoryPorts();
    const { customer: saved } = await ok(createCustomer(ports, customer()));
    expect(saved.version).toBe(1);
    await ok(updateCustomer(ports, saved.id, 1, customer({ name: 'Dupont SA' })));
    expect(await updateCustomer(ports, saved.id, 1, customer({ contacts: [] }))).toEqual(stale(2));
    expect(await setCustomerArchived(ports, saved.id, 1, true)).toEqual(stale(2));
    expect((await ok(setCustomerArchived(ports, saved.id, 2, true))).customer.version).toBe(3);
  });
});

const site = (changes: Partial<SiteDetails> = {}): SiteDetails => ({
  name: 'Saint-Priest platform',
  street1: '14 rue des Frères Lumière',
  street2: null,
  postcode: '69800',
  city: 'Saint-Priest',
  country: 'FR',
  location: { latitude: 45.7124, longitude: 4.95815 },
  locatedBy: 'by-hand',
  openings: [],
  bookingRequired: false,
  bookingMethod: null,
  bookingDetail: null,
  protectiveEquipmentIds: [],
  maxLengthCm: null,
  maxWeightKg: null,
  loadingDock: true,
  semiTrailersAccepted: true,
  gatePhone: null,
  instructions: null,
  ...changes,
});

describe('sites', () => {
  it('is saved, archived and restored under its version', async () => {
    const { ports } = memoryPorts();
    const { site: saved } = await ok(createSite(ports, site()));
    expect(saved.version).toBe(1);
    await ok(updateSite(ports, saved.id, 1, site({ gatePhone: '0472231890' })));
    expect(await updateSite(ports, saved.id, 1, site({ name: '' }))).toEqual(stale(2));
    expect(await setSiteArchived(ports, saved.id, 1, true)).toEqual(stale(2));
    expect((await ok(setSiteArchived(ports, saved.id, 2, true))).site.version).toBe(3);
  });
});

describe('units', () => {
  async function fleet() {
    const { ports } = memoryPorts('2026-10-27T08:00:00Z');
    const create = async (details: Driver | Vehicle) =>
      (await ok(createResource(ports, details))).resource.id;
    return {
      ports,
      tractor: await create(vehicle('CD-456-EF', 'tractor')),
      trailer: await create(vehicle('SR-4471', 'semi-trailer')),
      other: await create(vehicle('SR-4472', 'semi-trailer')),
    };
  }
  const input = (powerUnitId: string, trailerId: string, start: string, end: string | null) => ({
    name: null,
    powerUnitId,
    trailerId,
    driverId: null,
    start: instant(start),
    end: end ? instant(end) : null,
  });

  it('a unit not started yet is edited and deleted under its version', async () => {
    const { ports, tractor, trailer } = await fleet();
    const planned = input(tractor, trailer, '2026-10-28T04:00:00Z', null);
    const { unit } = await ok(createUnit(ports, planned));
    expect(unit.version).toBe(1);
    await ok(updateUnit(ports, unit.id, 1, { ...planned, name: 'Unit 5' }));
    expect(await updateUnit(ports, unit.id, 1, planned)).toEqual(stale(2));
    expect(await deleteUnit(ports, unit.id, 1)).toEqual(stale(2));
    expect(await endUnit(ports, unit.id, 1, instant('2026-10-29T04:00:00Z'))).toEqual(stale(2));
    await ok(deleteUnit(ports, unit.id, 2));
  });

  it('a change of trailer starts from the version of the running unit', async () => {
    const { ports, tractor, trailer, other } = await fleet();
    const { unit } = await ok(
      createUnit(ports, input(tractor, trailer, '2026-10-27T04:00:00Z', null)),
    );
    const change = {
      role: 'trailer' as const,
      resourceId: other,
      from: instant('2026-10-27T12:00:00Z'),
    };
    await ok(endUnit(ports, unit.id, 1, instant('2026-10-28T04:00:00Z')));
    expect(await changeUnit(ports, unit.id, 1, change)).toEqual(stale(2));
    const changed = await ok(changeUnit(ports, unit.id, 2, change));
    expect([changed.ended.version, changed.unit.version]).toEqual([3, 1]);
  });
});
