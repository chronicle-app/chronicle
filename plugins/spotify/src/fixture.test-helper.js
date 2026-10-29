import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { ApiProxy } from '@chronicle.app/etl';
import SpotifyProxy from '../dist/utils/SpotifyProxy.js';

// Synthetic Spotify Web API responses. All users, ids, and names are made up.
export const TOKEN = 'test-token';

export const user = {
  id: 'pat',
  display_name: 'Pat Example',
  external_urls: { spotify: 'https://open.spotify.com/user/pat' },
  followers: { total: 3 },
  images: [],
};

const image = size => ({ url: `https://i.scdn.example/${size}.jpg`, width: size, height: size });

export const band = {
  id: 'artist1',
  name: 'The Example Band',
  external_urls: { spotify: 'https://open.spotify.com/artist/artist1' },
};

export const album = {
  id: 'album1',
  name: 'Morning Songs',
  release_date: '2024-03-01',
  images: [image(640), image(300)],
  artists: [band],
  external_urls: { spotify: 'https://open.spotify.com/album/album1' },
};

export const track = {
  id: 'track1',
  name: 'Morning Light',
  artists: [band],
  album,
  duration_ms: 215_900,
  explicit: false,
  external_urls: { spotify: 'https://open.spotify.com/track/track1' },
  popularity: 40,
  preview_url: 'https://p.scdn.example/preview1.mp3',
};

// A track as the playlist-items `fields` filter returns it: no preview_url,
// and an artist without external_urls.
export const playlistTrack = {
  id: 'track2',
  name: 'Evening Tide',
  artists: [{ id: 'artist2', name: 'Solo Artist' }],
  album: { id: 'album2', name: 'Tides', release_date: '2023', images: [], artists: [] },
  duration_ms: 180_000,
  external_urls: { spotify: 'https://open.spotify.com/track/track2' },
  popularity: 10,
};

export const playlist = {
  id: 'playlist1',
  name: 'Road Trip',
  description: 'Songs for the drive',
  public: false,
  collaborative: false,
  tracks: { total: 2 },
  external_urls: { spotify: 'https://open.spotify.com/playlist/playlist1' },
  images: [image(300)],
  owner: { id: 'pat' },
};

const routes = {
  '/v1/me': () => user,
  '/v1/me/player/recently-played': () => ({
    items: [{ track, played_at: '2026-05-09T16:04:51.789Z' }],
  }),
  '/v1/me/tracks': () => ({ items: [{ added_at: '2026-04-01T12:00:00Z', track }], total: 1 }),
  '/v1/me/albums': () => ({ items: [{ added_at: '2026-04-02T12:00:00Z', album }], total: 1 }),
  '/v1/me/playlists': () => ({ items: [playlist], total: 1 }),
  '/v1/playlists/playlist1/tracks': () => ({
    items: [
      { added_at: '2026-04-03T12:00:00Z', track: playlistTrack },
      // Spotify returns null added_at for very old playlist entries; skipped.
      { added_at: null, track },
    ],
    total: 2,
  }),
};

/**
 * Serve the fixture responses from a local server on 127.0.0.1 and point
 * SpotifyProxy at it, so no request leaves the machine. `requests` records
 * each request's path and query. `status` overrides the response status for
 * a path.
 */
export async function serveSpotify(t, { status = {} } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const route = routes[url.pathname];
    let code = status[url.pathname] ?? (route ? 200 : 404);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) code = 401;
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(code === 200 ? route() : { error: { status: code } }));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;

  const original = Object.getOwnPropertyDescriptor(SpotifyProxy.prototype, 'request');
  SpotifyProxy.prototype.request = function (config) {
    return ApiProxy.prototype.request.call(this, { ...config, baseURL });
  };
  t.after(() => {
    if (original) Object.defineProperty(SpotifyProxy.prototype, 'request', original);
    else delete SpotifyProxy.prototype.request;
    server.close();
  });
  return requests;
}

// A synthetic Spotify data download, in the two parts Spotify sends as
// separate zips. All users, IDs, names, and addresses are made up.

/** When Spotify wrote the download: every file's modified time. */
export const DOWNLOAD_TIME = new Date('2026-02-01T09:00:00Z');

/** One stream in the extended streaming history, with the fields Spotify writes. */
function stream(fields) {
  return {
    ts: fields.ts,
    username: 'pat',
    platform: 'OS X 14.5 [arm 2]',
    ms_played: fields.ms_played,
    conn_country: 'CA',
    ip_addr_decrypted: '192.0.2.10',
    user_agent_decrypted: 'unknown',
    master_metadata_track_name: fields.track ?? null,
    master_metadata_album_artist_name: fields.artist ?? null,
    master_metadata_album_album_name: fields.album ?? null,
    spotify_track_uri: fields.trackUri ?? null,
    episode_name: fields.episode ?? null,
    episode_show_name: fields.show ?? null,
    spotify_episode_uri: fields.episodeUri ?? null,
    reason_start: 'clickrow',
    reason_end: 'trackdone',
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: 0,
    incognito_mode: false,
  };
}

/**
 * The extended streaming history's files, by name. Its parts count up
 * through time, and the older part's name sorts after the newer one's.
 * `endsong` names them as older downloads do.
 */
export function streamingHistoryFiles({ endsong = false } = {}) {
  const older = [
    stream({
      ts: '2025-03-01T10:03:35Z',
      ms_played: 215_000,
      track: 'Morning Light',
      artist: 'The Example Band',
      album: 'Morning Songs',
      trackUri: 'spotify:track:track1',
    }),
    // A local file, which has no URI.
    stream({ ts: '2025-03-01T10:10:00Z', ms_played: 100_000 }),
    // Skipped before it played.
    stream({
      ts: '2025-03-01T10:10:05Z',
      ms_played: 0,
      track: 'Evening Tide',
      artist: 'Solo Artist',
      album: 'Tides',
      trackUri: 'spotify:track:track2',
    }),
  ];
  const newer = [
    stream({
      ts: '2026-01-04T21:00:00Z',
      ms_played: 180_000,
      track: 'Old Song',
      artist: 'Various Artists',
      album: 'Example Hits',
      trackUri: 'spotify:track:track3',
    }),
    stream({
      ts: '2026-01-05T08:30:00Z',
      ms_played: 1_800_000,
      episode: 'Episode 12: Tides',
      show: 'The Example Podcast',
      episodeUri: 'spotify:episode:episode1',
    }),
  ];
  const [first, second] = endsong
    ? ['endsong_0.json', 'endsong_1.json']
    : ['Streaming_History_Audio_2025_0.json', 'Streaming_History_Audio_2025-2026_1.json'];
  return {
    [first]: JSON.stringify(older, null, 2),
    [second]: JSON.stringify(newer, null, 2),
    'ReadMeFirst_ExtendedStreamingHistory.pdf': '%PDF-1.4',
  };
}

/** The account data's files, by name. */
export function accountDataFiles() {
  return {
    'Userdata.json': JSON.stringify({
      username: 'pat',
      email: 'pat@example.com',
      country: 'CA',
      createdFromFacebook: false,
      creationTime: '2014-09-01',
    }),
    'Identity.json': JSON.stringify({ displayName: 'Pat Example', firstName: 'Pat' }),
    'YourLibrary.json': JSON.stringify({
      tracks: [
        {
          artist: 'The Example Band',
          album: 'Morning Songs',
          track: 'Morning Light',
          uri: 'spotify:track:track1',
        },
        // A local file, which Spotify doesn't name.
        { artist: 'Pat', album: 'Demos', track: 'Demo', uri: 'spotify:local:Pat:Demos:Demo:120' },
      ],
      albums: [{ artist: 'The Example Band', album: 'Morning Songs', uri: 'spotify:album:album1' }],
      shows: [
        { name: 'The Example Podcast', publisher: 'Example Studios', uri: 'spotify:show:show1' },
      ],
      episodes: [
        { name: 'Episode 12: Tides', show: 'The Example Podcast', uri: 'spotify:episode:episode1' },
      ],
      bannedTracks: [],
      artists: [{ name: 'The Example Band', uri: 'spotify:artist:artist1' }],
      bannedArtists: [],
      other: [],
    }),
    'Playlist1.json': JSON.stringify({
      playlists: [
        {
          name: 'Road Trip',
          lastModifiedDate: '2026-01-06',
          items: [
            {
              track: {
                trackName: 'Morning Light',
                artistName: 'The Example Band',
                albumName: 'Morning Songs',
                trackUri: 'spotify:track:track1',
              },
              episode: null,
              audiobook: null,
              localTrack: null,
              addedDate: '2025-02-10',
            },
            {
              track: null,
              episode: null,
              audiobook: null,
              localTrack: { uri: 'spotify:local:Pat:Demos:Demo:120' },
              addedDate: '2025-02-11',
            },
            {
              track: null,
              episode: {
                episodeName: 'Episode 12: Tides',
                showName: 'The Example Podcast',
                episodeUri: 'spotify:episode:episode1',
              },
              audiobook: null,
              localTrack: null,
              addedDate: '2026-01-06',
            },
          ],
          description:
            'Songs for the long drive &amp; more by <a href="spotify:artist:artist1">The Example Band</a>',
          numberOfFollowers: 0,
        },
      ],
    }),
    'SearchQueries.json': JSON.stringify([
      {
        platform: 'IPHONE',
        searchTime: '2025-12-01T18:00:00.000Z[UTC]',
        searchQuery: 'tides',
        searchInteractionURIs: [],
      },
      {
        platform: 'OSX_ARM64',
        searchTime: '2026-01-07T09:15:30.250Z[UTC]',
        searchQuery: 'example band',
        searchInteractionURIs: ['spotify:track:track1'],
      },
    ]),
    // The account data's year of streams, which a run leaves to the extended history.
    'StreamingHistory_music_0.json': JSON.stringify([
      {
        endTime: '2026-01-04 21:00',
        artistName: 'Various Artists',
        trackName: 'Old Song',
        msPlayed: 180_000,
      },
    ]),
    'Follow.json': JSON.stringify({ followerCount: 3, followingUsersCount: 5 }),
  };
}

/** Write files into `dir` by their paths in it, each modified at {@link DOWNLOAD_TIME}. */
export function writeDownload(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    utimesSync(file, DOWNLOAD_TIME, DOWNLOAD_TIME);
  }
  return dir;
}
