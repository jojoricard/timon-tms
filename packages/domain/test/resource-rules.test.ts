import { describe, expect, it } from 'vitest';
import {
  checkDriver,
  checkVehicle,
  compareDrivers,
  type Driver,
  defaultDisplayName,
  driverName,
  isValidPhone,
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
    expect(
      codes({ ...tractor, vehicleKind: 'rigid-truck', category: 'N2', gvwKg: 12_000, gcwKg: null }),
    ).toEqual([]);
    expect(codes({ ...trailer, vehicleKind: 'semi-trailer', category: 'O2' })).toEqual([
      'category:category-not-allowed',
    ]);
    expect(
      codes({ ...trailer, vehicleKind: 'drawbar-trailer', category: 'O2', gvwKg: 3_500 }),
    ).toEqual([]);
  });

  it('criterion 14: a tractor in N3 of 7,500 kg is refused, N3 being over 12,000 kg', () => {
    expect(checkVehicle({ ...tractor, gvwKg: 7_500, gcwKg: 40_000 })).toEqual([
      {
        field: 'category',
        code: 'category-weight-mismatch',
        params: { category: 'N3', gvwKg: 7_500, overKg: 12_000 },
      },
    ]);
  });

  it('criterion 14: a semi-trailer of 34,000 kg in O3 is refused, O3 being up to 10,000 kg', () => {
    const semi = {
      ...tractor,
      kind: 'trailer',
      vehicleKind: 'semi-trailer',
      category: 'O3',
      gvwKg: 34_000,
      gcwKg: null,
    } as const;
    expect(checkVehicle(semi)).toEqual([
      {
        field: 'category',
        code: 'category-weight-mismatch',
        params: { category: 'O3', gvwKg: 34_000, overKg: 3_500, upToKg: 10_000 },
      },
    ]);
  });

  it('rule 2: each category takes the weights the regulation gives it, bounds included', () => {
    const power = { ...tractor, vehicleKind: 'rigid-truck', gcwKg: null } as const;
    const trailer = { ...power, kind: 'trailer', vehicleKind: 'drawbar-trailer' } as const;
    const van = { ...power, vehicleKind: 'light-van' } as const;
    const fits = (vehicle: Vehicle) =>
      !codes(vehicle).includes('category:category-weight-mismatch');
    expect(fits({ ...van, category: 'N1', gvwKg: 3_500 })).toBe(true);
    expect(fits({ ...van, category: 'N1', gvwKg: 3_501 })).toBe(false);
    expect(fits({ ...power, category: 'N2', gvwKg: 3_500 })).toBe(false);
    expect(fits({ ...power, category: 'N2', gvwKg: 3_501 })).toBe(true);
    expect(fits({ ...power, category: 'N2', gvwKg: 12_000 })).toBe(true);
    expect(fits({ ...power, category: 'N3', gvwKg: 12_000 })).toBe(false);
    expect(fits({ ...power, category: 'N3', gvwKg: 12_001 })).toBe(true);
    expect(fits({ ...trailer, category: 'O1', gvwKg: 750 })).toBe(true);
    expect(fits({ ...trailer, category: 'O1', gvwKg: 751 })).toBe(false);
    expect(fits({ ...trailer, category: 'O2', gvwKg: 751 })).toBe(true);
    expect(fits({ ...trailer, category: 'O2', gvwKg: 3_501 })).toBe(false);
    expect(fits({ ...trailer, category: 'O3', gvwKg: 10_000 })).toBe(true);
    expect(fits({ ...trailer, category: 'O4', gvwKg: 10_000 })).toBe(false);
    expect(fits({ ...trailer, category: 'O4', gvwKg: 10_001 })).toBe(true);
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
      codes({
        ...tractor,
        kind: 'trailer',
        vehicleKind: 'semi-trailer',
        category: 'O4',
        gvwKg: 35_000,
      }),
    ).toEqual(['gcwKg:combination-not-allowed']);
  });

  it('refuses a kind of vehicle that does not belong to the resource kind', () => {
    expect(codes({ ...tractor, kind: 'trailer' })).toEqual(['vehicleKind:kind-not-allowed']);
  });

  it('requires a plate', () => {
    expect(codes({ ...tractor, plate: '  ' })).toEqual(['plate:required']);
  });
});

const karim: Driver = {
  kind: 'driver',
  lastName: 'Benali',
  firstName: 'Karim',
  displayName: null,
  employeeNumber: null,
  phone: null,
  protectiveEquipmentIds: [],
};

describe('checkDriver', () => {
  it('requires the last and first name, not the display name', () => {
    expect(checkDriver({ ...karim, lastName: '' })).toEqual([
      { field: 'lastName', code: 'required' },
    ]);
    expect(checkDriver(karim)).toEqual([]);
  });

  it('builds the display name from the names', () => {
    expect(defaultDisplayName('élodie', 'Marchand')).toBe('É. Marchand');
  });

  it('criterion 18: refuses the phone "abc", accepts French and foreign numbers', () => {
    expect(checkDriver({ ...karim, phone: 'abc' })).toEqual([
      { field: 'phone', code: 'phone-invalid' },
    ]);
    expect(checkDriver({ ...karim, phone: '06 12 34 56 78' })).toEqual([]);
    expect(checkDriver({ ...karim, phone: '+49 30 1234567' })).toEqual([]);
  });
});

describe('isValidPhone (rule 10)', () => {
  it('wants eight digits at least, with spaces, dots, dashes, parentheses and a leading +', () => {
    for (const phone of [
      '0612345678',
      '06.12.34.56.78',
      '06-12-34-56-78',
      '+33 (0)6 12 34 56 78',
    ]) {
      expect(isValidPhone(phone)).toBe(true);
    }
    for (const phone of [
      'abc',
      'zz',
      '0612 345',
      '06 12 34 56 78 ext 2',
      '33+ 6 12 34 56 78',
      '++33612345678',
    ]) {
      expect(isValidPhone(phone)).toBe(false);
    }
  });
});

describe('driverName (rule 8)', () => {
  it('criterion 16: built from the names while none is typed, and follows them', () => {
    const xavier = { ...karim, lastName: "D'Artagnan", firstName: 'Xavier' };
    expect(driverName(xavier)).toBe("X. D'Artagnan");
    expect(driverName({ ...xavier, lastName: 'Zola', firstName: 'Émile' })).toBe('É. Zola');
  });

  it('keeps a display name typed by the dispatcher', () => {
    expect(driverName({ ...karim, displayName: 'Kader' })).toBe('Kader');
  });
});

describe('compareDrivers (rule 8)', () => {
  it('sorts by last name, then first name, ignoring case and accents', () => {
    const names = [
      ['Zola', 'Émile'],
      ['Girard', 'Thomas'],
      ['Dupuis', 'Anne'],
      ['Élie', 'Marc'],
      ['Dupuis', 'Adèle'],
      ['du Pont', 'Jean'],
    ].map(([lastName, firstName]) => ({ lastName, firstName }) as Driver);
    expect(names.sort(compareDrivers).map((d) => `${d.firstName} ${d.lastName}`)).toEqual([
      'Jean du Pont',
      'Adèle Dupuis',
      'Anne Dupuis',
      'Marc Élie',
      'Thomas Girard',
      'Émile Zola',
    ]);
  });
});
