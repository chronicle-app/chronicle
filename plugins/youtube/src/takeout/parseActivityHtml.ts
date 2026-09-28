/**
 * Parser for Google Takeout "My Activity" HTML files (watch-history.html,
 * search-history.html). The file is machine-generated Material Design Lite
 * markup: one `outer-cell` div per activity entry, whose first body cell
 * carries a verb ("Watched", "Searched for", …) followed by a non-breaking
 * space, the linked title/query, an optional channel link, and a rendered
 * local-time date line; a caption cell carries provenance, including the
 * "From Google Ads" marker on ad impressions.
 *
 * Timestamps are rendered in the account's timezone with a single fixed
 * abbreviation for the whole file (e.g. every stamp `EDT`), so parsing maps
 * the abbreviation to its UTC offset and reconstructs the instant.
 */

import { decodeEntities } from '@chronicle.app/etl';

export interface ActivityEntry {
  verb: string;
  /** First link's text — the video title or the search query. */
  titleText?: string;
  /** First link's href — the watch URL or the results URL. */
  titleHref?: string;
  channelName?: string;
  channelId?: string;
  time: Date;
  /** "From Google Ads" in the caption cell — an ad impression, not activity. */
  isAd: boolean;
}

// Google's renderer separates tokens with U+00A0 (and in newer exports
// U+202F before AM/PM) rather than plain spaces.
const SPACERS = /[\u00A0\u202F]/g;

const BODY_CELL =
  /<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/;
const CAPTION_CELL = /mdl-typography--caption">([\s\S]*?)<\/div>/;
const LINK = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
const DATE_LINE =
  /([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}[\u00A0\u202F ]?(?:AM|PM)[\u00A0\u202F ][A-Z]{2,5})(?:<br|$)/g;
const CHANNEL_ID_IN_URL = /\/channel\/([^/?#"]+)/;
const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
// North-American + UTC abbreviations Google renders My Activity in. An
// unmapped abbreviation throws rather than silently misplacing a history.
const TZ_OFFSET_MINUTES: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  NST: -210,
  NDT: -150,
  AST: -240,
  ADT: -180,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AKST: -540,
  AKDT: -480,
  HST: -600,
};

/** Decoded link/verb text, with layout non-breaking spaces normalized. */
function cleanText(text: string): string {
  return decodeEntities(text).replaceAll(SPACERS, ' ');
}

export function parseActivityDate(text: string): Date {
  const normalized = text.replaceAll(SPACERS, ' ');
  const match = normalized.match(
    /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) ([A-Z]{2,5})$/
  );
  if (!match) {
    throw new Error(`Unparseable My Activity timestamp: "${text}"`);
  }
  const [, mon, day, year, hour, minute, second, meridiem, tz] = match;
  const offset = TZ_OFFSET_MINUTES[tz];
  if (offset === undefined) {
    throw new Error(`Unknown timezone abbreviation "${tz}" in "${text}"`);
  }
  let h = Number(hour) % 12;
  if (meridiem === 'PM') h += 12;
  const utc = Date.UTC(Number(year), MONTHS[mon], Number(day), h, Number(minute), Number(second));
  return new Date(utc - offset * 60_000);
}

export function parseActivityHtml(html: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const cell of html.split('<div class="outer-cell').slice(1)) {
    const body = cell.match(BODY_CELL)?.[1];
    if (!body) continue;

    const verb = cleanText(body.match(/^([^<]*)/)?.[1] ?? '').trim();

    // The date line is the body's last text segment; ad entries carry earlier
    // time-like segments ("Watched at 8:33 AM") that lack a date and don't
    // match the full pattern — take the last full match.
    let dateText: string | undefined;
    for (const match of body.matchAll(DATE_LINE)) dateText = match[1];
    if (!dateText) continue;

    const links = [...body.matchAll(LINK)];
    const [firstHref, firstText] = links[0] ? [links[0][1], links[0][2]] : [];
    const channelLink = links.slice(1).find(link => CHANNEL_ID_IN_URL.test(link[1]));

    entries.push({
      verb,
      ...(firstHref !== undefined && {
        titleHref: decodeEntities(firstHref),
        titleText: cleanText(firstText ?? ''),
      }),
      ...(channelLink && {
        channelName: cleanText(channelLink[2]),
        channelId: channelLink[1].match(CHANNEL_ID_IN_URL)?.[1],
      }),
      time: parseActivityDate(dateText),
      isAd: (cell.match(CAPTION_CELL)?.[1] ?? '').includes('From Google Ads'),
    });
  }

  return entries;
}

/** The 11-char video id from a watch URL (www or music host). */
export function videoIdFromUrl(url: string): string | undefined {
  return url.match(/[?&]v=([\w-]{11})/)?.[1];
}
