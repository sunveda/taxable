import { describe, expect, it } from 'vitest';
import {
  addYears,
  allocateProportionally,
  dec,
  localDate,
  parseInstant,
  roundTo,
  sum,
} from './index';

describe('decimal', () => {
  it('is exact where floats are not', () => {
    expect(dec('0.1').plus(dec('0.2')).equals(dec('0.3'))).toBe(true);
    expect(dec('123456789012345678.000000000000000001').plus('1').toFixed()).toBe(
      '123456789012345679.000000000000000001',
    );
  });

  it('allocates proportionally and always sums back to the total', () => {
    const parts = allocateProportionally(dec('100'), [dec('1'), dec('1'), dec('1')]);
    expect(sum(parts).equals(dec('100'))).toBe(true);
    expect(parts[0]!.toFixed(10)).toBe('33.3333333333');
    expect(allocateProportionally(dec('10'), [])).toEqual([]);
  });

  it('rounds only when asked, with an explicit mode', () => {
    expect(roundTo(dec('1.005'), 2, 'HALF_UP').toFixed()).toBe('1.01');
    expect(roundTo(dec('1999.9'), 0, 'DOWN').toFixed()).toBe('1999');
  });
});

describe('time', () => {
  it('requires an explicit offset', () => {
    expect(() => parseInstant('2025-01-01T00:00:00')).toThrow(/offset/);
  });

  it('resolves the local calendar date in a time zone', () => {
    expect(localDate('2025-12-31T15:30:00Z', 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
    expect(localDate('2025-01-01T03:00:00Z', 'America/New_York')).toEqual({
      year: 2024,
      month: 12,
      day: 31,
    });
  });

  it('maps 29 February to 28 February in non-leap years', () => {
    expect(addYears({ year: 2024, month: 2, day: 29 }, 1)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
  });
});
