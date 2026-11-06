import { describe, expect, it } from 'vitest';
import {
  checkComposition,
  checkUnitPeriod,
  contains,
  holdsCategory,
  type LicenceCategory,
  licenceOfDocument,
  licenceShown,
  openPeriodOf,
  overlapsOpen,
  requiredDocuments,
  requiredLicence,
  Temporal,
  type UnitComposition,
  type UnitResource,
  unitName,
  type VehicleKind,
} from '../src/index.ts';

const vehicle = (vehicleKind: VehicleKind, gvwKg: number, id = vehicleKind): UnitResource => ({
  id,
  subsidiaryId: 'south',
  archived: false,
  kind:
    vehicleKind === 'semi-trailer' || vehicleKind === 'drawbar-trailer' ? 'trailer' : 'power-unit',
  plate: id.toUpperCase(),
  vehicleKind,
  category: 'N3',
  gvwKg,
  gcwKg: null,
  makeModel: null,
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
});

const driver = (firstName: string, lastName: string): UnitResource => ({
  id: lastName,
  subsidiaryId: 'south',
  archived: false,
  kind: 'driver',
  firstName,
  lastName,
  displayName: null,
  employeeNumber: null,
  phone: null,
  protectiveEquipmentIds: [],
});

const tractor = vehicle('tractor', 19_000);
const rigid = (kg: number) => vehicle('rigid-truck', kg);
const semi = vehicle('semi-trailer', 35_000);
const drawbar = (kg: number) => vehicle('drawbar-trailer', kg);
const van = vehicle('light-van', 3_500);
const asVehicle = (r: UnitResource) => {
  if (r.kind === 'driver') throw new Error('not a vehicle');
  return r;
};
const needs = (powerUnit: UnitResource, trailer?: UnitResource) =>
  requiredLicence(asVehicle(powerUnit), trailer ? asVehicle(trailer) : null);

describe('the licence a unit needs', () => {
  it('follows the gross vehicle weight of the power unit alone', () => {
    expect(needs(rigid(3_500))).toBe('B');
    expect(needs(rigid(3_501))).toBe('C1');
    expect(needs(rigid(7_500))).toBe('C1');
    expect(needs(rigid(7_501))).toBe('C');
    expect(needs(van)).toBe('B');
    expect(needs(tractor)).toBe('C');
  });

  it('ignores a trailer up to 750 kg', () => {
    expect(needs(rigid(7_490), drawbar(750))).toBe('C1');
    expect(needs(rigid(19_000), drawbar(750))).toBe('C');
    expect(needs(rigid(3_500), drawbar(750))).toBe('B');
  });

  it('needs C1E for a C1 vehicle with a trailer over 750 kg, up to 12,000 kg together', () => {
    expect(needs(rigid(7_490), drawbar(751))).toBe('C1E');
    expect(needs(rigid(7_490), drawbar(3_500))).toBe('C1E');
    expect(needs(rigid(7_500), drawbar(4_500))).toBe('C1E');
    expect(needs(rigid(7_500), drawbar(4_501))).toBe('CE');
  });

  it('needs CE for a heavier vehicle with a trailer over 750 kg', () => {
    expect(needs(rigid(7_501), drawbar(751))).toBe('CE');
    expect(needs(rigid(19_000), drawbar(10_000))).toBe('CE');
  });

  it('needs CE for any tractor with a semi-trailer, whatever the weights', () => {
    expect(needs(tractor, semi)).toBe('CE');
    expect(needs(vehicle('tractor', 7_000), vehicle('semi-trailer', 700))).toBe('CE');
  });

  it('does not handle BE: a light power unit with a trailer over 750 kg', () => {
    expect(needs(rigid(3_500), drawbar(751))).toBe('unsupported');
  });
});

describe('the categories a driver holds', () => {
  const cases: [LicenceCategory[], LicenceCategory, boolean][] = [
    [['C'], 'C1', true],
    [['C'], 'C', true],
    [['C'], 'C1E', false],
    [['C'], 'CE', false],
    [['CE'], 'C1E', true],
    [['CE'], 'C', true],
    [['CE'], 'C1', true],
    [['C1E'], 'C1', true],
    [['C1E'], 'C', false],
    [['C1E'], 'CE', false],
    [['C1'], 'C', false],
    [['C1'], 'C1E', false],
    [['C1'], 'B', true],
    [['C'], 'B', true],
    [['B'], 'C1', false],
    [[], 'B', false],
  ];
  it.each(cases)('%j covers %s: %s', (held, needed, covered) => {
    expect(holdsCategory(held, needed)).toBe(covered);
  });

  it('shows the needed category, or the lowest one held that covers it', () => {
    expect(licenceShown(['C', 'CE'], 'CE')).toBe('CE');
    expect(licenceShown(['CE', 'C'], 'C1')).toBe('C');
    expect(licenceShown(['C1'], 'B')).toBe('C1');
    expect(licenceShown(['C1'], 'C')).toBeNull();
  });

  it('reads the category of a licence document type', () => {
    expect(licenceOfDocument('licence-c1e')).toBe('C1E');
    expect(licenceOfDocument('cpc')).toBeNull();
    expect(licenceOfDocument(null)).toBeNull();
  });
});

const unit = (
  members: Partial<Omit<UnitComposition, 'driverLicences'>>,
  driverLicences: LicenceCategory[] = [],
): UnitComposition => ({
  powerUnit: null,
  trailer: null,
  driver: null,
  driverLicences,
  ...members,
});
const codes = (composition: UnitComposition) => checkComposition(composition).map((i) => i.code);
const laurent = driver('Marc', 'Laurent');
const marchand = driver('Élodie', 'Marchand');

describe('the composition of a unit', () => {
  it('accepts the units of the scoping note', () => {
    expect(
      codes(unit({ powerUnit: tractor, trailer: semi, driver: laurent }, ['C', 'CE'])),
    ).toEqual([]);
    expect(codes(unit({ powerUnit: tractor, trailer: semi }))).toEqual([]);
    expect(codes(unit({ powerUnit: rigid(19_000), trailer: drawbar(10_000) }))).toEqual([]);
    expect(codes(unit({ powerUnit: van, driver: marchand }, ['C1']))).toEqual([]);
  });

  it('needs a power unit and a driver or a trailer (criterion 5)', () => {
    expect(codes(unit({ powerUnit: tractor }))).toEqual(['driver-or-trailer-required']);
    expect(codes(unit({ driver: laurent }, ['CE']))).toEqual(['required']);
  });

  it('puts a semi-trailer behind a tractor only, a drawbar trailer behind a rigid truck only', () => {
    expect(codes(unit({ powerUnit: rigid(19_000), trailer: semi }))).toEqual([
      'semi-trailer-needs-tractor',
    ]);
    expect(codes(unit({ powerUnit: tractor, trailer: drawbar(10_000) }))).toEqual([
      'drawbar-trailer-needs-rigid-truck',
    ]);
    expect(codes(unit({ powerUnit: van, trailer: drawbar(500) }))).toEqual([
      'light-van-no-trailer',
    ]);
  });

  it('refuses a resource of the wrong kind in a place', () => {
    expect(checkComposition(unit({ powerUnit: semi, driver: laurent }))).toEqual([
      { field: 'powerUnitId', code: 'kind-not-allowed' },
    ]);
  });

  it('needs active members of one subsidiary', () => {
    expect(codes(unit({ powerUnit: { ...tractor, archived: true }, trailer: semi }))).toEqual([
      'resource-archived',
    ]);
    expect(
      codes(unit({ powerUnit: tractor, trailer: { ...semi, subsidiaryId: 'north' } })),
    ).toEqual(['subsidiary-mismatch']);
  });

  it('names the category needed and those held (criterion 2)', () => {
    expect(
      checkComposition(unit({ powerUnit: tractor, trailer: semi, driver: marchand }, ['C1'])),
    ).toEqual([
      {
        field: 'driverId',
        code: 'licence-missing',
        params: { needs: 'CE', holds: 'C1', driver: 'Élodie Marchand' },
      },
    ]);
  });

  it('accepts C1 on a rigid truck of 7,490 kg, refuses it with a 3,500 kg trailer (criterion 3)', () => {
    expect(codes(unit({ powerUnit: rigid(7_490), driver: marchand }, ['C1']))).toEqual([]);
    expect(
      checkComposition(
        unit({ powerUnit: rigid(7_490), trailer: drawbar(3_500), driver: marchand }, ['C1']),
      ),
    ).toEqual([
      {
        field: 'driverId',
        code: 'licence-missing',
        params: { needs: 'C1E', holds: 'C1', driver: 'Élodie Marchand' },
      },
    ]);
  });

  it('refuses BE, with or without a driver', () => {
    expect(codes(unit({ powerUnit: rigid(3_500), trailer: drawbar(2_000) }))).toEqual([
      'licence-not-supported',
    ]);
    expect(
      codes(unit({ powerUnit: rigid(3_500), trailer: drawbar(2_000), driver: laurent }, ['CE'])),
    ).toEqual(['licence-not-supported']);
  });

  it('does not report missing members while the unit is being composed', () => {
    expect(checkComposition(unit({ trailer: semi }), { partial: true })).toEqual([]);
  });
});

describe('the period of a unit', () => {
  const at = (time: string) => Temporal.Instant.from(`2026-10-20T${time}Z`);

  it('ends after it starts, to the minute', () => {
    expect(checkUnitPeriod(at('08:00:00'), null)).toEqual([]);
    expect(checkUnitPeriod(at('08:00:00'), at('08:00:00'))).toEqual([
      { field: 'end', code: 'end-not-after-start' },
    ]);
    expect(checkUnitPeriod(at('08:00:30'), at('09:00:00'))).toEqual([
      { field: 'start', code: 'not-to-the-minute' },
    ]);
  });

  it('is half-open and may have no end (criterion 7)', () => {
    const day = openPeriodOf(at('08:00:00'), at('20:00:00'));
    expect(overlapsOpen(day, openPeriodOf(at('18:00:00'), at('22:00:00')))).toBe(true);
    expect(overlapsOpen(day, openPeriodOf(at('20:00:00'), at('22:00:00')))).toBe(false);
    expect(overlapsOpen(openPeriodOf(at('06:00:00'), null), day)).toBe(true);
    expect(overlapsOpen(day, openPeriodOf(at('20:00:00'), null))).toBe(false);
    expect(contains(day, at('20:00:00'))).toBe(false);
    expect(contains(openPeriodOf(at('20:00:00'), null), at('20:00:00'))).toBe(true);
  });
});

describe('the name of a unit', () => {
  it('is the one given, else the driver, else the plate', () => {
    const plate = asVehicle(tractor);
    expect(unitName('Unit 5', laurent.kind === 'driver' ? laurent : null, plate)).toBe('Unit 5');
    expect(unitName(null, laurent.kind === 'driver' ? laurent : null, plate)).toBe('M. Laurent');
    expect(unitName(null, null, plate)).toBe('TRACTOR');
  });
});

describe('the documents a unit needs', () => {
  const ids = (docs: { resourceId: string; code: string }[]) =>
    docs.map((d) => `${d.resourceId}:${d.code}`);

  it('asks a heavy unit for licence, CPC, driver card, roadworthiness and tachograph', () => {
    expect(
      ids(requiredDocuments(asVehicle(tractor), asVehicle(semi), laurent, ['C', 'CE'])),
    ).toEqual([
      'Laurent:licence-ce',
      'Laurent:cpc',
      'Laurent:driver-card',
      'tractor:roadworthiness',
      'tractor:tachograph',
      'semi-trailer:roadworthiness',
    ]);
  });

  it('asks a light van for the licence and its roadworthiness only', () => {
    expect(ids(requiredDocuments(asVehicle(van), null, marchand, ['C1']))).toEqual([
      'Marchand:licence-c1',
      'light-van:roadworthiness',
    ]);
  });

  it('exempts a trailer up to 3,500 kg from the roadworthiness test', () => {
    const light = asVehicle(drawbar(3_500));
    expect(ids(requiredDocuments(asVehicle(rigid(7_490)), light, null, []))).toEqual([
      'rigid-truck:roadworthiness',
      'rigid-truck:tachograph',
    ]);
    const heavy = asVehicle(drawbar(3_501));
    expect(ids(requiredDocuments(asVehicle(rigid(7_490)), heavy, null, []))).toContain(
      'drawbar-trailer:roadworthiness',
    );
  });

  it('names the licence needed when the driver has none', () => {
    expect(ids(requiredDocuments(asVehicle(tractor), asVehicle(semi), laurent, []))[0]).toBe(
      'Laurent:licence-ce',
    );
  });
});
