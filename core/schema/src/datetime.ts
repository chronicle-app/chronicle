// A :DateTime string is one point in time, written in a subset of EDTF
// (ISO 8601-2). A :DateRange string is a stretch of time, written with the same
// parts. See their comments in chronicle.ttl for the forms.

// A year with any trailing digits unspecified: 1987, 198X, 19XX, 1XXX, XXXX.
const YEAR = String.raw`\d{4}|\d{3}X|\d{2}XX|\dXXX|XXXX`;
const DATE = new RegExp(
  String.raw`^(?<year>${YEAR})(?:-(?<month>\d{2}|XX)(?:-(?<day>\d{2}|XX))?)?(?<qualifier>[?~%])?$`
);
const INSTANT =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?Z$/;

const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const validDay = (year: string, month: string, day: string): boolean => {
  if (month === 'XX' || day === 'XX') return true;
  const days = /X/.test(year) ? daysIn(2000, Number(month)) : daysIn(Number(year), Number(month));
  return Number(day) >= 1 && Number(day) <= days;
};

/** Whether `value` is a full instant in UTC, such as `2024-03-02T14:05:00Z`. */
export function isInstant(value: string): boolean {
  const instant = INSTANT.exec(value)?.groups;
  if (!instant) return false;
  const { year, month, day, hour, minute, second } = instant;
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    validDay(year, month, day) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59
  );
}

/**
 * Whether `value` is a :DateTime string: a full instant in UTC
 * (`2024-03-02T14:05:00Z`), or a date at year, month, or day precision that
 * may leave trailing year digits, the month, or the day unspecified with `X`
 * and may end in one qualifier (`?` uncertain, `~` approximate, `%` both).
 */
export function isDateTime(value: string): boolean {
  if (INSTANT.test(value)) return isInstant(value);
  const date = DATE.exec(value)?.groups;
  if (!date) return false;
  const { year, month, day } = date;
  // An unspecified month with a known day says nothing usable; neither does
  // a value with no known digit at all.
  if (month === 'XX' && day !== undefined && day !== 'XX') return false;
  if (year === 'XXXX' && (month === undefined || month === 'XX')) return false;
  if (month === undefined || month === 'XX') return true;
  return (
    Number(month) >= 1 && Number(month) <= 12 && (day === undefined || validDay(year, month, day))
  );
}

/** A :DateTime date as `YYYY-MM-DD`, to compare as text, filling what it leaves open. */
const dayWith = (date: string, digit: string, month: string, day: string): string => {
  const [y, m = month, d = day] = date.replace(/[?~%]$/, '').split('-');
  return `${y.replaceAll('X', digit)}-${m === 'XX' ? month : m}-${d === 'XX' ? day : d}`;
};
const earliestDay = (date: string) => dayWith(date, '0', '01', '01');
// Every month has a day 31 for this comparison.
const latestDay = (date: string) => dayWith(date, '9', '12', '31');

/**
 * Whether `value` is a :DateRange string: a :DateTime date, which stands for all
 * of its period, or two :DateTime values joined by `/`, both dates or both
 * instants, that does not end before it starts. Ends with unspecified digits
 * pass if they could be in order.
 */
export function isDateRange(value: string): boolean {
  const ends = value.split('/');
  if (ends.length === 1) return !INSTANT.test(value) && isDateTime(value);
  if (ends.length !== 2) return false;
  const [start, end] = ends;
  if (!isDateTime(start) || !isDateTime(end)) return false;
  if (INSTANT.test(start) !== INSTANT.test(end)) return false;
  return INSTANT.test(start)
    ? Date.parse(start) <= Date.parse(end)
    : earliestDay(start) <= latestDay(end);
}
