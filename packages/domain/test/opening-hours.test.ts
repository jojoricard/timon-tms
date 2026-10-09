import { describe, expect, it } from 'vitest';
import {
  checkOpeningRanges,
  formatOpeningDay,
  type OpeningRange,
  parseOpeningDay,
  parseTime,
} from '../src/index.ts';

const range = (weekday: OpeningRange['weekday'], start: string, end: string): OpeningRange => ({
  weekday,
  startMinute: parseTime(start) ?? -1,
  endMinute: parseTime(end) ?? -1,
});

describe('checkOpeningRanges', () => {
  it('criterion 9: Monday 06:00–12:00 and 11:00–18:00 overlap', () => {
    expect(checkOpeningRanges([range(1, '06:00', '12:00'), range(1, '11:00', '18:00')])).toEqual([
      {
        field: 'openings.1',
        code: 'opening-overlap',
        params: { weekday: 1, first: '06:00–12:00', second: '11:00–18:00' },
      },
    ]);
  });

  it('criterion 9: 22:00–24:00 on Monday and 00:00–05:00 on Tuesday are a night, not an error', () => {
    expect(checkOpeningRanges([range(1, '22:00', '24:00'), range(2, '00:00', '05:00')])).toEqual(
      [],
    );
  });

  it('accepts ranges that touch, and the same hours on two days', () => {
    expect(
      checkOpeningRanges([
        range(1, '06:00', '12:00'),
        range(1, '12:00', '14:00'),
        range(2, '06:00', '12:00'),
      ]),
    ).toEqual([]);
  });

  it('refuses a range that ends before it starts, or after 24:00', () => {
    expect(checkOpeningRanges([range(3, '12:00', '08:00')]).map((i) => i.code)).toEqual([
      'opening-invalid',
    ]);
    expect(
      checkOpeningRanges([{ weekday: 3, startMinute: 600, endMinute: 1441 }]).map((i) => i.code),
    ).toEqual(['opening-invalid']);
  });
});

describe('parseTime and parseOpeningDay', () => {
  it('reads 24:00 as the end of the day and refuses 24:01', () => {
    expect(parseTime('24:00')).toBe(1440);
    expect(parseTime('24:01')).toBeUndefined();
    expect(parseTime('6h30')).toBe(390);
  });

  it('reads a day of a CSV file', () => {
    expect(parseOpeningDay(1, '06:00-12:00/13:00-17:00')).toEqual([
      { weekday: 1, startMinute: 360, endMinute: 720 },
      { weekday: 1, startMinute: 780, endMinute: 1020 },
    ]);
    expect(parseOpeningDay(7, '')).toEqual([]);
    expect(parseOpeningDay(7, 'fermé')).toEqual([]);
    expect(parseOpeningDay(1, '6 to 12')).toBeUndefined();
  });

  it('writes a day back in order', () => {
    const day = [range(4, '13:00', '17:30'), range(4, '06:00', '12:00')];
    expect(formatOpeningDay(day, 4)).toBe('06:00–12:00 · 13:00–17:30');
    expect(formatOpeningDay(day, 5)).toBe('');
  });
});
