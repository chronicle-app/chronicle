/**
 * Clean-up for text a source wrote for a screen, once it's plain text or
 * Markdown: what a reader never sees, and links that only track a click.
 * For the body of a message, an event's description, a feed item.
 */

/**
 * Characters that show as nothing: the fillers and soft hyphens newsletters
 * pad their inbox preview with. The joiners and direction marks a script or
 * an emoji needs (U+200C, U+200D, U+200E, U+200F, U+061C) aren't among them.
 * An alternation, not a character class: several are combining marks, which
 * in a class would join their neighbour.
 */
const INVISIBLE = new RegExp(
  [
    '\u00AD',
    '\u034F',
    '\u115F',
    '\u1160',
    '\u17B4',
    '\u17B5',
    '\u180E',
    '\u200B',
    '\u2060',
    '\u2061',
    '\u2062',
    '\u2063',
    '\u2064',
    '\u3164',
    '\uFEFF',
    '\uFFA0',
  ].join('|'),
  'g'
);

/** Text without characters that show as nothing. */
export const withoutInvisible = (text: string) => text.replaceAll(INVISIBLE, '');

/** A query parameter that only says where a click came from, with what joins it. */
const TRACKING =
  /([?&])(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|yclid|igshid)=[^&#\s)\]]*/gi;

/**
 * Past this, a link in bulk mail is a click-tracking redirect, opaque and
 * single-use: about a third of a newsletter's text. Real links can be this
 * long too (a meeting's join link), so only a caller that knows the text is
 * bulk drops them.
 */
const LONGEST_URL = 200;

const URL_IN_TEXT = /(?:https?|mailto):[^\s<>()\]]+/g;

/** A URL without its tracking parameters, and without the `?` or `&` they leave behind. */
export function withoutTracking(url: string): string {
  return url
    .replaceAll(TRACKING, '$1')
    .replaceAll(/([?&])&+/g, '$1')
    .replace(/[?&]+$/, '');
}

/**
 * Plain text or Markdown made fit to keep: no padding characters, no
 * tracking parameters on links, no trailing spaces, and at most one blank
 * line in a row. With `dropLongUrls`, for bulk mail, click-tracking redirect
 * URLs go too, and a Markdown link keeps its words.
 */
export function tidyText(text: string, { dropLongUrls = false } = {}): string {
  const tracked = withoutInvisible(text).replaceAll(URL_IN_TEXT, url => withoutTracking(url));
  const kept = dropLongUrls
    ? tracked
        .replaceAll(/\[([^\]]*)\]\(([^)\s]+)\)/g, (link, label: string, url: string) =>
          url.length > LONGEST_URL ? label : link
        )
        .replaceAll(URL_IN_TEXT, url => (url.length > LONGEST_URL ? '' : url))
    : tracked;
  return kept
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}
