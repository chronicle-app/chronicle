import type { ApiTweet, TwitterApi } from './TwitterApi.js';
import { cursorBefore, cursorTime } from './TwitterCursor.js';

/** A post you liked or bookmarked, and when, as closely as X's paging tells. */
export interface TimedPost {
  tweet: ApiTweet;
  /**
   * When you liked or bookmarked it, an instant: to the millisecond when a
   * paging token gave it, to the second when searched for.
   */
  at?: string;
  /** Without `at`, the stretch it happened in: two instants joined by `/`. */
  during?: string;
}

export interface TimedListOptions {
  /** The smallest page the endpoint accepts. */
  minPageSize: number;
  /** The page size when X's tokens carry no times, so pages may as well be full. */
  fullPageSize: number;
  params: Record<string, string>;
  since?: Date;
  until?: Date;
  warn: (message: string) => void;
}

const SECOND = 1000;
/** The slack for a post's `created_at`, which X gives to the second. */
const POSTED_SLACK_MS = SECOND;
/** How far ahead of this machine's clock X's may be. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Before X existed, so nothing was liked or bookmarked earlier. */
const EARLIEST = Date.parse('2006-03-21T00:00:00Z');
/** The most requests a search spends on one post: 2^40 seconds outlasts X. */
const STEPS_PER_POST = 40;

type Page = { items: ApiTweet[]; next?: string };

/** What's known of when one post was liked or bookmarked. */
interface Slot {
  tweet: ApiTweet;
  /** It happened at or after this, in ms… */
  lo: number;
  /** …and before this. */
  hi: number;
  /** When, to the millisecond, from a paging token. */
  exact?: number;
  /** A search for it came to nothing, so it keeps its stretch. */
  failed?: boolean;
}

/**
 * Your likes or bookmarks, most recent first, each with the time you liked
 * or bookmarked it, found from X's paging (see `TwitterCursor`).
 *
 * A page's token holds the time of its last post, so plain paging times
 * every `minPageSize`th post, to the millisecond. A post in between gets its
 * time from one more request: a token made just after the post
 * `minPageSize - 1` above it starts a page there, so the post comes last on
 * it. The few posts at the top have nothing above them to start a page
 * from, so a search finds their times: a token made for any moment returns
 * the posts from before it, which says which side of that moment each post
 * is on, and halving the stretch a post is in gets it to the second in a
 * dozen or so requests for an hour. With `since`, the search splits there
 * first, and posts from before it are left alone, so a poll spends its
 * requests only on what's new.
 */
export async function* timedList(
  api: TwitterApi,
  path: string,
  options: TimedListOptions
): AsyncGenerator<TimedPost> {
  const { minPageSize: size, since, until } = options;
  const floor = since?.getTime() ?? Number.NEGATIVE_INFINITY;
  const top = until ? until.getTime() : Date.now() + CLOCK_SKEW_MS;
  const slots: Slot[] = [];
  const position = new Map<string, number>();
  let warned = false;

  /** Narrow post `k`'s stretch, and so those above and below it. */
  const narrow = (k: number, lo: number, hi: number) => {
    const slot = slots[k];
    slot.lo = Math.max(slot.lo, lo);
    slot.hi = Math.min(slot.hi, hi);
    for (let j = k - 1; j >= 0 && slots[j].lo < slot.lo; j--) slots[j].lo = slot.lo;
    for (let j = k + 1; j < slots.length && slots[j].hi > slot.hi; j++) slots[j].hi = slot.hi;
  };

  /** Take the time a page's token gives its last post, if it holds up. */
  const learn = (page: Page) => {
    const last = page.items.at(-1);
    const time = cursorTime(page.next)?.getTime();
    const k = last && position.get(last.id);
    if (time === undefined || k === undefined || slots[k].exact !== undefined) return;
    if (time < slots[k].lo || time >= slots[k].hi) {
      if (!warned) {
        options.warn('Some like or bookmark times from X don’t add up, so they’re left out');
        warned = true;
      }
      return;
    }
    slots[k].exact = time;
    narrow(k, time, time + 1);
  };

  const read = (token: string | undefined, pageSize = size) =>
    api.page<ApiTweet>(path, { ...options.params, max_results: String(pageSize) }, token);

  /**
   * A page from a token made here. X doesn't document these, so one it
   * refuses leaves the post untimed rather than ending the run.
   */
  const tryRead = async (token: string): Promise<Page | undefined> => {
    let page: Page | undefined;
    try {
      page = await read(token);
    } catch (error) {
      if ((error as { code?: string }).code) throw error;
      if (!warned) {
        options.warn('X refused a request for like or bookmark times, so some are left out');
        warned = true;
      }
    }
    return page;
  };

  /** Halve the stretches of posts `ks` until each is within a second. */
  const search = async (ks: number[]) => {
    const open = () =>
      ks.filter(k => {
        const slot = slots[k];
        return (
          !slot.failed &&
          slot.exact === undefined &&
          secondOf(slot) === undefined &&
          slot.hi > floor
        );
      });
    for (let step = 0; ; step++) {
      const todo = open();
      if (todo.length === 0) return;
      if (step >= STEPS_PER_POST * ks.length) {
        for (const k of todo) slots[k].failed = true;
        return;
      }
      // Split at `since` first, so what's older is out of the search.
      const straddling = todo.find(k => slots[k].lo < floor && floor < slots[k].hi);
      let moment: number;
      if (straddling === undefined) {
        const widest = todo.reduce((a, b) => (width(slots[b]) > width(slots[a]) ? b : a));
        const { lo, hi } = seconds(slots[widest]);
        moment = Math.floor((lo + hi) / 2 / SECOND) * SECOND;
      } else {
        moment = floor;
      }

      const page = await tryRead(cursorBefore(moment));
      if (!page) {
        for (const k of todo) slots[k].failed = true;
        return;
      }
      learn(page);
      // The first post the page returns is the newest from before the moment.
      const first = page.items[0] && position.get(page.items[0].id);
      const boundary = first ?? slots.length;
      if (boundary > 0) narrow(boundary - 1, moment, Number.POSITIVE_INFINITY);
      if (boundary < slots.length) narrow(boundary, Number.NEGATIVE_INFINITY, moment);
      for (const k of todo) if (slots[k].lo >= slots[k].hi) slots[k].failed = true;
    }
  };

  let token = until ? cursorBefore(top) : undefined;
  let timed = true;
  for (;;) {
    const page = await read(token, timed ? size : options.fullPageSize);
    if (page.items.length === 0) return;
    if (slots.length === 0 && page.next && !cursorTime(page.next)) {
      timed = false;
      options.warn('X’s paging no longer gives like and bookmark times, so they’re left out');
    }

    const start = slots.length;
    for (const tweet of page.items) {
      const k = slots.length;
      const posted = tweet.created_at ? Date.parse(tweet.created_at) - POSTED_SLACK_MS : EARLIEST;
      slots.push({ tweet, lo: EARLIEST, hi: k > 0 ? slots[k - 1].hi : top });
      position.set(tweet.id, k);
      narrow(k, posted, Number.POSITIVE_INFINITY);
    }
    const ks = slots.map((_, k) => k).slice(start);

    if (timed) {
      learn(page);
      // Each post in between: a page that ends on it.
      if (size > 1) {
        for (const k of ks) {
          if (slots[k].exact !== undefined || slots[k].hi <= floor) continue;
          const shifted = shiftedToken(slots, k, size);
          const shiftedPage = shifted && (await tryRead(shifted));
          if (shiftedPage) learn(shiftedPage);
        }
      }
      // What that left untimed: the top of the list, and any page that
      // didn't line up.
      await search(ks.filter(k => slots[k].exact === undefined));
    }

    for (const k of ks) {
      const slot = slots[k];
      if (!timed) {
        yield { tweet: slot.tweet };
        continue;
      }
      if (slot.hi <= floor) return;
      if (slot.exact !== undefined) {
        if (slot.exact < floor) return;
        yield { tweet: slot.tweet, at: new Date(slot.exact).toISOString() };
        continue;
      }
      const second = secondOf(slot);
      if (second !== undefined) {
        if (second + SECOND <= floor) return;
        yield { tweet: slot.tweet, at: new Date(second).toISOString().replace('.000Z', 'Z') };
        continue;
      }
      yield slot.lo < slot.hi
        ? {
            tweet: slot.tweet,
            during: `${new Date(slot.lo).toISOString()}/${new Date(slot.hi).toISOString()}`,
          }
        : { tweet: slot.tweet };
    }

    if (!page.next) return;
    token = page.next;
  }
}

function width(slot: Slot): number {
  return slot.hi - slot.lo;
}

/** A slot's stretch out to whole seconds. */
function seconds(slot: Slot): { lo: number; hi: number } {
  return {
    lo: Math.floor(slot.lo / SECOND) * SECOND,
    hi: Math.ceil(slot.hi / SECOND) * SECOND,
  };
}

/** The second a slot's stretch is within, if it's down to one. */
function secondOf(slot: Slot): number | undefined {
  const { lo, hi } = seconds(slot);
  return hi - lo <= SECOND ? lo : undefined;
}

/**
 * A token for the page whose last post is the `k`th: just after the post
 * that page starts with, or at the post just above it, whichever is known.
 */
function shiftedToken(slots: Slot[], k: number, size: number): string | undefined {
  const first = slots[k - size + 1];
  if (first && (first.exact !== undefined || secondOf(first) !== undefined)) {
    return cursorBefore(first.hi);
  }
  const above = slots[k - size];
  if (above && (above.exact !== undefined || secondOf(above) !== undefined)) {
    return cursorBefore(above.lo);
  }
  return undefined;
}
