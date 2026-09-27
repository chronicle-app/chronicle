import { MovesTime } from './types.js';

// Moves writes times in the ISO 8601 *basic* format — "20140510T134349-0300"
// (local wall clock plus the offset it was read at) or "20141021T042519Z".
// JavaScript's Date only parses the extended format, so the separators go back
// in before parsing. The offset is part of the string, so the instant is exact
// and does not depend on where the import runs.
const BASIC_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})$/;

export function parseMovesTime(value: MovesTime): Date | undefined {
  const match = BASIC_TIME.exec(value);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second, zone] = match;
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// The same instant as an ISO string, which is what the payload carries and what
// the dedupe keysets hash. A segment has no id in the export, so its start is
// its identity — the value has to be a plain string, spelled the same way on
// every run and every replica.
export function movesTimeToIso(value: MovesTime): string | undefined {
  return parseMovesTime(value)?.toISOString();
}

// The "YYYYMMDD" day key a daily storyline file is named for.
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

// A day key shifted by whole days, used to widen a since/until window before it
// is applied to file names. A file is named for the *local* day it covers, and
// the window is given as UTC, so the two disagree by up to a day at the edges.
// The exact filter is the per-segment start-time check; this one only decides
// which files are worth opening, so it errs one day wide on each side.
export function shiftDayKey(key: string, days: number): string {
  const ms = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8))
  );
  return dayKey(new Date(ms + days * 86_400_000));
}
