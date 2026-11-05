import { plateKey } from '@timon/domain';
import type { UnitJson } from '@timon/http';

/** Lower case and without accents, for a search that forgives both. */
const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Whether a unit answers a search: every word is in its name, its vehicles or its driver. A plate
 * is compared as SPEC-001 rule 1 compares plates, without spaces, dashes or case, so "sr4471"
 * finds SR-4471; a plate typed in parts, "SR 4471", finds it too.
 */
export function matchesUnit(unit: UnitJson, query: string): boolean {
  const plates = [unit.powerUnit.name, unit.trailer?.name ?? ''].map(plateKey).filter(Boolean);
  const wholePlate = plateKey(query);
  if (wholePlate !== '' && plates.some((plate) => plate.includes(wholePlate))) return true;

  const haystack = searchable(
    [
      unit.name,
      unit.powerUnit.name,
      unit.powerUnit.makeModel ?? '',
      unit.trailer?.name ?? '',
      unit.driver?.fullName ?? '',
      unit.driver?.name ?? '',
    ].join(' '),
  );
  return searchable(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (haystack.includes(word)) return true;
      const key = plateKey(word);
      return key !== '' && plates.some((plate) => plate.includes(key));
    });
}
