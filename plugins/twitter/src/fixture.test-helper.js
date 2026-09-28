import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Write one `data/<file>.js` in the archive's `window.YTD.<name>.part0 = [...]` form. */
function writeYtd(dir, file, name, items) {
  writeFileSync(
    join(dir, 'data', `${file}.js`),
    `window.YTD.${name}.part0 = ${JSON.stringify(items, null, 2)}`
  );
}

/**
 * A small synthetic Twitter/X data archive in a temp dir: the account, two
 * tweets (one with entity mentions and links, one relying on the text
 * fallback), a like, a 1:1 DM, and a group DM with its header.
 */
export function archive(t) {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'data'));

  writeYtd(dir, 'account', 'account', [
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

  writeYtd(dir, 'tweets', 'tweets', [
    {
      tweet: {
        created_at: 'Sat Jan 11 17:10:28 +0000 2025',
        id_str: '1234567890123456789',
        full_text: 'Trail notes with @alex_example https://t.co/abc123',
        favorite_count: '3',
        retweet_count: '1',
        in_reply_to_status_id_str: null,
        in_reply_to_user_id_str: null,
        entities: {
          hashtags: [],
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
        full_text: 'Hi @sam_example, see https://example.com/map.',
        favorite_count: '0',
        retweet_count: '0',
        entities: { hashtags: [], symbols: [], user_mentions: [], urls: [] },
        retweeted: false,
      },
    },
  ]);

  writeYtd(dir, 'like', 'like', [
    {
      like: {
        tweetId: '9876543210987654321',
        fullText: 'A tweet I liked from someone else',
        expandedUrl: 'https://twitter.com/someone/status/9876543210987654321',
      },
    },
  ]);

  writeYtd(dir, 'direct-messages', 'direct_messages', [
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
              mediaUrls: [],
              urls: [],
            },
          },
        ],
      },
    },
  ]);

  writeYtd(dir, 'direct-message-group-headers', 'direct_message_group_headers', [
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

  writeYtd(dir, 'direct-messages-group', 'direct_messages_group', [
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

  return dir;
}
