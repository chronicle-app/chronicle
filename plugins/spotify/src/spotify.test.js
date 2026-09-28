import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import {
  SpotifyPlaylistsExtractor,
  SpotifyRecentlyPlayedExtractor,
  SpotifySavedAlbumsExtractor,
  SpotifySavedTracksExtractor,
  SpotifyTransformer,
} from '../dist/index.js';
import { serveSpotify, TOKEN } from './fixture.test-helper.js';

// Every test passes accessToken, so the proxy never reads stored credentials,
// and serveSpotify answers from 127.0.0.1, so nothing reaches Spotify.
async function actions(Extractor, config = {}) {
  const extractor = new Extractor({ accessToken: TOKEN, ...config });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new SpotifyTransformer();
    const out = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    return out;
  } finally {
    await extractor.teardown();
  }
}

const key = ['@type', 'source', 'sourceId'];
const me = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'spotify',
  handle: 'pat',
  name: 'Pat Example',
  url: 'https://open.spotify.com/user/pat',
  sameAs: ['@me'],
};
const band = {
  '@type': 'MusicGroup',
  '@key': key,
  source: 'spotify',
  sourceId: 'artist1',
  url: 'https://open.spotify.com/artist/artist1',
  name: 'The Example Band',
};
const cover = {
  '@type': 'ImageObject',
  '@key': ['url'],
  url: 'https://i.scdn.example/640.jpg',
  width: 640,
  height: 640,
};
const album = {
  '@type': 'MusicAlbum',
  '@key': key,
  source: 'spotify',
  sourceId: 'album1',
  url: 'https://open.spotify.com/album/album1',
  name: 'Morning Songs',
  datePublished: '2024-03-01',
  emblem: cover,
  artist: [band],
};
const recording = {
  '@type': 'MusicRecording',
  '@key': key,
  source: 'spotify',
  sourceId: 'track1',
  url: 'https://open.spotify.com/track/track1',
  name: 'Morning Light',
  duration: 'PT215S',
  contentUrl: 'https://p.scdn.example/preview1.mp3',
  artist: [band],
  inAlbum: album,
  emblem: cover,
};
const actionKey = ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'];
const like = (timestamp, object) => ({
  '@type': 'LikeAction',
  '@key': actionKey,
  timestamp: new Date(timestamp),
  source: 'spotify',
  agent: me,
  object,
  '@assertedAt': new Date(timestamp),
});

test('recently played tracks become ListenActions by the account', async t => {
  const requests = await serveSpotify(t);
  assert.deepEqual(await actions(SpotifyRecentlyPlayedExtractor), [
    {
      '@type': 'ListenAction',
      '@key': actionKey,
      timestamp: new Date('2026-05-09T16:04:51.000Z'),
      source: 'spotify',
      agent: me,
      object: recording,
      '@assertedAt': new Date('2026-05-09T16:04:51.000Z'),
    },
  ]);
  assert.deepEqual(
    requests.map(r => r.path),
    ['/v1/me', '/v1/me/player/recently-played']
  );
});

test('since, until, and limit become the recently-played query', async t => {
  const requests = await serveSpotify(t);
  await actions(SpotifyRecentlyPlayedExtractor, {
    since: new Date('2026-05-01T00:00:00Z'),
    until: new Date('2026-05-10T00:00:00Z'),
    limit: 500,
  });
  assert.deepEqual(requests.at(-1).query, {
    limit: '50',
    after: String(Date.parse('2026-05-01T00:00:00Z')),
    before: String(Date.parse('2026-05-10T00:00:00Z')),
  });
});

test('saved tracks and albums become LikeActions', async t => {
  await serveSpotify(t);
  assert.deepEqual(await actions(SpotifySavedTracksExtractor), [
    like('2026-04-01T12:00:00.000Z', recording),
  ]);
  assert.deepEqual(await actions(SpotifySavedAlbumsExtractor), [
    like('2026-04-02T12:00:00.000Z', album),
  ]);
});

test('playlist entries become AddActions targeting the playlist', async t => {
  const requests = await serveSpotify(t);
  // The entry with no added_at is skipped.
  assert.deepEqual(await actions(SpotifyPlaylistsExtractor), [
    {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      timestamp: new Date('2026-04-03T12:00:00.000Z'),
      source: 'spotify',
      agent: me,
      object: {
        '@type': 'MusicRecording',
        '@key': key,
        source: 'spotify',
        sourceId: 'track2',
        url: 'https://open.spotify.com/track/track2',
        name: 'Evening Tide',
        duration: 'PT180S',
        // An artist or album without external_urls gets an open.spotify.com URL.
        artist: [
          {
            '@type': 'MusicGroup',
            '@key': key,
            source: 'spotify',
            sourceId: 'artist2',
            url: 'https://open.spotify.com/artist/artist2',
            name: 'Solo Artist',
          },
        ],
        inAlbum: {
          '@type': 'MusicAlbum',
          '@key': key,
          source: 'spotify',
          sourceId: 'album2',
          url: 'https://open.spotify.com/album/album2',
          name: 'Tides',
          datePublished: '2023',
        },
      },
      target: {
        '@type': 'Entity',
        '@key': key,
        source: 'spotify',
        sourceId: 'playlist1',
        url: 'https://open.spotify.com/playlist/playlist1',
        name: 'Road Trip',
        // The extractor passes only the playlist's id, name, and URLs.
        description: undefined,
      },
      '@assertedAt': new Date('2026-04-03T12:00:00.000Z'),
    },
  ]);
  assert.equal(
    requests.at(-1).query.fields,
    'items(added_at,track(id,name,artists,album,duration_ms,external_urls,popularity)),total'
  );
});

test('a rejected token asks the user to sign in again', async t => {
  await serveSpotify(t, { status: { '/v1/me/player/recently-played': 401 } });
  await assert.rejects(actions(SpotifyRecentlyPlayedExtractor), {
    message: /Spotify authentication failed[\s\S]*chronicle auth login spotify/,
  });
});

test('loading the plugin registers the Spotify OAuth provider', () => {
  const provider = OAuthProviderRegistry.get('spotify');
  assert.equal(provider?.tokenAuthStyle, 'basic-header');
  assert.deepEqual(provider.getConfig(), {
    providerId: 'spotify',
    authorizationUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: [
      'user-read-recently-played',
      'user-read-playback-state',
      'user-read-currently-playing',
      'user-top-read',
      'user-library-read',
      'playlist-read-private',
      'playlist-read-collaborative',
    ],
    requiresClientSecret: true,
  });
});
