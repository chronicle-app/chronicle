import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webPage, xPost } from '../dist/index.js';

test('a page is its address, and a post on X’s page is also the post', () => {
  assert.deepEqual(webPage('https://example.com/a'), {
    '@type': 'Entity',
    '@key': ['url'],
    url: 'https://example.com/a',
  });
  const post = xPost('2120340637035925906');
  assert.deepEqual(post, {
    '@type': 'Post',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'twitter',
    sourceId: '2120340637035925906',
  });

  // Under any handle or none, with a photo or video open, from any X or
  // Twitter host, and whatever the query.
  for (const url of [
    'https://x.com/example_author/status/2120340637035925906',
    'https://x.com/Example_Author/status/2120340637035925906/',
    'https://x.com/example_author/status/2120340637035925906/photo/1',
    'https://x.com/example_author/status/2120340637035925906/video/2?s=20',
    'https://x.com/i/status/2120340637035925906',
    'https://twitter.com/example_author/status/2120340637035925906?s=20&t=abc',
    'https://mobile.twitter.com/example_author/statuses/2120340637035925906',
    'http://twitter.com/#!/example_author/status/2120340637035925906',
    'https://twitter.com/i/web/status/2120340637035925906',
  ]) {
    assert.deepEqual(webPage(url), { ...webPage('https://example.com/a'), url, sameAs: [post] });
  }

  // A post's pages about it, a profile, and another site's status page are
  // only themselves.
  for (const url of [
    'https://x.com/example_author/status/2120340637035925906/analytics',
    'https://x.com/example_author/status/2120340637035925906/quotes',
    'https://x.com/example_author',
    'https://example.com/example_author/status/2120340637035925906',
  ]) {
    assert.equal(webPage(url).sameAs, undefined, url);
  }
});
