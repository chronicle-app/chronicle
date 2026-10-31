import { describe, expect, it } from 'vitest';
import {
  type DateRange,
  intersectRanges,
  parseDateRange,
  relativeDateRange,
  resolveDateRanges,
} from './time.js';

const utc = (...a: Parameters<typeof Date.UTC>) => Date.UTC(...a);

describe('parseDateRange', () => {
  it('widens a bare year to the whole year', () => {
    expect(parseDateRange('1949')).toEqual({
      lower: utc(1949, 0, 1),
      upper: utc(1950, 0, 1) - 1,
      precision: 'year',
    });
  });

  it('widens a year-month to the whole month, handling rollover', () => {
    expect(parseDateRange('2019-02')).toEqual({
      lower: utc(2019, 1, 1),
      upper: utc(2019, 2, 1) - 1, // Feb has 28 days in 2019; Date.UTC handles it
      precision: 'month',
    });
    expect(parseDateRange('2019-12')).toEqual({
      lower: utc(2019, 11, 1),
      upper: utc(2020, 0, 1) - 1,
      precision: 'month',
    });
  });

  it('widens a day to that calendar day', () => {
    expect(parseDateRange('2019-03-03')).toEqual({
      lower: utc(2019, 2, 3),
      upper: utc(2019, 2, 4) - 1,
      precision: 'day',
    });
  });

  it('collapses a full timestamp to a point', () => {
    const r = parseDateRange('2019-03-03T14:00:00.000Z');
    expect(r).toBeDefined();
    expect(r!.lower).toBe(r!.upper);
    expect(r!.precision).toBe('instant');
    expect(r!.lower).toBe(Date.parse('2019-03-03T14:00:00.000Z'));
  });

  it('treats an epoch-ms number as a point', () => {
    expect(parseDateRange(1_551_621_600_000)).toEqual({
      lower: 1_551_621_600_000,
      upper: 1_551_621_600_000,
      precision: 'instant',
    });
  });

  it('rejects garbage and out-of-range fields', () => {
    expect(parseDateRange('not a date')).toBeUndefined();
    expect(parseDateRange('2019-13')).toBeUndefined();
    expect(parseDateRange('2019-00-10')).toBeUndefined();
    expect(parseDateRange(null)).toBeUndefined();
    expect(parseDateRange(Number.NaN)).toBeUndefined();
  });
});

describe('intersectRanges', () => {
  const year = parseDateRange('1949')!;
  const day = parseDateRange('1949-03-03')!;
  const otherDay = parseDateRange('1950-03-03')!;

  it('narrows a year to a day inside it, keeping the finer precision', () => {
    const r = intersectRanges(year, day);
    expect(r).toEqual({ ...day, precision: 'day' });
  });

  it('is commutative', () => {
    expect(intersectRanges(year, day)).toEqual(intersectRanges(day, year));
  });

  it('returns null when the ranges do not overlap (conflict)', () => {
    expect(intersectRanges(year, otherDay)).toBeNull();
  });

  it('keeps an overlapping pair, taking the tighter bounds', () => {
    const h1 = parseDateRange('2019-01')!;
    const overlap = intersectRanges(h1, parseDateRange('2019-01-15')!);
    expect(overlap).toEqual({ ...parseDateRange('2019-01-15')!, precision: 'day' });
  });
});

describe('resolveDateRanges', () => {
  it('converges to the same narrowed range regardless of arrival order', () => {
    const ranges = [
      parseDateRange('1949')!,
      parseDateRange('1949-03')!,
      parseDateRange('1949-03-03')!,
    ];
    const expected = parseDateRange('1949-03-03')!;

    // every permutation lands on the day
    const perms: DateRange[][] = [
      [ranges[0], ranges[1], ranges[2]],
      [ranges[2], ranges[1], ranges[0]],
      [ranges[1], ranges[2], ranges[0]],
      [ranges[2], ranges[0], ranges[1]],
    ];
    for (const p of perms) {
      const out = resolveDateRanges(p);
      expect(out).toEqual({ range: expected });
    }
  });

  it('surfaces a conflict rather than coercing', () => {
    const out = resolveDateRanges([parseDateRange('1949')!, parseDateRange('1950-03-03')!]);
    expect(out && 'conflict' in out).toBe(true);
  });

  it('reports the same conflicting pair regardless of order', () => {
    const a = parseDateRange('1949')!;
    const b = parseDateRange('1950-03-03')!;
    const fwd = resolveDateRanges([a, b]);
    const rev = resolveDateRanges([b, a]);
    expect(fwd).toEqual(rev);
  });

  it('returns undefined for no evidence', () => {
    expect(resolveDateRanges([])).toBeUndefined();
  });
});

describe('relativeDateRange', () => {
  // Thursday, 2023-04-20 15:30 UTC.
  const now = Date.UTC(2023, 3, 20, 15, 30);

  it('-<n><unit> is a trailing instant', () => {
    expect(relativeDateRange('-7d', now)).toEqual({
      lower: now - 7 * 86_400_000,
      upper: now - 7 * 86_400_000,
      precision: 'instant',
    });
    expect(relativeDateRange('-30m', now)?.lower).toBe(now - 30 * 60_000);
  });

  it('calendar words are whole periods at their natural precision', () => {
    expect(relativeDateRange('today', now)).toEqual({
      lower: Date.UTC(2023, 3, 20),
      upper: Date.UTC(2023, 3, 21) - 1,
      precision: 'day',
    });
    expect(relativeDateRange('yesterday', now)?.lower).toBe(Date.UTC(2023, 3, 19));
    // ISO weeks are Monday-start: this week began 04-17; last week 04-10..16.
    expect(relativeDateRange('last-week', now)).toEqual({
      lower: Date.UTC(2023, 3, 10),
      upper: Date.UTC(2023, 3, 17) - 1,
      precision: 'day',
    });
    expect(relativeDateRange('last-month', now)).toEqual({
      lower: Date.UTC(2023, 2, 1),
      upper: Date.UTC(2023, 3, 1) - 1,
      precision: 'month',
    });
    expect(relativeDateRange('this-year', now)?.precision).toBe('year');
  });

  it('anything else is not a relative date', () => {
    expect(relativeDateRange('2019', now)).toBeUndefined();
    expect(relativeDateRange('later', now)).toBeUndefined();
  });
});
