import { createServer } from 'node:http';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YouTubeProxy from '../dist/utils/YouTubeProxy.js';

export const SELF_ID = 'UCself0000000000000000000';
export const UPLOADER_ID = 'UCuploader000000000000000';
export const CHANNEL_ID = 'UCchannel0000000000000000';
export const FAKE_TOKEN = 'fake-token';

/** When the synthetic Takeout files were last written: the archive's as-of time. */
export const ARCHIVE_TIME = new Date('2026-08-01T12:00:00Z');

const thumbs = (name, sizes = ['default', 'high']) =>
  Object.fromEntries(sizes.map(size => [size, { url: `https://i.example/${name}-${size}.jpg` }]));

const video = (id, title, publishedAt, extra = {}) => ({
  id,
  snippet: {
    publishedAt,
    channelId: UPLOADER_ID,
    channelTitle: 'Uploader',
    title,
    description: `About ${title}.`,
    thumbnails: thumbs(id, ['default', 'maxres']),
  },
  contentDetails: { duration: 'PT6M2S' },
  ...extra,
});

const item = (id, videoId, title, publishedAt, extra = {}) => ({
  id,
  snippet: {
    publishedAt,
    title,
    thumbnails: thumbs(`item-${videoId}`, ['default']),
    channelId: SELF_ID,
    channelTitle: 'Test Owner',
    resourceId: { kind: 'youtube#video', videoId },
    videoOwnerChannelId: UPLOADER_ID,
    videoOwnerChannelTitle: 'Uploader',
    ...extra,
  },
});

/** A synthetic YouTube account, as the Data API v3 reports it. */
export const account = {
  channel: {
    id: SELF_ID,
    snippet: { title: 'Test Owner', thumbnails: thumbs('avatar') },
    contentDetails: { relatedPlaylists: { likes: 'LLself', uploads: 'UUself' } },
  },
  playlistItems: {
    // Newest first, as YouTube lists likes; the first page holds two items.
    LLself: [
      item('lli-1', 'vidAAAAAAA1', 'A Real Video', '2024-11-22T03:14:20.123Z'),
      item('lli-2', 'vidAAAAAAA2', 'Deleted video', '2024-10-01T08:00:00Z', {
        description: 'This video is unavailable.',
        thumbnails: undefined,
        videoOwnerChannelId: undefined,
        videoOwnerChannelTitle: undefined,
      }),
      item('lli-3', 'vidAAAAAAA3', 'Older Video', '2023-01-01T00:00:00Z'),
    ],
    UUself: [item('uui-1', 'vidUPLOAD01', 'My Upload', '2021-06-25T21:41:25Z')],
    PLxyz: [item('pli-abc', 'vidAAAAAAA1', 'A Real Video', '2024-12-01T10:00:00.500Z')],
  },
  videos: [
    video('vidAAAAAAA1', 'A Real Video', '2020-05-01T00:00:00Z'),
    video('vidAAAAAAA3', 'Older Video', '2019-01-01T00:00:00Z'),
    video('vidUPLOAD01', 'My Upload', '2021-06-25T21:41:25Z', {
      snippet: {
        publishedAt: '2021-06-25T21:41:25Z',
        channelId: SELF_ID,
        channelTitle: 'Test Owner',
        title: 'My Upload',
        thumbnails: thumbs('vidUPLOAD01', ['high']),
      },
    }),
  ],
  playlists: [
    {
      id: 'PLxyz',
      snippet: {
        publishedAt: '2019-05-24T03:17:07.069Z',
        title: 'Piano takes',
        description: 'Live takes.',
        thumbnails: thumbs('playlist', ['high']),
        channelId: SELF_ID,
      },
      status: { privacyStatus: 'unlisted' },
      contentDetails: { itemCount: 1 },
    },
  ],
  subscriptions: [
    {
      id: 'sub-id',
      snippet: {
        publishedAt: '2023-12-06T13:53:59.054Z',
        title: 'Some Channel',
        description: 'Channel description.',
        thumbnails: thumbs('channel', ['high']),
        resourceId: { kind: 'youtube#channel', channelId: CHANNEL_ID },
      },
    },
  ],
};

/** Two items per page, so pagination follows nextPageToken. */
function page(items, query) {
  const start = Number(query.get('pageToken') ?? 0);
  const next = start + 2;
  return {
    items: items.slice(start, next),
    pageInfo: { totalResults: items.length },
    ...(next < items.length && { nextPageToken: String(next) }),
  };
}

function respond(url, data) {
  const query = url.searchParams;
  switch (url.pathname) {
    case '/channels': {
      return { items: [data.channel] };
    }
    case '/playlistItems': {
      return page(data.playlistItems[query.get('playlistId')] ?? [], query);
    }
    case '/playlists': {
      return page(data.playlists, query);
    }
    case '/subscriptions': {
      return page(data.subscriptions, query);
    }
    case '/videos': {
      const ids = new Set(query.get('id').split(','));
      return { items: data.videos.filter(v => ids.has(v.id)) };
    }
    default: {
      return null;
    }
  }
}

/**
 * Serve `data` as a fake Data API on 127.0.0.1 and point YouTubeProxy's
 * requests at it for the rest of the test. A request without the fake bearer
 * token gets a 401. Returns the list of requests the proxy made.
 */
export async function fakeYouTubeApi(t, data = account) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const body = req.headers.authorization === `Bearer ${FAKE_TOKEN}` ? respond(url, data) : null;
    const status = req.headers.authorization === `Bearer ${FAKE_TOKEN}` ? (body ? 200 : 404) : 401;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: { code: status } }));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  // The proxy's base URL is fixed to googleapis.com; redirect each request.
  const baseRequest = Object.getPrototypeOf(YouTubeProxy.prototype).request;
  YouTubeProxy.prototype.request = function (config) {
    return baseRequest.call(this, { ...config, baseURL });
  };
  t.after(() => {
    delete YouTubeProxy.prototype.request;
    server.close();
  });
  return requests;
}

const csv = rows =>
  rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n') +
  '\n';

/** One My Activity entry, in the markup Takeout renders. */
export const activityEntry = (body, caption = 'Products:<br>&emsp;YouTube') =>
  '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp">' +
  '<div class="mdl-grid">' +
  '<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div>' +
  `<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${body}</div>` +
  '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div>' +
  `<div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption">${caption}</div>` +
  '</div></div>';

const activityPage = entries =>
  `<html><body><div class="mdl-grid">${entries.join('')}</div></body></html>`;

/**
 * A synthetic Takeout "YouTube and YouTube Music" folder. Pass
 * `{ channel: false }` to leave out channels/channel.csv.
 */
export function writeTakeout(dir, { channel = true } = {}) {
  const files = {
    'history/watch-history.html': activityPage([
      activityEntry(
        'Watched <a href="https://www.youtube.com/watch?v=vidAAAAAAA1">Tom &amp; Jerry &#39;65</a><br>' +
          `<a href="http://www.youtube.com/channel/${UPLOADER_ID}">Uploader</a><br>` +
          'Jul 25, 2026, 10:46:36 PM EDT<br>'
      ),
      activityEntry(
        'Watched <a href="https://www.youtube.com/watch?v=vidDELETED1">https://www.youtube.com/watch?v=vidDELETED1</a><br>' +
          'Jul 7, 2026, 3:38:15 PM EDT<br>'
      ),
      activityEntry(
        'Watched <a href="https://www.youtube.com/watch?v=vidADVERT01">An Ad</a><br>' +
          'Watched at 8:33 AM<br>Nov 10, 2023, 9:33:39 AM EST<br>',
        'Products:<br>&emsp;YouTube<br>Details:<br>&emsp;From Google Ads'
      ),
      activityEntry('Used Shorts creation tools<br>Mar 26, 2026, 7:25:30 PM EDT<br>'),
      activityEntry(
        'Watched <a href="https://music.youtube.com/watch?v=vidMUSIC001&amp;feature=share">A Song</a><br>' +
          'Jan 2, 2020, 12:05:00 AM EST<br>'
      ),
    ]),
    'history/search-history.html': activityPage([
      activityEntry(
        'Searched for <a href="https://www.youtube.com/results?search_query=cowboy+songs">cowboy songs</a><br>' +
          'Jul 22, 2026, 4:56:45 PM EDT<br>'
      ),
      activityEntry(
        'Visited <a href="https://ads.example/">An Ad</a><br>Jul 22, 2026, 4:50:00 PM EDT<br>'
      ),
    ]),
    'subscriptions/subscriptions.csv': csv([
      ['Channel Id', 'Channel Url', 'Channel Title'],
      [CHANNEL_ID, `http://www.youtube.com/channel/${CHANNEL_ID}`, 'Some Channel'],
    ]),
    'playlists/playlists.csv': csv([
      [
        'Playlist ID',
        'Playlist Title (Original)',
        'Playlist Create Timestamp',
        'Playlist Visibility',
      ],
      ['PLxyz', 'Piano takes', '2019-05-24T03:17:07+00:00', 'Unlisted'],
    ]),
    'playlists/Piano takes-videos.csv': csv([
      ['Video ID', 'Playlist Video Creation Timestamp'],
      ['vidAAAAAAA1', '2024-12-01T10:00:00+00:00'],
    ]),
    'playlists/Renamed list-videos.csv': csv([
      ['Video ID', 'Playlist Video Creation Timestamp'],
      ['vidAAAAAAA3', '2024-12-02T10:00:00+00:00'],
    ]),
    'video metadata/videos.csv': csv([
      [
        'Video ID',
        'Approx Duration (ms)',
        'Video Description (Original)',
        'Video Title (Original)',
        'Video Publish Timestamp',
      ],
      ['vidUPLOAD01', '123000', 'Line one\nline two', 'My Upload', '2021-06-25T21:41:25+00:00'],
      ['vidDRAFT001', '5000', '', 'A Draft', ''],
    ]),
    'comments/comments.csv': csv([
      ['Comment ID', 'Channel ID', 'Comment Create Timestamp', 'Video ID', 'Comment Text'],
      [
        'Ugy5w_comment1',
        SELF_ID,
        '2020-04-20T18:52:40.896921+00:00',
        'vidAAAAAAA1',
        '{"text":"Nailed the hallway scene"}',
      ],
      ['Ugy5w_comment2', SELF_ID, '2020-04-21T09:00:00+00:00', 'vidAAAAAAA1', 'plain text'],
    ]),
    ...(channel && {
      'channels/channel.csv': csv([
        ['Channel ID', 'Channel Title (Original)', 'Channel Visibility'],
        [SELF_ID, 'Test Owner', 'Public'],
      ]),
    }),
  };

  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    utimesSync(file, ARCHIVE_TIME, ARCHIVE_TIME);
  }
  return dir;
}
