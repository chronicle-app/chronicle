/**
 * A listen's key, the same from the API and a data download: what played,
 * and the second it stopped. Newer downloads don't name the account, so the
 * key doesn't either.
 */
export const LISTEN_KEY = ['@type', 'source', 'object.sourceId', 'timestamp'];

/** The second a time falls in, as Spotify's data download writes it. */
export function toSecond(time: string | Date): Date {
  return new Date(Math.floor(new Date(time).getTime() / 1000) * 1000);
}
