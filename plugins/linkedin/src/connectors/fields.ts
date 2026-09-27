/**
 * Field readers shared by the extractors: the identity hiding in a LinkedIn
 * profile URL, and the seven date formats one export manages to use.
 *
 * Everything here returns what LinkedIn actually wrote, at the precision it
 * wrote it. Nothing invents a value it was not given — a date the source knows
 * only to the month stays a month, and an unparseable one comes back undefined
 * rather than as a guess.
 */

/**
 * The vanity slug out of a member profile URL — LinkedIn's own public handle
 * for a person, and the only identifier the CSVs carry for anyone but you.
 *
 * The export writes the URL three ways: with a scheme (`Connections.csv`),
 * without one (`Endorsement_*.csv`), and with tracking params glued on when the
 * member pasted it out of the mobile app. All three name the same slug.
 *
 * **The slug is not stable.** A member can change their vanity URL, and when
 * they do a later export calls them someone new. It is still the best
 * identifier LinkedIn gives us — the numeric member id never appears in an
 * export — so it is what we key on, with the weakness recorded here.
 */
export function profileHandle(rawUrl: string | undefined): string | undefined {
  const url = rawUrl?.trim();
  if (!url) return undefined;
  const match = /\/in\/([^/?#\s]+)/.exec(url);
  const slug = match?.[1]?.trim();
  return slug ? decodeURIComponent(slug) : undefined;
}

/** The canonical public profile URL for a slug, however the export spelled it. */
export function profileUrl(handle: string): string {
  return `https://www.linkedin.com/in/${handle}`;
}

/**
 * What LinkedIn prints instead of a name for a member you are not allowed to
 * see. It appears across the export — as a message sender, as a recipient —
 * and it is a placeholder, not a name.
 */
const PRIVATE_MEMBER = 'LinkedIn Member';

/**
 * A display name, or nothing when the export withheld one.
 *
 * The private-member placeholder is treated as absent rather than as a name.
 * Keying people on it would collapse every stranger LinkedIn hid from you into
 * a single person who does not exist.
 */
export function memberName(raw: string | undefined): string | undefined {
  const name = raw?.trim();
  return !name || name === PRIVATE_MEMBER ? undefined : name;
}

/**
 * `2026-08-05 19:29:58 UTC` (messages) and `2020-12-29 14:24 UTC` (learning) —
 * an ISO-ish stamp with a trailing zone word instead of an offset.
 */
export function parseSpaceStamp(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value === 'N/A') return undefined;
  const iso = value.replace(' UTC', 'Z').replace(' ', 'T');
  return isoOrUndefined(iso);
}

/** `2017/05/07 01:01:57 UTC` — the endorsement files' slash-dated stamp. */
export function parseSlashStamp(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const iso = value.replaceAll('/', '-').replace(' UTC', 'Z').replace(' ', 'T');
  return isoOrUndefined(iso);
}

/** `Fri Jan 24 02:54:41 UTC 2025` — the follow files' `Date.toString()` shape. */
export function parseLongStamp(raw: string | undefined): string | undefined {
  return isoOrUndefined(raw?.trim());
}

/**
 * `06 Jun 2026` — a connection date. LinkedIn records the day, not the moment,
 * so this stays a day-precision civil date rather than being widened to
 * midnight UTC.
 */
export function parseDayDate(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const match = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
}

/**
 * `Aug 2022`, or a bare `2009` — a position or education boundary. LinkedIn
 * only ever asks for the month, and for older entries only the year, so the
 * result carries that precision: `2022-08` and `2009`. The store parses each at
 * its own precision, which is why widening them to a day would be a lie.
 */
export function parseCoarseDate(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^\d{4}$/.test(value)) return value;
  const match = /^([A-Za-z]{3,})\s+(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  return month ? `${match[2]}-${month}` : undefined;
}

const MONTHS: { [abbrev: string]: string } = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
