import { findOverlaps, type Period, periodOf, type ResourceBooking } from '@timon/domain';
import { describe, expect, it } from 'vitest';
import { BookingOverlapError, createBooking, type NewBooking, type Ports } from '../src/index.ts';

const driver = { id: 'driver-1', kind: 'driver', name: 'Karim B.' } as const;
const at = (hour: number) => `2026-10-07T${String(hour).padStart(2, '0')}:00:00Z`;

/** In-memory ports; `raceWith` simulates a booking committed by someone else after the check. */
function memoryPorts(options: { raceWith?: Period } = {}): Ports & { stored: ResourceBooking[] } {
  const stored: ResourceBooking[] = [];
  let checks = 0;
  return {
    stored,
    resources: {
      list: async () => [driver],
      get: async (id) => (id === driver.id ? driver : undefined),
    },
    bookings: {
      listByResource: async (resourceId) => stored.filter((b) => b.resourceId === resourceId),
      listOverlapping: async (resourceId, period) => {
        checks += 1;
        if (options.raceWith && checks === 2) {
          return [{ id: 'other', resourceId, period: options.raceWith, label: 'Other' }];
        }
        return findOverlaps(resourceId, period, stored);
      },
      insert: async (booking: NewBooking) => {
        if (options.raceWith) throw new BookingOverlapError();
        const created = { ...booking, id: `booking-${stored.length + 1}` };
        stored.push(created);
        return created;
      },
    },
  };
}

describe('createBooking', () => {
  it('books a free resource', async () => {
    const ports = memoryPorts();
    const result = await createBooking(ports, {
      resourceId: driver.id,
      period: periodOf(at(8), at(12)),
      label: 'CMD-2041',
    });
    expect(result.ok).toBe(true);
    expect(ports.stored).toHaveLength(1);
  });

  it('refuses an overlap found by the rule', async () => {
    const ports = memoryPorts();
    const input = { resourceId: driver.id, period: periodOf(at(8), at(12)), label: 'CMD-2041' };
    await createBooking(ports, input);
    const result = await createBooking(ports, { ...input, period: periodOf(at(11), at(13)) });
    expect(result).toMatchObject({
      ok: false,
      reason: 'overlap',
      conflicts: [{ label: 'CMD-2041' }],
    });
  });

  it('refuses an overlap rejected by the database after the check', async () => {
    const ports = memoryPorts({ raceWith: periodOf(at(9), at(10)) });
    const result = await createBooking(ports, {
      resourceId: driver.id,
      period: periodOf(at(8), at(12)),
      label: 'CMD-2041',
    });
    expect(result).toMatchObject({ ok: false, reason: 'overlap', conflicts: [{ id: 'other' }] });
  });

  it('refuses an unknown resource', async () => {
    const result = await createBooking(memoryPorts(), {
      resourceId: 'nobody',
      period: periodOf(at(8), at(12)),
      label: 'CMD-2041',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown-resource' });
  });
});
