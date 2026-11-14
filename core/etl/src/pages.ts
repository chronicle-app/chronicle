import type { Entity, Post } from '@chronicle.app/schema';

/**
 * A post's page on X, under any handle, or X's own `i/status` and
 * `i/web/status` with none, and with or without one of its photos or videos
 * open: on x.com or twitter.com, or in the old `#!/` form. Not its pages of
 * likes, quotes, or analytics, which are about it. The query and fragment
 * don't matter.
 */
const X_POST_PAGE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?(?:\w+\/status(?:es)?|i\/web\/status)\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?(?:[?#]|$)/i;

/**
 * A web page, by its address, as a browser's history or a bookmark has it.
 * Pages merge on the exact address, because a missed merge can be fixed and a
 * wrong one can't. A page whose address holds the id of the thing it shows,
 * so that no other thing has it, is also `sameAs` that thing: a post on X,
 * under whatever handle the address has.
 */
export function webPage(url: string): Entity {
  const same = shownOn(url);
  return { '@type': 'Entity', '@key': ['url'], url, ...(same && { sameAs: [same] }) };
}

/**
 * A post on X by its id, keyed as the Twitter plugin keys it. Its pages are
 * this post, whatever handle they're under: its author's now, one they had
 * before, or none.
 */
export function xPost(id: string): Post {
  return {
    '@type': 'Post',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'twitter',
    sourceId: id,
  };
}

/** The thing a page shows, when its address says by its id. */
function shownOn(url: string): Post | undefined {
  const post = url.match(X_POST_PAGE);
  return post ? xPost(post[1]) : undefined;
}
