const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Every UTC offset in use is a whole number of quarter hours, from −12:00 to +14:00.
const QUARTER_HOUR = 15 * MINUTE;
const OFFSETS = Array.from({ length: 105 }, (_, i) => (i - 48) * QUARTER_HOUR);

const FITBIT_TIME = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * A time as Fitbit writes it, `MM/DD/YY HH:MM:SS`, as milliseconds since the
 * epoch, reading it as UTC. Heart rate, steps, and exercise logs are in UTC.
 * Weight logs write a local date and time this way, which comes back as the
 * wall clock read as UTC.
 */
export function fitbitTime(text: string): number {
  const match = FITBIT_TIME.exec(text);
  if (!match) throw new TypeError(`Not a Fitbit time: ${text}`);
  const [month, day, year, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(2000 + year, month - 1, day, hour, minute, second);
}

/** A local date and time without an offset, `2017-05-10T01:57:30.000`, as its wall clock read as UTC. */
export function wallTime(text: string): number {
  const ms = Date.parse(`${text.replace(/Z$/, '')}Z`);
  if (Number.isNaN(ms)) throw new TypeError(`Not a local time: ${text}`);
  return ms;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** How far the zone's clocks are ahead of UTC at an instant, in milliseconds. */
export function zoneOffset(zone: string, instant: number): number {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(zone, format);
  }
  const at = Math.floor(instant / 1000) * 1000;
  const part = Object.fromEntries(
    format.formatToParts(new Date(at)).map(({ type, value }) => [type, Number(value)])
  );
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return wall - at;
}

/**
 * The instant a wall clock in the zone showed. A time the clocks skipped
 * comes out an hour off, and one they showed twice comes out as either.
 */
export function zonedInstant(wall: number, zone: string): number {
  const guess = wall - zoneOffset(zone, wall);
  return wall - zoneOffset(zone, guess);
}

export function isTimeZone(zone: string): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** The first and last readings of one local day, as instants in milliseconds. */
export interface DayWindow {
  first: number;
  last: number;
}

/**
 * Turns the archive's local wall-clock times into instants. The archive
 * writes sleep and weight times without an offset. Each day's heart rate
 * file holds that local day's readings in UTC, so its first and last
 * readings bound the day's offset: midnight came at or before the first, and
 * the next midnight after the last. Where the profile's time zone fits those
 * bounds, its rules give the instant, DST included. Where it doesn't, such as
 * on a trip, the day's offset is the one that fits nearest the zone's.
 */
export class LocalClock {
  // For each local date, the offset to use, or null for the zone's rules.
  private rules = new Map<string, Promise<number | null>>();

  constructor(
    readonly zone: string,
    private windowOf: (date: string) => Promise<DayWindow | null>
  ) {}

  /** The instant a local wall-clock time was, given as its wall clock read as UTC. */
  async instant(wall: number): Promise<number> {
    const date = new Date(wall).toISOString().slice(0, 10);
    let rule = this.rules.get(date);
    if (!rule) {
      rule = this.ruleFor(date);
      this.rules.set(date, rule);
    }
    const offset = await rule;
    return offset === null ? zonedInstant(wall, this.zone) : wall - offset;
  }

  private async ruleFor(date: string): Promise<number | null> {
    const window = await this.windowOf(date);
    if (!window) return null;
    const midnight = Date.parse(`${date}T00:00:00Z`);
    const start = zonedInstant(midnight, this.zone);
    if (start <= window.first && zonedInstant(midnight + DAY, this.zone) > window.last) return null;
    // An offset o fits when midnight − o ≤ first and the next midnight − o > last.
    const zone = midnight - start;
    let best: number | null = null;
    for (const offset of OFFSETS) {
      if (midnight - offset > window.first || midnight + DAY - offset <= window.last) continue;
      if (best === null || Math.abs(offset - zone) < Math.abs(best - zone)) best = offset;
    }
    return best;
  }
}
