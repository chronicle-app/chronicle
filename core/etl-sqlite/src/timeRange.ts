/**
 * A since/until window, as it appears on every extractor config. Values are
 * normally Dates (the extractor schema coerces them) but strings/numbers are
 * accepted and parsed.
 */
export interface TimeRange {
  since?: Date | string | number | null;
  until?: Date | string | number | null;
}

export interface TimeRangeOptions {
  /**
   * Map a bound to the column's native representation. Defaults to Unix
   * seconds. Pass an Apple-epoch conversion for Core Data columns
   * (e.g. `(d) => unixToSafariTimestamp(d.getTime() / 1000)`), or a string
   * formatter for text datetime columns.
   */
  convert?: (date: Date) => number | string;
  /** Comparator for the since bound (default `>`). */
  sinceOp?: '>' | '>=';
  /** Comparator for the until bound (default `<`). */
  untilOp?: '<' | '<=';
}

const defaultConvert = (date: Date): number => date.getTime() / 1000;

const asDate = (value: Date | string | number): Date => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid time range date');
  return date;
};

/**
 * Build parameterized WHERE conditions for a since/until window over a raw SQL
 * query. Returns one condition string (`"col > ?"`) plus its value per bound
 * that is set; both empty when the range is unbounded.
 */
export function timeRangeConditions(
  column: string,
  range: TimeRange,
  options: TimeRangeOptions = {}
): { conditions: string[]; values: Array<number | string> } {
  const { convert = defaultConvert, sinceOp = '>', untilOp = '<' } = options;
  const conditions: string[] = [];
  const values: Array<number | string> = [];
  if (range.since !== undefined && range.since !== null) {
    conditions.push(`${column} ${sinceOp} ?`);
    values.push(convert(asDate(range.since)));
  }
  if (range.until !== undefined && range.until !== null) {
    conditions.push(`${column} ${untilOp} ?`);
    values.push(convert(asDate(range.until)));
  }
  return { conditions, values };
}
