import { describe, expect, it } from 'vitest';
import { findOverlaps, InvalidPeriodError, overlaps, periodOf } from '../src/index.ts';

const at = (hour: number) => `2026-10-07T${String(hour).padStart(2, '0')}:00:00Z`;

describe('periodOf', () => {
  it('rejects a period that does not end after it starts', () => {
    expect(() => periodOf(at(10), at(10))).toThrow(InvalidPeriodError);
    expect(() => periodOf(at(11), at(10))).toThrow(InvalidPeriodError);
  });
});

describe('overlaps', () => {
  it('detects periods sharing at least an instant', () => {
    expect(overlaps(periodOf(at(8), at(12)), periodOf(at(11), at(14)))).toBe(true);
    expect(overlaps(periodOf(at(8), at(12)), periodOf(at(9), at(10)))).toBe(true);
  });

  it('lets a period start when the previous one ends', () => {
    expect(overlaps(periodOf(at(8), at(10)), periodOf(at(10), at(12)))).toBe(false);
  });
});

describe('findOverlaps', () => {
  const bookings = [
    { resourceId: 'driver-1', period: periodOf(at(8), at(12)) },
    { resourceId: 'driver-2', period: periodOf(at(8), at(12)) },
    { resourceId: 'driver-1', period: periodOf(at(14), at(18)) },
  ];

  it('only reports bookings of the same resource', () => {
    expect(findOverlaps('driver-1', periodOf(at(11), at(15)), bookings)).toEqual([
      bookings[0],
      bookings[2],
    ]);
  });

  it('reports nothing for a free slot', () => {
    expect(findOverlaps('driver-1', periodOf(at(12), at(14)), bookings)).toEqual([]);
  });
});
