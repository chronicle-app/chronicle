import { createServer } from 'node:http';
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
    items: [{ track, played_at: '2026-05-09T16:04:51.000Z' }],
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
