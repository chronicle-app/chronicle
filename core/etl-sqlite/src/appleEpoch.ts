/**
 * Apple epoch timestamp utilities.
 *
 * Apple's Core Data / Core Foundation timestamps count from
 * January 1, 2001 00:00:00 UTC; Unix timestamps count from
 * January 1, 1970 00:00:00 UTC. The difference is 978,307,200 seconds.
 *
 * Two unit families appear in Apple SQLite stores:
 * - seconds since 2001 (Safari History.db, WhatsApp ChatStorage.sqlite,
 *   CallHistory.storedata, Podcasts MTLibrary.sqlite)
 * - nanoseconds since 2001 (Messages chat.db)
 */

export const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

/**
 * Convert an iOS timestamp to a Unix timestamp
 * @param iosTimestamp iOS timestamp (nanoseconds since Jan 1, 2001)
 * @returns Unix timestamp in milliseconds
 */
export function iosToUnixTimestamp(iosTimestamp: number): number {
  return (iosTimestamp / 1_000_000_000 + APPLE_EPOCH_OFFSET_SECONDS) * 1000;
}

/**
 * Convert a Unix timestamp to an iOS timestamp
 * @param unixTimestamp Unix timestamp in seconds
 * @returns iOS timestamp in nanoseconds
 */
export function unixToIosTimestamp(unixTimestamp: number): number {
  return (unixTimestamp - APPLE_EPOCH_OFFSET_SECONDS) * 1_000_000_000;
}

/**
 * Convert a Safari timestamp (seconds since 2001) to a Unix timestamp
 * @param safariTimestamp Safari timestamp in seconds since Jan 1, 2001
 * @returns Unix timestamp in seconds
 */
export function safariToUnixTimestamp(safariTimestamp: number): number {
  return safariTimestamp + APPLE_EPOCH_OFFSET_SECONDS;
}

/**
 * Convert a Unix timestamp to a Safari timestamp
 * @param unixTimestamp Unix timestamp in seconds
 * @returns Safari timestamp in seconds since Jan 1, 2001
 */
export function unixToSafariTimestamp(unixTimestamp: number): number {
  return unixTimestamp - APPLE_EPOCH_OFFSET_SECONDS;
}
