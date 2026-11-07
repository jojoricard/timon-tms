import { type Driver, Temporal, type Vehicle } from '@timon/domain';
import { describe, expect, it } from 'vitest';
import {
  addDocument,
  changeUnit,
  createUnit,
  type Ports,
  setArchived,
  type UnitInput,
  type UnitView,
  unitOptions,
  unitsAt,
  updateResource,
} from '../src/index.ts';
import { createResource } from '../src/resources.ts';
import { memoryPorts } from './memory.ts';

// SPEC-003 use cases on ports kept in memory; the same criteria run through the API on PGlite
// and PostgreSQL in apps/api/test/units.test.ts.

const instant = (iso: string) => Temporal.Instant.from(iso);
const date = (iso: string) => Temporal.PlainDate.from(iso);

const driver = (firstName: string, lastName: string): Driver => ({
  kind: 'driver',
  lastName,
  firstName,
  displayName: '',
  employeeNumber: null,
  phone: null,
  protectiveEquipmentIds: [],
});

const vehicle = (
  plate: string,
  vehicleKind: Vehicle['vehicleKind'],
  category: Vehicle['category'],
  gvwKg: number,
): Vehicle => ({
  kind:
    vehicleKind === 'semi-trailer' || vehicleKind === 'drawbar-trailer' ? 'trailer' : 'power-unit',
  plate,
  vehicleKind,
  category,
  gvwKg,
  gcwKg: null,
  makeModel: null,
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
});

async function resource(
  ports: Ports,
  details: Driver | Vehicle,
  documents: [string, string][] = [],
) {
  const result = await createResource(ports, details);
  if (!result.ok) throw new Error(result.reason);
  for (const [code, expiresOn] of documents) {
    await addDocument(ports, result.resource.id, {
      documentTypeId: `type-${code}`,
      reference: null,
      issuedOn: null,
      expiresOn: date(expiresOn),
    });
  }
  return result.resource;
}

/** Marc Laurent with CD-456-EF and SR-4471, every document valid in October 2026. */
async function fleet(now = '2026-10-27T08:40:00Z') {
  const { ports } = memoryPorts(now);
  const laurent = await resource(ports, driver('Marc', 'Laurent'), [
    ['licence-c', '2031-03-15'],
    ['licence-ce', '2031-03-15'],
    ['cpc', '2029-05-15'],
    ['driver-card', '2029-05-15'],
  ]);
  const tractor = await resource(ports, vehicle('CD-456-EF', 'tractor', 'N3', 19_000), [
    ['roadworthiness', '2027-04-14'],
    ['tachograph', '2027-02-15'],
  ]);
  const trailer = await resource(ports, vehicle('SR-4471', 'semi-trailer', 'O4', 35_000), [
    ['roadworthiness', '2027-03-30'],
  ]);
  return { ports, laurent, tractor, trailer };
}

const input = (members: Partial<UnitInput>): UnitInput => ({
  name: null,
  powerUnitId: null,
  trailerId: null,
  driverId: null,
  start: instant('2026-10-06T04:00:00Z'),
  end: null,
  ...members,
});

async function unit(ports: Ports, members: Partial<UnitInput>): Promise<UnitView> {
  const result = await createUnit(ports, input(members));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.unit;
}

describe('the documents of a unit', () => {
  it('criterion 9: an expired CPC is reported by name, and the unit is saved', async () => {
    const { ports, tractor, trailer } = await fleet();
    const girard = await resource(ports, driver('Thomas', 'Girard'), [
      ['licence-ce', '2030-02-15'],
      ['cpc', '2026-10-20'],
      ['driver-card', '2027-03-15'],
    ]);
    const saved = await unit(ports, {
      powerUnitId: tractor.id,
      trailerId: trailer.id,
      driverId: girard.id,
    });
    expect(saved.documents.status).toBe('expired');
    expect(saved.documents.worst).toMatchObject({ code: 'cpc', member: 'T. Girard' });
  });

  it('reports a required document never recorded as missing', async () => {
    const { ports, tractor, trailer } = await fleet();
    const perrin = await resource(ports, driver('Hugo', 'Perrin'), [['licence-ce', '2030-06-15']]);
    const saved = await unit(ports, {
      powerUnitId: tractor.id,
      trailerId: trailer.id,
      driverId: perrin.id,
    });
    expect(saved.documents.status).toBe('missing');
    expect(saved.documents.worst?.code).toBe('cpc');
  });

  it('judges a future unit on its start date, and shows the next expiry in its period', async () => {
    const { ports, laurent, tractor, trailer } = await fleet('2026-10-01T08:00:00Z');
    const saved = await unit(ports, {
      powerUnitId: tractor.id,
      trailerId: trailer.id,
      driverId: laurent.id,
      start: instant('2027-04-20T04:00:00Z'),
      end: instant('2027-05-20T04:00:00Z'),
    });
    expect(saved.state).toBe('future');
    expect(saved.documents.day.toString()).toBe('2027-04-20');
    expect(saved.documents.worst).toMatchObject({ code: 'tachograph', status: 'expired' });
    expect(saved.documents.nextExpiry).toBeNull();
  });
});

describe('archiving and changing a member', () => {
  async function running() {
    const fixture = await fleet();
    const saved = await unit(fixture.ports, {
      powerUnitId: fixture.tractor.id,
      trailerId: fixture.trailer.id,
      driverId: fixture.laurent.id,
    });
    return { ...fixture, saved };
  }

  it('criterion 11: a trailer in a running unit cannot be archived; the unit is named', async () => {
    const { ports, trailer, saved } = await running();
    const result = await setArchived(ports, trailer.id, 1, true);
    expect(result).toMatchObject({
      ok: false,
      reason: 'in-unit',
      unit: { id: saved.id, name: 'M. Laurent', end: null },
    });
  });

  it('keeps the kind of a vehicle in a running unit', async () => {
    const { ports, tractor } = await running();
    const result = await updateResource(
      ports,
      tractor.id,
      1,
      vehicle('CD-456-EF', 'rigid-truck', 'N3', 19_000),
    );
    expect(result).toMatchObject({ ok: false, reason: 'in-unit' });
  });

  it('archives a resource whose units have all ended', async () => {
    const { ports, tractor, trailer } = await fleet();
    await unit(ports, {
      powerUnitId: tractor.id,
      trailerId: trailer.id,
      start: instant('2026-10-01T04:00:00Z'),
      end: instant('2026-10-02T04:00:00Z'),
    });
    expect((await setArchived(ports, trailer.id, 1, true)).ok).toBe(true);
  });

  it('criterion 8: a change of driver ends the unit and starts another', async () => {
    const { ports, tractor, trailer, saved } = await running();
    const perrin = await resource(ports, driver('Hugo', 'Perrin'), [['licence-ce', '2030-06-15']]);
    const result = await changeUnit(ports, saved.id, saved.version, {
      role: 'driver',
      resourceId: perrin.id,
      from: instant('2026-10-26T05:00:00Z'),
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.ended.end?.toString()).toBe('2026-10-26T05:00:00Z');
    expect(result.unit).toMatchObject({ name: 'H. Perrin', changed: 'driver', end: null });
    expect(result.unit.powerUnit.id).toBe(tractor.id);
    expect(result.unit.trailer?.id).toBe(trailer.id);

    const before = await unitsAt(ports, instant('2026-10-25T16:00:00Z'));
    expect(before.units.map((u) => u.driver?.name)).toEqual(['M. Laurent']);
    const after = await unitsAt(ports, instant('2026-10-26T07:00:00Z'));
    expect(after.units.map((u) => u.driver?.name)).toEqual(['H. Perrin']);
    expect(after.free.driver.map((d) => d.name)).toEqual(['M. Laurent']);
  });

  it('refuses a change outside the running period, or to the same driver', async () => {
    const { ports, laurent, saved } = await running();
    const change = (from: string, resourceId = laurent.id) =>
      changeUnit(ports, saved.id, saved.version, {
        role: 'driver',
        resourceId,
        from: instant(from),
      });
    expect(await change('2026-10-06T04:00:00Z')).toMatchObject({
      reason: 'invalid',
      issues: expect.arrayContaining([{ field: 'from', code: 'outside-unit' }]),
    });
    expect(await change('2026-10-26T05:00:00Z')).toMatchObject({
      reason: 'invalid',
      issues: [{ field: 'driverId', code: 'unchanged' }],
    });
  });
});

describe('the options of the unit form', () => {
  it('explains why a resource cannot be chosen', async () => {
    const { ports, laurent, tractor, trailer } = await fleet();
    await resource(ports, driver('Élodie', 'Marchand'), [['licence-c1', '2029-07-15']]);
    const rigid = await resource(ports, vehicle('UV-234-WX', 'rigid-truck', 'N3', 19_000));
    await unit(ports, { powerUnitId: rigid.id, driverId: laurent.id });

    const options = await unitOptions(ports, {
      powerUnitId: tractor.id,
      trailerId: trailer.id,
      driverId: null,
      start: instant('2026-10-28T05:00:00Z'),
      end: null,
    });
    expect(options.licence).toBe('CE');
    const reason = (role: 'driver' | 'power-unit', name: string) =>
      options.candidates[role].find((c) => c.resource.name === name)?.reason;
    expect(reason('driver', 'É. Marchand')).toMatchObject({
      code: 'licence-missing',
      params: { needs: 'CE', holds: 'C1', driver: 'Élodie Marchand' },
    });
    expect(reason('driver', 'M. Laurent')).toMatchObject({
      code: 'busy',
      params: { unit: 'M. Laurent', end: '' },
    });
    expect(reason('power-unit', 'CD-456-EF')).toBeNull();
    expect(reason('power-unit', 'UV-234-WX')).toMatchObject({ code: 'busy' });

    const forRigid = await unitOptions(ports, {
      powerUnitId: rigid.id,
      trailerId: null,
      driverId: null,
      start: instant('2026-10-28T05:00:00Z'),
      end: null,
    });
    expect(forRigid.candidates.trailer[0]?.reason).toMatchObject({
      code: 'semi-trailer-needs-tractor',
    });
  });
});
