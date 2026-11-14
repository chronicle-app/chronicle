import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  TwitterApiBookmarksExtractor,
  TwitterApiLikesExtractor,
  TwitterApiMentionsExtractor,
  TwitterApiTweetsExtractor,
  TwitterArchiveDirectMessagesExtractor,
  TwitterArchiveFollowsExtractor,
  TwitterArchiveGrokExtractor,
  TwitterArchiveLikesExtractor,
  TwitterArchiveProfileExtractor,
  TwitterArchiveTweetsExtractor,
} from '../dist/index.js';
import { TOKEN, acted, archive, harderArchiveFiles, me, serveX } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const input = archive(t, harderArchiveFiles());
  const alex = { id: '222', username: 'alex_example', name: 'Alex Example' };
  const [liked] = acted(1);
  const [bookmarked] = acted(1, { idBase: 1800 });
  await serveX(t, {
    likes: [{ ...liked, author: alex }],
    bookmarks: [{ ...bookmarked, author: alex }],
    tweets: [
      {
        id: '1700000000000000001',
        text: 'Trail notes with @alex_example https://t.co/abc123',
        created_at: '2025-02-01T10:00:00.000Z',
        public_metrics: { like_count: 3, retweet_count: 1 },
        entities: {
          mentions: [{ username: 'alex_example', id: '222', start: 17, end: 30 }],
          urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.com/trail' }],
        },
        in_reply_to_user_id: me.id,
        referenced_tweets: [{ type: 'replied_to', id: '1700000000000000000' }],
      },
    ],
    mentions: [
      {
        id: '1700000000000000010',
        text: '@owner_example the trail map, as promised',
        created_at: '2025-02-02T08:00:00.000Z',
        entities: { mentions: [{ username: me.username, id: me.id, start: 0, end: 14 }] },
        author: alex,
      },
    ],
  });

  const extractors = [
    new TwitterArchiveTweetsExtractor({ input, limit: 0 }),
    new TwitterArchiveLikesExtractor({ input, limit: 0 }),
    new TwitterArchiveDirectMessagesExtractor({ input, limit: 0 }),
    new TwitterArchiveProfileExtractor({ input, limit: 0 }),
    new TwitterArchiveFollowsExtractor({ input, limit: 0 }),
    new TwitterArchiveGrokExtractor({ input, limit: 0 }),
    new TwitterApiTweetsExtractor({ accessToken: TOKEN, limit: 0 }),
    new TwitterApiLikesExtractor({ accessToken: TOKEN, limit: 0 }),
    new TwitterApiBookmarksExtractor({ accessToken: TOKEN, limit: 0 }),
    new TwitterApiMentionsExtractor({ accessToken: TOKEN, limit: 0 }),
  ];
  const samples = [];
  for (const extractor of extractors) samples.push(...(await sampleTransform(extractor)));
  const rendered = renderShapes(shapesOf(samples), { title: 'Twitter' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
