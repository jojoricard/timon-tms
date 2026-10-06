import { periodOf, Temporal } from '@timon/domain';
import { count } from 'drizzle-orm';
import type { Database } from './database.ts';
import { resource, resourceBooking } from './schema.ts';

const timeZone = 'Europe/Paris';

// The haulier of the mockups, based south of Lyon: its data is in French, like a real one's.
// Fixed ids keep links stable between runs.
const resources = [
  { id: '00000000-0000-4000-8000-000000000101', kind: 'driver', name: 'M. Laurent' },
  { id: '00000000-0000-4000-8000-000000000102', kind: 'driver', name: 'S. Moreau' },
  { id: '00000000-0000-4000-8000-000000000103', kind: 'driver', name: 'L. Fabre' },
  { id: '00000000-0000-4000-8000-000000000104', kind: 'driver', name: 'K. Benali' },
  { id: '00000000-0000-4000-8000-000000000201', kind: 'power-unit', name: 'AB-123-CD' },
  { id: '00000000-0000-4000-8000-000000000202', kind: 'power-unit', name: 'CD-456-EF' },
  { id: '00000000-0000-4000-8000-000000000203', kind: 'power-unit', name: 'GH-012-IJ' },
  { id: '00000000-0000-4000-8000-000000000301', kind: 'trailer', name: 'SR-4471' },
  { id: '00000000-0000-4000-8000-000000000302', kind: 'trailer', name: 'SR-4480' },
] as const;

// [resource index, day offset from today, start hour, end hour, label]
const bookings = [
  [0, 0, 6, 10, 'Lyon → Grenoble'],
  [0, 0, 11, 15, 'Grenoble → Chambéry'],
  [1, 0, 6, 9, 'Lyon → Roanne'],
  [1, 1, 0, 11, 'Repos journalier'],
  [2, 0, 7, 12, 'Vienne → Lyon 7e'],
  [3, 0, 5, 9, 'Corbas → Lyon 9e'],
  [3, 1, 8, 12, 'Contrôle technique'],
  [4, 0, 6, 15, 'Lyon → Grenoble → Chambéry'],
  [7, 0, 6, 15, 'Lyon → Grenoble → Chambéry'],
] as const;

/**
 * Writes the demo haulier: a few resources and their bookings around `today`.
 * Does nothing if resources already exist, so it is safe to run at every start of the demo.
 */
export async function seed(
  db: Database,
  today = Temporal.Now.plainDateISO(timeZone),
): Promise<boolean> {
  const [existing] = await db.select({ n: count() }).from(resource);
  if ((existing?.n ?? 0) > 0) return false;

  const at = (day: number, hour: number) =>
    today.add({ days: day }).toZonedDateTime({ timeZone, plainTime: { hour } }).toInstant();

  await db.transaction(async (tx) => {
    await tx.insert(resource).values([...resources]);
    await tx.insert(resourceBooking).values(
      bookings.map(([index, day, from, to, label]) => ({
        resourceId: resources[index].id,
        period: periodOf(at(day, from), at(day, to)),
        label,
      })),
    );
  });
  return true;
}
