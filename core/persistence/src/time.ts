/**
 * Time handling. Bound columns are epoch-ms integers (originals survive in the
 * event payload). Parsing/formatting is deterministic — no wall-clock reads —
 * so projected content is a pure function of event content.
 */

/** Parse an ISO-8601 string or epoch-ms number to epoch ms; undefined if unparseable. */
export function parseInstant(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/** Canonical UTC lexical form for a bound, e.g. "2020-01-01T12:00:00.000Z". */
export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * A payload's assertion time (the sighting axis) — read only from the explicit
 * `@assertedAt` directive, never from occurrence fields (`timestamp`/`startTime`/
 * `endTime`) and never from arrival order or the ETL run clock. The two axes are
 * distinct: `@assertedAt` is *when the claim was witnessed*, occurrence is *when
 * the thing happened*, and conflating them poisons placement (a 2019 like seen in
 * a 2026 crawl was asserted in 2026, not 2019). `undefined` when the payload
 * carries no `@assertedAt`; ingest materializes an implicit-now stamp into the
 * body for such payloads before this is recomputed, so a stored assertion always
 * has one, and a replica receiving an unstamped wire body rejects it.
 */
export function actionAssertedAt(payload: Record<string, unknown>): number | undefined {
  return parseInstant(payload['@assertedAt']);
}

// ---------------------------------------------------------------------------
// Precision ranges (fuzzy dates)
// ---------------------------------------------------------------------------
//
// A date is only ever known to some precision. "1949" pins the year but not the
// day; a full timestamp pins the instant. We carry that as a closed range
// `[lower, upper]` in epoch ms sized by precision — a year spans Jan 1 to Dec 31,
// an instant collapses to a point. Two sightings of the same date *intersect*
// (max of the lowers, min of the uppers): a coarse year and a precise day narrow
// to the day, order-independently. A precise value outside a coarser one yields
// an empty intersection — a conflict to surface, never silently overwrite.

export type DatePrecision = 'year' | 'month' | 'day' | 'instant';

/** A closed epoch-ms interval `[lower, upper]`; `lower === upper` is a point. */
export interface DateRange {
  lower: number;
  upper: number;
  /** the coarsest precision that produced this range (informational) */
  precision: DatePrecision;
}

const YEAR_RE = /^(-?\d{4,})$/;
const MONTH_RE = /^(-?\d{4,})-(\d{2})$/;
const DAY_RE = /^(-?\d{4,})-(\d{2})-(\d{2})$/;

/** End of the UTC interval `[start, nextStart)` as an inclusive ms bound. */
function endOf(nextStartMs: number): number {
  return nextStartMs - 1;
}

/**
 * Parse a date of any precision into the closed range it denotes. A bare year/
 * month/day widens to the whole period; anything with a time component (or an
 * epoch number) is an instant (lower === upper). `undefined` when unparseable.
 *
 * Deterministic and UTC — no wall-clock reads — so the range is a pure function
 * of the input, like the rest of this module.
 */
export function parseDateRange(value: unknown): DateRange | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { lower: value, upper: value, precision: 'instant' }
      : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const s = value.trim();

  const day = DAY_RE.exec(s);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const lower = Date.UTC(y, m - 1, d);
    const upper = endOf(Date.UTC(y, m - 1, d + 1));
    if (Number.isNaN(lower)) return undefined;
    return { lower, upper, precision: 'day' };
  }

  const month = MONTH_RE.exec(s);
  if (month) {
    const [y, m] = [Number(month[1]), Number(month[2])];
    if (m < 1 || m > 12) return undefined;
    const lower = Date.UTC(y, m - 1, 1);
    const upper = endOf(Date.UTC(y, m, 1));
    if (Number.isNaN(lower)) return undefined;
    return { lower, upper, precision: 'month' };
  }

  const year = YEAR_RE.exec(s);
  if (year) {
    const y = Number(year[1]);
    const lower = Date.UTC(y, 0, 1);
    const upper = endOf(Date.UTC(y + 1, 0, 1));
    if (Number.isNaN(lower)) return undefined;
    return { lower, upper, precision: 'year' };
  }

  // Anything else with a time component: a full instant (point range).
  const instant = parseInstant(s);
  return instant === undefined
    ? undefined
    : { lower: instant, upper: instant, precision: 'instant' };
}

/** The finer of two precisions (used to label a narrowed range). */
function finer(a: DatePrecision, b: DatePrecision): DatePrecision {
  const order: DatePrecision[] = ['year', 'month', 'day', 'instant'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/**
 * Intersect two precision ranges. Refinement (a year meeting a day inside it)
 * narrows to the tighter range; the result carries the finer precision. Returns
 * `null` when the ranges do not overlap — a genuine conflict (e.g. "1949" vs a
 * 1950 day) the caller should surface rather than coerce. Commutative and
 * associative, so a chain of sightings converges regardless of arrival order.
 */
export function intersectRanges(a: DateRange, b: DateRange): DateRange | null {
  const lower = Math.max(a.lower, b.lower);
  const upper = Math.min(a.upper, b.upper);
  if (lower > upper) return null;
  return { lower, upper, precision: finer(a.precision, b.precision) };
}

/**
 * Fold a set of asserted date ranges into one resolved range by successive
 * intersection. Order-independent. Returns `{ range }` on agreement (possibly
 * narrowed), or `{ conflict: [a, b] }` naming the first incompatible pair — the
 * empty-intersection case §4 of the design requires be surfaced, not coerced.
 */
export function resolveDateRanges(
  ranges: DateRange[]
): { range: DateRange } | { conflict: [DateRange, DateRange] } | undefined {
  // Sort by lower bound so the conflicting pair reported is deterministic
  // (content-ordered, never arrival-ordered).
  const sorted = [...ranges].sort((x, y) => x.lower - y.lower || x.upper - y.upper);
  let acc: DateRange | undefined;
  for (const r of sorted) {
    if (!acc) {
      acc = r;
      continue;
    }
    const next = intersectRanges(acc, r);
    if (next === null) return { conflict: [acc, r] };
    acc = next;
  }
  return acc ? { range: acc } : undefined;
}

/** Zero-pad a number's magnitude to a fixed width (sign handled by the caller). */
function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/**
 * Render a resolved range back to the coarsest lexical form it denotes — the
 * inverse of {@link parseDateRange}, for serializing an occurrence's time back
 * to the scalar a source wrote. A whole-year span → `"1949"`, a whole month →
 * `"1949-03"`, a whole day → `"1949-03-03"`, a point → the full ISO instant.
 * Anything that isn't a clean civil period falls back to the lower instant.
 */
export function formatDateRange(lower: number, upper: number): string {
  if (lower === upper) return formatInstant(lower);
  const d = new Date(lower);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth(); // 0-based
  const day = d.getUTCDate();
  const yStr = (y < 0 ? '-' : '') + pad(y, 4);
  if (mo === 0 && day === 1 && upper === Date.UTC(y + 1, 0, 1) - 1) return yStr;
  if (day === 1 && upper === Date.UTC(y, mo + 1, 1) - 1) return `${yStr}-${pad(mo + 1)}`;
  if (upper === Date.UTC(y, mo, day + 1) - 1) return `${yStr}-${pad(mo + 1)}-${pad(day)}`;
  return formatInstant(lower);
}

// ---------------------------------------------------------------------------
// Relative dates: `-7d`, `today`, `last-week` — resolved against an
// injected `now`, never a wall-clock read, so callers stay deterministic. All
// boundaries are UTC, like every other date in this module. Calendar words
// carry their natural precision so comparator rounding behaves exactly as it
// does for written partial dates (`last-month` IS a month).
// ---------------------------------------------------------------------------

const RELATIVE_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Resolve a relative date word against `now` (epoch ms). `-<n><unit>` is a
 * trailing instant (now minus the offset); the calendar words are whole
 * periods. Returns undefined for anything else.
 */
export function relativeDateRange(value: string, now: number): DateRange | undefined {
  const rel = /^-(\d+(?:\.\d+)?)([smhdw])$/.exec(value);
  if (rel !== null) {
    const t = now - Number(rel[1]) * RELATIVE_UNIT_MS[rel[2]];
    return { lower: t, upper: t, precision: 'instant' };
  }

  const d = new Date(now);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const dayRange = (offset: number): DateRange => ({
    lower: Date.UTC(y, mo, day + offset),
    upper: endOf(Date.UTC(y, mo, day + offset + 1)),
    precision: 'day',
  });
  // ISO weeks: Monday-start, UTC.
  const monday = day - ((d.getUTCDay() + 6) % 7);
  const weekRange = (offsetWeeks: number): DateRange => ({
    lower: Date.UTC(y, mo, monday + offsetWeeks * 7),
    upper: endOf(Date.UTC(y, mo, monday + (offsetWeeks + 1) * 7)),
    precision: 'day',
  });
  const monthRange = (offset: number): DateRange => ({
    lower: Date.UTC(y, mo + offset, 1),
    upper: endOf(Date.UTC(y, mo + offset + 1, 1)),
    precision: 'month',
  });
  const yearRange = (offset: number): DateRange => ({
    lower: Date.UTC(y + offset, 0, 1),
    upper: endOf(Date.UTC(y + offset + 1, 0, 1)),
    precision: 'year',
  });

  switch (value) {
    case 'today': {
      return dayRange(0);
    }
    case 'yesterday': {
      return dayRange(-1);
    }
    case 'this-week': {
      return weekRange(0);
    }
    case 'last-week': {
      return weekRange(-1);
    }
    case 'this-month': {
      return monthRange(0);
    }
    case 'last-month': {
      return monthRange(-1);
    }
    case 'this-year': {
      return yearRange(0);
    }
    case 'last-year': {
      return yearRange(-1);
    }
    default: {
      return undefined;
    }
  }
}
