import { describe, expect, it } from 'vitest';
import {
  checkDriver,
  checkVehicle,
  defaultDisplayName,
  plateKey,
  type Vehicle,
} from '../src/index.ts';

const tractor: Vehicle = {
  kind: 'power-unit',
  plate: 'CD-456-EF',
  vehicleKind: 'tractor',
  category: 'N3',
  gvwKg: 19_000,
  gcwKg: 44_000,
  makeModel: 'Renault T 480',
  bodyTypeId: null,
  tradeLabelId: null,
  capabilityIds: [],
};

const codes = (vehicle: Vehicle) => checkVehicle(vehicle).map((i) => `${i.field}:${i.code}`);

describe('plateKey', () => {
  it('criterion 5: "AB-123-CD" and "ab 123 cd" are the same plate', () => {
    expect(plateKey('ab 123 cd')).toBe(plateKey('AB-123-CD'));
  });

  it('keeps every other character of a foreign plate', () => {
    expect(plateKey('B-MW 1234')).toBe('BMW1234');
    expect(plateKey('1-ABC-123')).toBe('1ABC123');
  });
});

describe('checkVehicle', () => {
  it('accepts a consistent tractor', () => {
    expect(checkVehicle(tractor)).toEqual([]);
  });

  it('criterion 6: a light van in N3 is refused, with the allowed categories', () => {
    const van = { ...tractor, vehicleKind: 'light-van', category: 'N3', gvwKg: 3_500, gcwKg: null };
    expect(checkVehicle(van as Vehicle)).toEqual([
      {
        field: 'category',
        code: 'category-not-allowed',
        params: { kind: 'light-van', category: 'N3', allowed: 'N1' },
      },
    ]);
  });

  it('applies rule 2 to every kind', () => {
    const trailer = { ...tractor, kind: 'trailer', gcwKg: null } as const;
    expect(codes({ ...tractor, category: 'N1' })).toEqual(['category:category-not-allowed']);
    expect(codes({ ...tractor, vehicleKind: 'rigid-truck', category: 'N2', gcwKg: null })).toEqual(
      [],
    );
    expect(codes({ ...trailer, vehicleKind: 'semi-trailer', category: 'O2' })).toEqual([
      'category:category-not-allowed',
    ]);
    expect(codes({ ...trailer, vehicleKind: 'drawbar-trailer', category: 'O2' })).toEqual([]);
  });

  it('criterion 7: a tractor has no body type', () => {
    expect(codes({ ...tractor, bodyTypeId: 'curtainsider' })).toEqual([
      'bodyTypeId:body-type-not-allowed',
    ]);
    expect(codes({ ...tractor, vehicleKind: 'rigid-truck', bodyTypeId: 'box' })).toEqual([]);
  });

  it('applies rule 3 to weights', () => {
    expect(codes({ ...tractor, gvwKg: 0 })).toEqual(['gvwKg:weight-not-positive']);
    expect(codes({ ...tractor, gcwKg: 19_000 })).toEqual(['gcwKg:combination-not-above-vehicle']);
    expect(
      codes({ ...tractor, kind: 'trailer', vehicleKind: 'semi-trailer', category: 'O4' }),
    ).toEqual(['gcwKg:combination-not-allowed']);
  });

  it('refuses a kind of vehicle that does not belong to the resource kind', () => {
    expect(codes({ ...tractor, kind: 'trailer' })).toEqual(['vehicleKind:kind-not-allowed']);
  });

  it('requires a plate', () => {
    expect(codes({ ...tractor, plate: '  ' })).toEqual(['plate:required']);
  });
});

describe('checkDriver', () => {
  it('requires the last and first name', () => {
    const driver = {
      kind: 'driver',
      lastName: '',
      firstName: 'Karim',
      displayName: 'K.',
      employeeNumber: null,
      phone: null,
    } as const;
    expect(checkDriver(driver)).toEqual([{ field: 'lastName', code: 'required' }]);
  });

  it('builds the display name from the names', () => {
    expect(defaultDisplayName('élodie', 'Marchand')).toBe('É. Marchand');
  });
});
