import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { findExports, monthKey, writeZip } from '@chronicle.app/etl';
import { nodeKey } from '@chronicle.app/schema';
import {
  SpotifyArchiveLibraryExtractor,
  SpotifyArchiveListensExtractor,
  SpotifyArchivePlaylistsExtractor,
  SpotifyArchiveSearchesExtractor,
  SpotifyPlaylistsExtractor,
  SpotifyRecentlyPlayedExtractor,
  SpotifySavedAlbumsExtractor,
  SpotifySavedTracksExtractor,
  SpotifyTransformer,
} from '../dist/index.js';
import {
  accountDataFiles,
  DOWNLOAD_TIME,
  serveSpotify,
  streamingHistoryFiles,
  TOKEN,
  writeDownload,
} from './fixture.test-helper.js';

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
// A listen is what played and the second it stopped, from the API or a download.
const listenKey = ['@type', 'source', 'object.sourceId', 'timestamp'];
const like = (timestamp, object) => ({
  '@type': 'LikeAction',
  '@key': actionKey,
  timestamp: new Date(timestamp),
  source: 'spotify',
  agent: me,
  object,
  '@assertedAt': new Date(timestamp),
});

test('recently played tracks become ListenActions by the account, at the second each stopped', async t => {
  const requests = await serveSpotify(t);
  assert.deepEqual(await actions(SpotifyRecentlyPlayedExtractor), [
    {
      '@type': 'ListenAction',
      '@key': listenKey,
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
        '@type': 'Collection',
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
    'items(added_at,added_by(id),track(id,name,artists,album,duration_ms,external_urls,popularity)),total'
  );
});

test('a rejected token asks the user to sign in again', async t => {
  await serveSpotify(t, { status: { '/v1/me/player/recently-played': 401 } });
  await assert.rejects(actions(SpotifyRecentlyPlayedExtractor), error => {
    assert.equal(error.exitCode, 3);
    assert.match(error.hint, /chronicle auth login spotify/);
    return true;
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

// The archive tests read a synthetic data download from a temporary folder.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'spotify-download-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The download written into a temporary folder: both parts, side by side, unless given. */
function download(t, files) {
  const dir = tempDir(t);
  if (files) return writeDownload(dir, files);
  writeDownload(join(dir, 'Spotify Account Data'), accountDataFiles());
  writeDownload(join(dir, 'Spotify Extended Streaming History'), streamingHistoryFiles());
  return dir;
}

/**
 * A run of an archive extractor: its records, the nodes they become, and what
 * it said. It looks nothing up, so stored Spotify credentials never come into it.
 */
async function readArchive(Extractor, config) {
  const extractor = new Extractor({ quiet: true, lookup: false, ...config });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = extractor.instantiateDefaultTransformer();
    const nodes = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) nodes.push(node.data);
    }
    return { records, nodes, events };
  } finally {
    await extractor.teardown();
  }
}

async function surveyArchive(Extractor, config, options) {
  const extractor = new Extractor({ quiet: true, ...config });
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

// The streaming history names the account but not its owner's name, which
// the account data's Identity.json gives.
const listener = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'spotify',
  handle: 'pat',
  url: 'https://open.spotify.com/user/pat',
  sameAs: ['@me'],
};
const owner = { ...listener, name: 'Pat Example' };

const byName = (type, name, extra = {}) => ({
  '@type': type,
  '@key': ['@type', 'source', 'name'],
  source: 'spotify',
  name,
  ...extra,
});
const albumKey = ['@type', 'source', 'name', 'artist[*].name'];
const exampleBand = byName('MusicGroup', 'The Example Band');
const morningLight = {
  '@type': 'MusicRecording',
  '@key': key,
  source: 'spotify',
  sourceId: 'track1',
  url: 'https://open.spotify.com/track/track1',
  name: 'Morning Light',
  artist: [exampleBand],
  inAlbum: {
    '@type': 'MusicAlbum',
    '@key': albumKey,
    source: 'spotify',
    name: 'Morning Songs',
    artist: [exampleBand],
  },
};
const tides = {
  '@type': 'PodcastEpisode',
  '@key': key,
  source: 'spotify',
  sourceId: 'episode1',
  url: 'https://open.spotify.com/episode/episode1',
  name: 'Episode 12: Tides',
  series: [byName('PodcastSeries', 'The Example Podcast')],
};

test('the streaming history becomes ListenActions, newest first, at the second each stream stopped', async t => {
  const input = download(t, streamingHistoryFiles());
  const { records, nodes } = await readArchive(SpotifyArchiveListensExtractor, { input });
  const listen = (timestamp, object) => ({
    '@type': 'ListenAction',
    '@key': listenKey,
    source: 'spotify',
    timestamp: new Date(timestamp),
    agent: listener,
    object,
    '@assertedAt': new Date(timestamp),
  });
  // The local file and the stream that didn't play are left out.
  assert.deepEqual(nodes, [
    listen('2026-01-05T08:30:00Z', tides),
    // A compilation's tracks are by Various Artists, its album's artist, not theirs.
    listen('2026-01-04T21:00:00Z', {
      '@type': 'MusicRecording',
      '@key': key,
      source: 'spotify',
      sourceId: 'track3',
      url: 'https://open.spotify.com/track/track3',
      name: 'Old Song',
      inAlbum: {
        '@type': 'MusicAlbum',
        '@key': albumKey,
        source: 'spotify',
        name: 'Example Hits',
        artist: [byName('MusicGroup', 'Various Artists')],
      },
    }),
    listen('2025-03-01T10:03:35Z', morningLight),
  ]);
  // The track and the listener are the API's nodes: the same key, ID, and URL.
  for (const field of ['@key', 'source', 'sourceId', 'url']) {
    assert.deepEqual(morningLight[field], recording[field], field);
  }
  for (const field of ['@key', 'source', 'handle', 'url']) {
    assert.deepEqual(listener[field], me[field], field);
  }
  // Nothing keeps the IP address and user agent Spotify logged.
  for (const { data } of records) {
    assert.ok(!('ip_addr_decrypted' in data) && !('user_agent_decrypted' in data));
  }

  const since = new Date('2026-01-01T00:00:00Z');
  const recent = await readArchive(SpotifyArchiveListensExtractor, { input, since });
  assert.deepEqual(
    recent.nodes.map(n => n.object.sourceId),
    ['episode1', 'track3']
  );
  const limited = await readArchive(SpotifyArchiveListensExtractor, { input, limit: 1 });
  assert.deepEqual(
    limited.nodes.map(n => n.object.sourceId),
    ['episode1']
  );
});

test('a play the API and a download both have is one listen', async t => {
  // The API gives the moment it stopped to the millisecond; the download, to the second.
  await serveSpotify(t);
  const [fromApi] = await actions(SpotifyRecentlyPlayedExtractor);
  const input = download(t, {
    'Streaming_History_Audio_2026.json': JSON.stringify([
      {
        ts: '2026-05-09T16:04:51Z',
        ms_played: 215_000,
        master_metadata_track_name: 'Morning Light',
        master_metadata_album_artist_name: 'The Example Band',
        master_metadata_album_album_name: 'Morning Songs',
        spotify_track_uri: 'spotify:track:track1',
      },
    ]),
  });
  const {
    nodes: [fromDownload],
  } = await readArchive(SpotifyArchiveListensExtractor, { input });
  assert.equal(nodeKey(fromDownload), nodeKey(fromApi));
});

test('a download reads the same as its zip, its folder, or a folder of both parts, as do endsong files', async t => {
  const dir = tempDir(t);
  const both = join(dir, 'spotify');
  const history = join(both, 'Spotify Extended Streaming History');
  writeDownload(join(both, 'Spotify Account Data'), accountDataFiles());
  writeDownload(history, streamingHistoryFiles());
  // Zipped as Spotify sends it, and as older downloads name its files.
  const zip = join(dir, 'my_spotify_data.zip');
  const inZip = Object.entries(streamingHistoryFiles()).map(([name, content]) => [
    `Spotify Extended Streaming History/${name}`,
    content,
  ]);
  writeZip(zip, Object.fromEntries(inZip), { modified: DOWNLOAD_TIME });
  const endsong = writeDownload(join(dir, 'MyData'), streamingHistoryFiles({ endsong: true }));

  const streams = async input =>
    (await readArchive(SpotifyArchiveListensExtractor, { input })).records.map(r => r.data);
  const expected = await streams(history);
  assert.equal(expected.length, 3);
  for (const input of [zip, endsong, both]) assert.deepEqual(await streams(input), expected, input);

  // Beside the account data, the listener has the name it gives them.
  const { nodes } = await readArchive(SpotifyArchiveListensExtractor, { input: both, limit: 1 });
  assert.deepEqual(nodes[0].agent, owner);

  const { chronicle } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json')));
  const { layouts } = chronicle.sources.spotify.strategies.archive;
  const { exports } = await findExports(dir, [{ source: 'spotify', strategy: 'archive', layouts }]);
  assert.deepEqual(
    exports.map(e => e.root).sort(),
    [
      endsong,
      join(both, 'Spotify Account Data'),
      history,
      `${zip}/Spotify Extended Streaming History`,
    ].sort()
  );
});

// The library doesn't say when anything was added, so no action has a timestamp.
const saved = (type, object) => ({
  '@type': type,
  '@key': ['@type', 'source', 'agent.handle', 'object.sourceId'],
  source: 'spotify',
  agent: owner,
  object,
  '@assertedAt': DOWNLOAD_TIME.toISOString(),
});

test('Your Library becomes likes, a bookmark, and follows, as of the download', async t => {
  const input = download(t, accountDataFiles());
  const { records, nodes } = await readArchive(SpotifyArchiveLibraryExtractor, { input });
  // The local file is left out.
  assert.deepEqual(nodes, [
    saved('LikeAction', morningLight),
    saved('LikeAction', {
      '@type': 'MusicAlbum',
      '@key': key,
      source: 'spotify',
      sourceId: 'album1',
      url: 'https://open.spotify.com/album/album1',
      name: 'Morning Songs',
      artist: [exampleBand],
    }),
    saved('BookmarkAction', tides),
    saved('FollowAction', {
      '@type': 'MusicGroup',
      '@key': key,
      source: 'spotify',
      sourceId: 'artist1',
      url: 'https://open.spotify.com/artist/artist1',
      name: 'The Example Band',
    }),
    saved('FollowAction', {
      '@type': 'PodcastSeries',
      '@key': key,
      source: 'spotify',
      sourceId: 'show1',
      url: 'https://open.spotify.com/show/show1',
      name: 'The Example Podcast',
      author: [byName('Agent', 'Example Studios')],
    }),
  ]);
  assert.deepEqual(
    records.map(r => r.extraction.recordType),
    ['saved-tracks', 'saved-albums', 'saved-episodes', 'follows', 'follows']
  );
});

test('playlist items become AddActions on the day each was added, to the playlist by its name in the account', async t => {
  const input = download(t, accountDataFiles());
  const { nodes } = await readArchive(SpotifyArchivePlaylistsExtractor, { input });
  const roadTrip = {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'inAccount[*].handle', 'name'],
    source: 'spotify',
    name: 'Road Trip',
    // Spotify writes the description as HTML.
    description: 'Songs for the long drive & more by [The Example Band](spotify:artist:artist1)',
    inAccount: [
      { '@type': 'Agent', '@key': ['@type', 'source', 'handle'], source: 'spotify', handle: 'pat' },
    ],
  };
  const add = (timestamp, object) => ({
    '@type': 'AddAction',
    '@key': [
      '@type',
      'source',
      'object.sourceId',
      'target.inAccount[*].handle',
      'target.name',
      'timestamp',
    ],
    source: 'spotify',
    timestamp,
    agent: owner,
    object,
    target: roadTrip,
    '@assertedAt': DOWNLOAD_TIME.toISOString(),
  });
  // Newest first, and the local file is left out.
  assert.deepEqual(nodes, [add('2026-01-06', tides), add('2025-02-10', morningLight)]);
});

const find = (timestamp, query) => ({
  '@type': 'FindAction',
  '@key': ['@type', 'source', 'agent.handle', 'object.body', 'timestamp'],
  source: 'spotify',
  timestamp: new Date(timestamp),
  agent: owner,
  object: {
    '@type': 'Query',
    '@key': ['@type', 'source', 'body'],
    source: 'spotify',
    name: query,
    body: query,
  },
  '@assertedAt': new Date(timestamp),
});

test('searches become FindActions, newest first', async t => {
  const input = download(t, accountDataFiles());
  const { nodes } = await readArchive(SpotifyArchiveSearchesExtractor, { input });
  assert.deepEqual(nodes, [
    find('2026-01-07T09:15:30.250Z', 'example band'),
    find('2025-12-01T18:00:00.000Z', 'tides'),
  ]);
});

test('a survey counts what a run of each kind reads, and when', async t => {
  const input = download(t);
  const months = times => {
    const byMonth = {};
    for (const time of times)
      byMonth[monthKey(new Date(time))] = (byMonth[monthKey(new Date(time))] ?? 0) + 1;
    return byMonth;
  };
  assert.deepEqual(
    await surveyArchive(SpotifyArchiveListensExtractor, { input }, { byMonth: true }),
    {
      listens: {
        count: 3,
        earliest: new Date('2025-03-01T10:03:35Z'),
        latest: new Date('2026-01-05T08:30:00Z'),
        byMonth: months(['2025-03-01T10:03:35Z', '2026-01-04T21:00:00Z', '2026-01-05T08:30:00Z']),
        measures: [
          { key: 'tracks', label: 'tracks', value: 2 },
          { key: 'listenSeconds', label: 'listening', value: 215 + 180 + 1800, unit: 'seconds' },
        ],
      },
    }
  );
  // The library is as of the download, which doesn't date its items.
  assert.deepEqual(await surveyArchive(SpotifyArchiveLibraryExtractor, { input }), {
    'saved-tracks': { count: 1, asOf: DOWNLOAD_TIME },
    'saved-albums': { count: 1, asOf: DOWNLOAD_TIME },
    'saved-episodes': { count: 1, asOf: DOWNLOAD_TIME },
    follows: { count: 2, asOf: DOWNLOAD_TIME },
  });
  assert.deepEqual(await surveyArchive(SpotifyArchivePlaylistsExtractor, { input }), {
    'playlist-tracks': {
      count: 2,
      earliest: new Date('2025-02-10T00:00:00Z'),
      latest: new Date('2026-01-06T00:00:00Z'),
      measures: [{ key: 'playlists', label: 'playlists', value: 1 }],
    },
  });
  assert.deepEqual(await surveyArchive(SpotifyArchiveSearchesExtractor, { input, limit: 1 }), {
    searches: {
      count: 2,
      earliest: new Date('2025-12-01T18:00:00.000Z'),
      latest: new Date('2026-01-07T09:15:30.250Z'),
    },
  });
});

/** A stream of track `id` that stopped at `ts`, as newer downloads write one. */
const play = (ts, id) => ({
  ts,
  ms_played: 1000,
  ip_addr: '192.0.2.10',
  master_metadata_track_name: id,
  spotify_track_uri: `spotify:track:${id}`,
});

test('listens come newest first from parts named by year that overlap at their edges', async t => {
  // Newer downloads name parts by year, with a count after the first, and a
  // year's last part can end after the next year's first part begins. Their
  // streams name no account, and the IP address field has a shorter name.
  const input = download(t, {
    'Streaming_History_Audio_2025.json': JSON.stringify([
      play('2025-03-01T10:00:00Z', 'a'),
      play('2025-06-01T10:00:00Z', 'b'),
    ]),
    'Streaming_History_Audio_2025_1.json': JSON.stringify([
      play('2025-12-31T20:00:00Z', 'd'),
      play('2025-09-01T10:00:00Z', 'c'),
    ]),
    'Streaming_History_Audio_2026.json': JSON.stringify([
      play('2026-01-02T10:00:00Z', 'f'),
      play('2025-12-31T16:00:00Z', 'e'),
    ]),
  });
  const { records } = await readArchive(SpotifyArchiveListensExtractor, { input });
  assert.deepEqual(
    records.map(record => record.data.master_metadata_track_name),
    ['f', 'd', 'e', 'c', 'b', 'a']
  );
  assert.ok(records.every(({ data }) => !('ip_addr' in data)));
});

test('an archive run needs a Spotify data download', async t => {
  const notFound = error => {
    assert.equal(error.code, 'input-not-found');
    assert.equal(error.exitCode, 4);
    assert.match(error.hint, /--input/);
    return true;
  };
  await assert.rejects(readArchive(SpotifyArchiveListensExtractor, {}), notFound);
  const elsewhere = download(t, { 'notes.txt': 'not Spotify' });
  await assert.rejects(readArchive(SpotifyArchiveListensExtractor, { input: elsewhere }), notFound);

  // The account data alone has no extended streaming history, so a run of
  // the default kind says how to get it, and how to read what's there.
  assert.equal(SpotifyArchiveListensExtractor.default, true);
  const accountData = download(t, accountDataFiles());
  const { records, events } = await readArchive(SpotifyArchiveListensExtractor, {
    input: accountData,
  });
  assert.deepEqual(records, []);
  const hint = events.find(event => event.kind === 'hint');
  assert.equal(hint.message, 'This download has no extended streaming history');
  assert.match(hint.hint.action, /spotify\.com\/account\/privacy.*`-t all`/);
});
