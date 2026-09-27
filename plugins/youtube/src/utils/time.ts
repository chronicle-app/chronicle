/**
 * YouTube reports the same instant at different precisions on different
 * surfaces: the Data API carries milliseconds where Takeout carries whole
 * seconds. Every timestamp the plugin emits is truncated to the second — the
 * shared precision — so same-key assertions from the two paths land on one
 * instant instead of a millisecond-inverted occurrence range.
 */
export function ytTime(value: string | number | Date): Date {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    throw new TypeError(`Invalid YouTube timestamp: ${String(value)}`);
  }
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** Takeout's videos.csv reports duration in milliseconds; the schema (like the
 * Data API) carries ISO-8601 durations. */
export function msToIsoDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  let out = 'PT';
  if (hours) out += `${hours}H`;
  if (minutes) out += `${minutes}M`;
  if (seconds || out === 'PT') out += `${seconds}S`;
  return out;
}
