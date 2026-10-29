import type { SpotifySearch } from './types.js';

/** Trimmed text, or none for an empty string or another type. */
export function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The day a `YYYY-MM-DD` date names, as the instant it starts in UTC; none for anything else. */
export function dayOf(date: unknown): Date | undefined {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const day = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? undefined : day;
}

/** When a search was made: its `searchTime` without the zone Spotify writes after it, like `[UTC]`. */
export function searchedAt(search: SpotifySearch): Date | undefined {
  if (typeof search.searchTime !== 'string') return undefined;
  const time = new Date(search.searchTime.replace(/\[[^\]]*\]$/, ''));
  return Number.isNaN(time.getTime()) ? undefined : time;
}
