import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TwitterApi } from '../dist/utils/TwitterApi.js';

/**
 * The files of a small synthetic Twitter/X data archive, by their paths in
 * it: the account, two tweets (one with entity mentions, links, and a hashtag, one
 * relying on the text fallback), a like, a 1:1 DM, and a group DM with its
 * header.
 */
export function archiveFiles() {
  const files = {};
  /** One `data/<file>.js` in the archive's `window.YTD.<name>.part0 = [...]` form. */
  const writeYtd = (file, name, items) => {
    files[`data/${file}.js`] = `window.YTD.${name}.part0 = ${JSON.stringify(items, null, 2)}`;
  };

  writeYtd('account', 'account', [
    {
      account: {
        email: 'owner@example.com',
        createdVia: 'web',
        username: 'owner_example',
        accountId: '111',
        createdAt: '2020-01-01T00:00:00.000Z',
        accountDisplayName: 'Owner Example',
      },
    },
  ]);

  writeYtd('tweets', 'tweets', [
    {
      tweet: {
        created_at: 'Sat Jan 11 17:10:28 +0000 2025',
        id_str: '1234567890123456789',
        full_text: 'Trail notes with @alex_example #Hiking https://t.co/abc123',
        favorite_count: '3',
        retweet_count: '1',
        in_reply_to_status_id_str: null,
        in_reply_to_user_id_str: null,
        entities: {
          hashtags: [{ text: 'Hiking', indices: ['31', '38'] }],
          symbols: [],
          user_mentions: [{ name: 'Alex Example', screen_name: 'alex_example', id_str: '222' }],
          urls: [
            {
              url: 'https://t.co/abc123',
              expanded_url: 'https://example.com/trail-notes',
            },
          ],
        },
        source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
        retweeted: false,
      },
    },
    {
      tweet: {
        created_at: 'Fri Jan 10 09:00:00 +0000 2025',
        id_str: '1234567890123456788',
        full_text: 'Hi @sam_example, see https://example.com/map. https://t.co/pic',
        favorite_count: '0',
        retweet_count: '0',
        entities: {
          hashtags: [],
          symbols: [],
          user_mentions: [],
          urls: [],
          media: [{ id_str: '1500000000000000001', url: 'https://t.co/pic' }],
        },
        extended_entities: {
          media: [
            {
              id_str: '1500000000000000001',
              type: 'photo',
              media_url_https: 'https://pbs.twimg.com/media/Trail1.jpg',
              url: 'https://t.co/pic',
            },
          ],
        },
        retweeted: false,
      },
    },
  ]);

  writeYtd('like', 'like', [
    {
      like: {
        tweetId: '9876543210987654321',
        fullText: 'A tweet I liked from someone else',
        expandedUrl: 'https://twitter.com/someone/status/9876543210987654321',
      },
    },
  ]);

  writeYtd('direct-messages', 'direct_messages', [
    {
      dmConversation: {
        conversationId: '111-222',
        messages: [
          {
            messageCreate: {
              id: '1300000000000000001',
              senderId: '111',
              recipientId: '222',
              text: 'Hey, testing the archive export',
              createdAt: '2025-01-11T17:10:28.000Z',
              mediaUrls: [
                'https://ton.twitter.com/dm/1300000000000000001/1500000000000000002/Map.jpg',
              ],
              urls: [],
            },
          },
        ],
      },
    },
  ]);

  writeYtd('direct-message-group-headers', 'direct_message_group_headers', [
    {
      dmConversation: {
        conversationId: '1400000000000000001',
        messages: [
          {
            joinConversation: {
              initiatingUserId: '111',
              participantsSnapshot: ['111', '222', '333'],
              createdAt: '2025-01-12T08:59:00.000Z',
            },
          },
        ],
      },
    },
  ]);

  writeYtd('direct-messages-group', 'direct_messages_group', [
    {
      dmConversation: {
        conversationId: '1400000000000000001',
        messages: [
          { participantsJoin: { userIds: ['333'], createdAt: '2025-01-12T08:59:30.000Z' } },
          {
            messageCreate: {
              id: '1300000000000000002',
              senderId: '222',
              text: 'Hello group, testing the archive export',
              createdAt: '2025-01-12T09:00:00.000Z',
              mediaUrls: [],
              urls: [],
            },
          },
        ],
      },
    },
  ]);

  // X's copies of the media, named after the tweet or message and the file.
  files['data/tweets_media/1234567890123456788-Trail1.jpg'] = 'a synthetic photo';
  files['data/direct_messages_media/1300000000000000001-Map.jpg'] = 'a synthetic photo';

  return files;
}

/** The synthetic archive, written to a temp dir. */
export function archive(t) {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(archiveFiles())) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

// A fake X API v2. All accounts, posts, and times are made up.
export const TOKEN = 'test-token';
export const me = { id: '111', username: 'owner_example', name: 'Owner Example' };

/**
 * `n` posts you liked or bookmarked, most recent first: each acted on an
 * hour or so before the one above it, some minutes after it was posted.
 */
export function acted(n, { from = Date.parse('2025-03-01T12:00:00.000Z'), idBase = 1900 } = {}) {
  return Array.from({ length: n }, (_, k) => {
    const at = from - k * 3_600_000 - k * 37;
    return {
      id: `${idBase}${String(k).padStart(15, '0')}`,
      text: `Synthetic post ${k}`,
      author_id: String(500 + k),
      created_at: new Date(Math.floor((at - 600_000 - k * 1000) / 1000) * 1000).toISOString(),
      at,
    };
  });
}

/**
 * Posts as X returns them: a post's `media` and `author` go in `includes`,
 * when asked for, and it points at them by key and id.
 */
function present(posts, query) {
  const expansions = (query.expansions ?? '').split(',');
  const media = [];
  const users = [];
  const data = posts.map(({ media: attached, author, ...post }) => {
    if (attached && expansions.includes('attachments.media_keys')) media.push(...attached);
    if (author && expansions.includes('author_id')) users.push(author);
    return {
      ...post,
      ...(attached && { attachments: { media_keys: attached.map(item => item.media_key) } }),
      ...(author && { author_id: author.id }),
    };
  });
  const includes = { ...(media.length > 0 && { media }), ...(users.length > 0 && { users }) };
  return { data, ...(Object.keys(includes).length > 0 && { includes }) };
}

/** X's token for the posts acted on before `key`: base 36 of `NEXT_TOKEN<key>`. */
const tokenFor = key => BigInt(`0x${Buffer.from(`NEXT_TOKEN${key}`).toString('hex')}`).toString(36);

function keyOf(token) {
  let n = 0n;
  for (const char of token) n = n * 36n + BigInt(Number.parseInt(char, 36));
  const text = Buffer.from(n.toString(16), 'hex').toString();
  return BigInt(text.replace('NEXT_TOKEN', ''));
}

/** Posts with X's paging keys: the action time in ms above 20 more bits. */
const keyed = list =>
  list.map((post, k) => ({
    post,
    key: BigInt(post.at) * 2n ** 20n + BigInt((k * 7919) % 1_048_576),
  }));

/**
 * Serve `likes` and `bookmarks` (from `acted`) and `tweets` as X pages them,
 * a token being the last post's action time in ms shifted left 20 bits,
 * plus 20 more. With `opaque`, tokens carry no time.
 */
export async function serveX(
  t,
  { likes = [], bookmarks = [], tweets = [], mentions = [], posts = [], opaque = false } = {}
) {
  const requests = [];
  const lists = {
    [`/2/users/${me.id}/liked_tweets`]: { items: keyed(likes), min: 5 },
    [`/2/users/${me.id}/bookmarks`]: { items: keyed(bookmarks), min: 1 },
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const query = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, query });
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      return send(401, { title: 'Unauthorized' });
    if (url.pathname === '/2/users/me') return send(200, { data: me });

    const list = lists[url.pathname];
    if (list) {
      const size = Number(query.max_results);
      if (!(size >= list.min && size <= 100)) return send(400, { title: 'Invalid Request' });
      let rest = list.items;
      const token = query.pagination_token;
      if (token?.startsWith('PAGE')) rest = rest.slice(Number(token.slice(4, -3)));
      else if (token) rest = rest.filter(({ key }) => key < keyOf(token));
      const page = rest.slice(0, size);
      const more = rest.length > size;
      const offset = list.items.length - rest.length + size;
      let next;
      if (more) next = opaque ? `PAGE${offset}ZZZ` : tokenFor(page.at(-1).key);
      return send(200, {
        ...present(
          page.map(({ post: { at, ...tweet } }) => tweet),
          query
        ),
        meta: { result_count: page.length, ...(next && { next_token: next }) },
      });
    }

    const timeline = {
      [`/2/users/${me.id}/tweets`]: tweets,
      [`/2/users/${me.id}/mentions`]: mentions,
    }[url.pathname];
    if (timeline) {
      const start = query.start_time ? Date.parse(query.start_time) : Number.NEGATIVE_INFINITY;
      const end = query.end_time ? Date.parse(query.end_time) : Number.POSITIVE_INFINITY;
      const inWindow = timeline.filter(tweet => {
        const time = Date.parse(tweet.created_at);
        return time >= start && time < end;
      });
      return send(200, { ...present(inWindow, query), meta: { result_count: inWindow.length } });
    }

    if (url.pathname === '/2/tweets') {
      const ids = query.ids.split(',');
      return send(
        200,
        present(
          posts.filter(post => ids.includes(post.id)),
          query
        )
      );
    }
    send(404, { title: 'Not Found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = TwitterApi.baseUrl;
  TwitterApi.baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    TwitterApi.baseUrl = original;
    server.close();
  });
  return requests;
}
