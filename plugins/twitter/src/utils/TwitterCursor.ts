/**
 * X's paging tokens for likes and bookmarks, which X doesn't document. A
 * token is the text `NEXT_TOKEN<n>` written as a base-36 number, where `n`
 * is the like or bookmark time of the page's last post, in milliseconds,
 * shifted left 20 bits with 20 more bits below it. A token asks for the posts
 * liked or bookmarked before that time, so one made from any time works too.
 */

const PREFIX = 'NEXT_TOKEN';
/** The time sits above 20 more bits. */
const SCALE = 2n ** 20n;

/** Before X existed, so no like or bookmark can be this old. */
const EARLIEST = Date.parse('2006-03-21T00:00:00Z');

/**
 * When the last post on a page was liked or bookmarked, from the token for
 * the next page; undefined for a token that doesn't read this way.
 */
export function cursorTime(token: string | undefined): Date | undefined {
  if (!token || !/^[0-9a-z]+$/.test(token)) return undefined;
  let n = 0n;
  for (const char of token) n = n * 36n + BigInt(Number.parseInt(char, 36));
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const match = /^NEXT_TOKEN(\d+)$/.exec(Buffer.from(hex, 'hex').toString('latin1'));
  if (!match) return undefined;
  const ms = Number(BigInt(match[1]) / SCALE);
  return ms >= EARLIEST && ms <= Date.now() + 24 * 60 * 60 * 1000 ? new Date(ms) : undefined;
}

/** A token for the posts liked or bookmarked before `ms`. */
export function cursorBefore(ms: number): string {
  const text = `${PREFIX}${BigInt(ms) * SCALE}`;
  return BigInt(`0x${Buffer.from(text, 'latin1').toString('hex')}`).toString(36);
}
