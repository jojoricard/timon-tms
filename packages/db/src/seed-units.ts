import type { NewUnit, StoredResource } from '@timon/app';
import { resourceName, Temporal } from '@timon/domain';
import type { Repositories } from './repositories.ts';

// The units of the mockups, built from the seeded fleet. Dates are written as on units.png,
// dated Tuesday 27 October 2026, and moved by as many days as separate that date from today:
// the demo always shows the same units running now, with the same history behind them.
const unitsMockupDay = Temporal.PlainDate.from('2026-10-27');

type Seat = string | null;
type UnitRow = {
  name?: string;
  powerUnit: string;
  trailer: Seat;
  driver: Seat;
  /** Paris time, "2026-10-06 06:00". */
  start: string;
  end?: string;
};
/** A unit and the changes that followed it, each from a given minute. */
type Chain = {
  first: UnitRow;
  changes?: { at: string; trailer?: Seat; driver?: Seat }[];
};

const chains: Chain[] = [
  // Changed in the past: Marc Laurent hands CD-456-EF over to Hugo Perrin on 26 October.
  {
    first: {
      powerUnit: 'CD-456-EF',
      trailer: 'SR-4471',
      driver: 'M. Laurent',
      start: '2026-10-06 06:00',
    },
    changes: [{ at: '2026-10-26 06:00', driver: 'H. Perrin' }],
  },
  // Samuel Moreau's history, as on unit-history.png: a one-off day, then a tractor and a
  // trailer, then a change of tractor and one of trailer.
  {
    first: {
      powerUnit: 'AB-123-CD',
      trailer: null,
      driver: 'S. Moreau',
      start: '2026-02-12 08:00',
      end: '2026-02-12 18:00',
    },
  },
  {
    first: {
      powerUnit: 'AB-123-CD',
      trailer: 'FR-2210',
      driver: 'S. Moreau',
      start: '2026-03-03 06:00',
      end: '2026-09-14 05:00',
    },
  },
  {
    first: {
      powerUnit: 'EF-789-GH',
      trailer: 'FR-2210',
      driver: 'S. Moreau',
      start: '2026-09-14 05:00',
    },
    changes: [{ at: '2026-10-06 06:00', trailer: 'SR-4480' }],
  },
  // No driver: the planning will show it as needing one.
  {
    first: {
      name: 'Unit 5',
      powerUnit: 'QR-678-ST',
      trailer: 'SR-4483',
      driver: null,
      start: '2026-10-20 06:00',
    },
  },
  {
    first: {
      powerUnit: 'IJ-345-KL',
      trailer: 'SR-4492',
      driver: 'K. Benali',
      start: '2026-06-15 06:00',
    },
  },
  {
    first: {
      powerUnit: 'ST-234-UV',
      trailer: 'SR-4472',
      driver: 'J. Roux',
      start: '2026-03-02 06:00',
    },
  },
  {
    first: {
      powerUnit: 'KL-678-MN',
      trailer: 'FR-2214',
      driver: 'L. Fabre',
      start: '2026-09-15 05:00',
    },
  },
  // One-off: today from 08:00 to 20:00.
  {
    first: {
      powerUnit: 'AB-123-CD',
      trailer: 'SR-4488',
      driver: 'S. Haddad',
      start: '2026-10-27 08:00',
      end: '2026-10-27 20:00',
    },
  },
  {
    first: { powerUnit: 'GH-012-IJ', trailer: null, driver: 'P. Vidal', start: '2026-04-07 06:00' },
  },
  {
    first: {
      powerUnit: 'MN-345-OP',
      trailer: 'RQ-0912',
      driver: 'Y. Morel',
      start: '2026-05-04 06:00',
    },
  },
  {
    first: {
      powerUnit: 'OP-901-QR',
      trailer: null,
      driver: 'N. Bensaïd',
      start: '2026-02-18 06:00',
    },
  },
  {
    first: {
      powerUnit: 'FG-204-HJ',
      trailer: null,
      driver: 'É. Marchand',
      start: '2026-01-05 07:00',
    },
  },
];

/**
 * Writes the demo units, unless the fleet they are made of is missing. Written through the
 * repository: the rules of SPEC-003 hold for these rows, and the database still checks overlaps.
 */
export async function seedUnits(repositories: Repositories, today: Temporal.PlainDate) {
  const shift = unitsMockupDay.until(today).days;
  const instant = (local: string) =>
    Temporal.PlainDateTime.from(local.replace(' ', 'T'))
      .add({ days: shift })
      .toZonedDateTime('Europe/Paris')
      .toInstant();
  const resources = await repositories.resources.list({ includeArchived: false });
  const byName = new Map(resources.map((r: StoredResource) => [resourceName(r), r.id]));
  const id = (name: Seat) => {
    if (name === null) return null;
    const found = byName.get(name);
    if (!found) throw new Error(`No resource ${name} in the seeded fleet`);
    return found;
  };

  for (const { first, changes = [] } of chains) {
    let current = await repositories.units.create({
      name: first.name ?? null,
      powerUnitId: id(first.powerUnit) ?? '',
      trailerId: id(first.trailer),
      driverId: id(first.driver),
      period: { start: instant(first.start), end: first.end ? instant(first.end) : null },
      previousUnitId: null,
    });
    for (const change of changes) {
      const next: NewUnit = {
        ...current,
        trailerId: change.trailer === undefined ? current.trailerId : id(change.trailer),
        driverId: change.driver === undefined ? current.driverId : id(change.driver),
        period: { start: instant(change.at), end: current.period.end },
        previousUnitId: current.id,
      };
      current = (await repositories.units.change(current.id, next)).started;
    }
  }
}
