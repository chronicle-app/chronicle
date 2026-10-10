/**
 * Chrome epoch timestamp utilities.
 *
 * Chromium stores times (History `visits.visit_time`, `urls.last_visit_time`)
 * as microseconds since January 1, 1601 00:00:00 UTC, the Windows FILETIME
 * epoch. Unix timestamps count from January 1, 1970 00:00:00 UTC. The
 * difference is 11,644,473,600 seconds.
 *
 * Current Chrome times exceed Number.MAX_SAFE_INTEGER, so `node:sqlite` throws
 * ERR_OUT_OF_RANGE when reading them as numbers. Convert in SQL with
 * `chromeToUnixMsSql(column)`, or read with `statement.setReadBigInts(true)`.
 */

export const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;

/**
 * A SQL expression converting a Chrome time column to Unix milliseconds
 * (integer division, so sub-millisecond precision is dropped).
 * @param column A trusted, developer-supplied column name
 */
export function chromeToUnixMsSql(column: string): string {
  return `(${column} / 1000 - ${CHROME_EPOCH_OFFSET_MS})`;
}

/**
 * Convert Unix milliseconds to a Chrome timestamp, for binding against a Chrome
 * time column. The result is exact until the year 3800 although it exceeds
 * Number.MAX_SAFE_INTEGER: it is a multiple of 1000, and so of 8, below 2^56.
 * @param unixMs Unix timestamp in milliseconds
 * @returns Chrome timestamp in microseconds since Jan 1, 1601
 */
export function unixMsToChromeTimestamp(unixMs: number): number {
  return (Math.floor(unixMs) + CHROME_EPOCH_OFFSET_MS) * 1000;
}
