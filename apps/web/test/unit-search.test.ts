import type { UnitJson, UnitMemberJson } from '@timon/http';
import { describe, expect, it } from 'vitest';
import { matchesUnit } from '../src/units/unit-search.ts';

// The search of the units screen: words in any order, accents and case forgiven, and a plate
// compared as SPEC-001 rule 1 compares plates, without spaces, dashes or case.

const member = (changes: Partial<UnitMemberJson>): UnitMemberJson => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'power-unit',
  name: '',
  fullName: '',
  archived: false,
  vehicleKind: null,
  makeModel: null,
  category: null,
  gvwKg: null,
  gcwKg: null,
  bodyTypeId: null,
  licences: [],
  ...changes,
});

const unit = {
  name: 'H. Perrin',
  powerUnit: member({ name: 'AB-123-CD', makeModel: 'Volvo FH 460' }),
  trailer: member({ kind: 'trailer', name: 'SR-4471' }),
  driver: member({ kind: 'driver', name: 'H. Perrin', fullName: 'Hugo Perrin' }),
} as unknown as UnitJson;

describe('units search', () => {
  it.each(['sr4471', 'SR-4471', 'sr-4471', 'SR 4471', 'ab123cd', 'AB 123-CD'])(
    'finds the unit by plate: %s',
    (query) => {
      expect(matchesUnit(unit, query)).toBe(true);
    },
  );

  it.each(['perrin', 'hugo perrin', 'Volvo', 'pérrin', 'perrin sr4471'])(
    'finds it by its other words: %s',
    (query) => {
      expect(matchesUnit(unit, query)).toBe(true);
    },
  );

  it.each(['sr4472', 'marchand', 'ab124'])('does not find it by %s', (query) => {
    expect(matchesUnit(unit, query)).toBe(false);
  });
});
