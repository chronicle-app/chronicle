import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import {
  LastfmFriendsExtractor,
  LastfmLovedTracksExtractor,
  LastfmRecentTracksExtractor,
  LastfmTransformer,
} from '../dist/index.js';
import { LastfmOAuthProvider } from '../dist/auth/LastfmOAuthProvider.js';
import {
  images,
  isolateCredentials,
  page,
  redirectProxy,
  startServer,
  userInfo,
} from './fixture.test-helper.js';

// Fake credentials, passed as config; nothing is read from the credential store.
const credentials = { apiKey: 'test-api-key', username: 'listener' };

const listener = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'lastfm',
  handle: 'listener',
  url: 'https://www.last.fm/user/listener',
  name: 'Sam Listener',
  emblem: {
    '@type': 'ImageObject',
    '@key': ['url'],
    url: 'https://img.example.com/user/300x300.png',
  },
  sameAs: ['@me'],
};

// A track with MusicBrainz ids on the recording, album and artist.
const trackWithIds = {
  name: 'First Song',
  mbid: 'rec-mbid-1',
  url: 'https://www.last.fm/music/The+Examples/_/First+Song',
  artist: {
    name: 'The Examples',
    mbid: 'artist-mbid-1',
    url: 'https://www.last.fm/music/The+Examples',
    image: images('https://img.example.com/artist'),
  },
  album: { '#text': 'Example Album', mbid: 'album-mbid-1' },
  image: images('https://img.example.com/cover'),
  date: { uts: '1735689600', '#text': '01 Jan 2025, 00:00' },
};

// A track with no ids: recording and artist key on URL, the album on its name.
// The recent-tracks API gives the artist as `#text` with no URL.
const trackWithoutIds = {
  name: 'Second Song',
  mbid: '',
  url: 'https://www.last.fm/music/Other+Band/_/Second+Song',
  artist: { '#text': 'Other Band', mbid: '' },
  album: { '#text': 'Other Album', mbid: '' },
  image: [{ size: 'small', '#text': '' }],
  date: { uts: '1735693200', '#text': '01 Jan 2025, 01:00' },
};

const nowPlaying = {
  ...trackWithIds,
  name: 'Playing Now',
  '@attr': { nowplaying: 'true' },
};
const zeroTimestamp = { ...trackWithIds, date: { uts: '0', '#text': '' } };

async function extract(Extractor, config) {
  const extractor = new Extractor({ ...credentials, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

async function transform(record) {
  const nodes = await new LastfmTransformer().performTransform(record);
  return nodes.map(node => node.data);
}

test('scrobbles become ListenActions on MusicRecordings, across pages', async t => {
  isolateCredentials(t);
  const { baseUrl, requests } = await startServer(t, params => {
    if (params.method === 'user.getinfo') return { user: userInfo };
    if (params.method === 'user.getRecentTracks') {
      return params.page === '1'
        ? page('recenttracks', [nowPlaying, trackWithIds], 1, 2)
        : page('recenttracks', [trackWithoutIds, zeroTimestamp], 2, 2);
    }
  });
  redirectProxy(t, baseUrl);

  const since = new Date('2025-01-01T00:00:00Z');
  const until = new Date('2025-01-02T00:00:00Z');
  const records = await extract(LastfmRecentTracksExtractor, { since, until });

  // The now-playing track and the zero timestamp are skipped.
  assert.deepEqual(
    records.map(r => r.data.name),
    ['First Song', 'Second Song']
  );
  assert.deepEqual(requests[1], {
    method: 'user.getRecentTracks',
    user: 'listener',
    api_key: 'test-api-key',
    format: 'json',
    page: '1',
    limit: '200',
    from: '1735689600',
    to: '1735776000',
  });

  const artist = {
    '@type': 'MusicGroup',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'lastfm',
    name: 'The Examples',
    url: 'https://www.last.fm/music/The+Examples',
    emblem: {
      '@type': 'ImageObject',
      '@key': ['url'],
      url: 'https://img.example.com/artist/300x300.png',
    },
    sourceId: 'artist-mbid-1',
  };
  const cover = {
    '@type': 'ImageObject',
    '@key': ['url'],
    url: 'https://img.example.com/cover/300x300.png',
  };
  assert.deepEqual(await transform(records[0]), [
    {
      '@type': 'ListenAction',
      timestamp: new Date('2025-01-01T00:00:00Z'),
      '@assertedAt': new Date('2025-01-01T00:00:00Z'),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'lastfm',
      agent: listener,
      object: {
        '@type': 'MusicRecording',
        '@key': ['@type', 'source', 'sourceId'],
        url: 'https://www.last.fm/music/The+Examples/_/First+Song',
        name: 'First Song',
        artist: [artist],
        emblem: cover,
        sourceId: 'rec-mbid-1',
        source: 'lastfm',
        inAlbum: {
          '@type': 'MusicAlbum',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'lastfm',
          name: 'Example Album',
          artist: [artist],
          emblem: cover,
          sourceId: 'album-mbid-1',
        },
      },
    },
  ]);

  // Without MusicBrainz ids: the artist URL is derived from the track URL.
  const otherBand = {
    '@type': 'MusicGroup',
    '@key': ['url'],
    source: 'lastfm',
    name: 'Other Band',
    url: 'https://www.last.fm/music/Other+Band',
  };
  const [listen] = await transform(records[1]);
  assert.deepEqual(listen.object, {
    '@type': 'MusicRecording',
    '@key': ['url'],
    url: 'https://www.last.fm/music/Other+Band/_/Second+Song',
    name: 'Second Song',
    artist: [otherBand],
    inAlbum: {
      '@type': 'MusicAlbum',
      '@key': ['@type', 'source', 'name', 'byArtist[*].name'],
      source: 'lastfm',
      name: 'Other Album',
      artist: [otherBand],
    },
  });
});

test('loved tracks become LikeActions at the loved time', async t => {
  isolateCredentials(t);
  const loved = {
    ...trackWithoutIds,
    artist: {
      name: 'Other Band',
      mbid: '',
      url: 'https://www.last.fm/music/Other+Band',
    },
    album: undefined,
  };
  const { baseUrl, requests } = await startServer(t, params => {
    if (params.method === 'user.getinfo') return { user: { name: 'listener' } };
    if (params.method === 'user.getLovedTracks') {
      return page('lovedtracks', [loved], 1, 1);
    }
  });
  redirectProxy(t, baseUrl);

  const records = await extract(LastfmLovedTracksExtractor, {});
  assert.equal(requests[1].method, 'user.getLovedTracks');
  assert.deepEqual(await transform(records[0]), [
    {
      '@type': 'LikeAction',
      timestamp: new Date('2025-01-01T01:00:00Z'),
      '@assertedAt': new Date('2025-01-01T01:00:00Z'),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'lastfm',
      // With no profile URL from user.getinfo, the listener's URL is built
      // from the handle.
      agent: {
        '@type': 'Agent',
        '@key': ['@type', 'source', 'handle'],
        source: 'lastfm',
        handle: 'listener',
        url: 'https://last.fm/user/listener',
        sameAs: ['@me'],
      },
      object: {
        '@type': 'MusicRecording',
        '@key': ['url'],
        url: 'https://www.last.fm/music/Other+Band/_/Second+Song',
        name: 'Second Song',
        artist: [
          {
            '@type': 'MusicGroup',
            '@key': ['url'],
            source: 'lastfm',
            name: 'Other Band',
            url: 'https://www.last.fm/music/Other+Band',
          },
        ],
      },
    },
  ]);
});

test('friends become FollowActions and account CreateActions, read as a snapshot', async t => {
  isolateCredentials(t);
  const friend = {
    name: 'friend1',
    realname: ' Alex Friend ',
    url: 'https://www.last.fm/user/friend1',
    image: images('https://img.example.com/friend1'),
    registered: { unixtime: '1262304000', '#text': 1_262_304_000 },
  };
  const { baseUrl } = await startServer(t, params => {
    if (params.method === 'user.getinfo') return { user: userInfo };
    // A single friend comes back as a bare object, not an array.
    if (params.method === 'user.getFriends') return page('friends', friend, 1, 1);
  });
  redirectProxy(t, baseUrl);

  const records = await extract(LastfmFriendsExtractor, {});
  assert.equal(records.length, 1);
  const readAt = records[0].extraction.assertedAt;
  assert.ok(readAt);

  const handleOnly = {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source: 'lastfm',
    handle: 'friend1',
    '@asserts': ['*'],
  };
  assert.deepEqual(await transform(records[0]), [
    {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'lastfm',
      sourceId: 'friend1',
      '@assertedAt': readAt,
      '@asserts': ['*'],
      agent: { ...listener, '@asserts': ['*'], emblem: { ...listener.emblem, '@asserts': ['*'] } },
      object: {
        '@type': 'Agent',
        '@key': ['@type', 'source', 'handle'],
        source: 'lastfm',
        handle: 'friend1',
        url: 'https://www.last.fm/user/friend1',
        name: 'Alex Friend',
        emblem: {
          '@type': 'ImageObject',
          '@key': ['url'],
          url: 'https://img.example.com/friend1/300x300.png',
          '@asserts': ['*'],
        },
        '@asserts': ['*'],
      },
    },
    {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'lastfm',
      sourceId: 'friend1',
      timestamp: new Date('2010-01-01T00:00:00Z'),
      '@assertedAt': readAt,
      '@asserts': ['*'],
      agent: handleOnly,
      result: handleOnly,
    },
  ]);
});

test('extraction without credentials fails with the auth instructions', async t => {
  isolateCredentials(t);
  const extractor = new LastfmRecentTracksExtractor({});
  await assert.rejects(extractor.setup(), /Authentication required/);
  const noUser = new LastfmRecentTracksExtractor({ apiKey: 'test-api-key' });
  await assert.rejects(noUser.setup(), /Last\.fm username is required/);
});

test('the OAuth provider signs auth.getSession and returns the session key', async t => {
  assert.equal(OAuthProviderRegistry.get('lastfm'), LastfmOAuthProvider);

  const { baseUrl, requests } = await startServer(t, params => {
    if (params.method === 'auth.getSession') {
      return { session: { name: 'listener', key: 'session-key', subscriber: 0 } };
    }
  });
  const { tokenUrl } = LastfmOAuthProvider;
  LastfmOAuthProvider.tokenUrl = `${baseUrl}/`;
  t.after(() => {
    LastfmOAuthProvider.tokenUrl = tokenUrl;
  });

  const provider = new LastfmOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://127.0.0.1:7463/callback',
  });
  assert.equal(
    provider.buildAuthUrl(),
    'https://www.last.fm/api/auth?api_key=client-id&cb=http%3A%2F%2F127.0.0.1%3A7463%2Fcallback'
  );

  const tokens = await provider.exchangeCodeForToken('auth-token');
  assert.deepEqual(requests[0], {
    method: 'auth.getSession',
    api_key: 'client-id',
    token: 'auth-token',
    format: 'json',
    api_sig: createHash('md5')
      .update('api_keyclient-idmethodauth.getSessiontokenauth-tokenclient-secret')
      .digest('hex'),
  });
  assert.deepEqual(tokens, {
    provider: 'lastfm',
    access_token: 'session-key',
    token_type: 'session',
    created_at: tokens.created_at,
    username: 'listener',
  });
});
