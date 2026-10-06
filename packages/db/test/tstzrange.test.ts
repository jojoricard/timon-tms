import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/tstzrange.ts';

describe('parseRange', () => {
  it('reads PostgreSQL output in any session time zone', () => {
    const utc = parseRange('["2026-10-07 08:00:00+00","2026-10-07 12:00:00+00")');
    const paris = parseRange('["2026-10-07 10:00:00+02","2026-10-07 14:00:00+02")');
    const india = parseRange('["2026-10-07 13:30:00+05:30","2026-10-07 17:30:00+05:30")');
    for (const period of [paris, india]) {
      expect(period.start.equals(utc.start)).toBe(true);
      expect(period.end.equals(utc.end)).toBe(true);
    }
  });

  it('refuses a range that is not bounded and half-open', () => {
    expect(() => parseRange('["2026-10-07 08:00:00+00",)')).toThrow();
    expect(() => parseRange('["2026-10-07 08:00:00+00","2026-10-07 12:00:00+00"]')).toThrow();
    expect(() => parseRange('empty')).toThrow();
  });
});
