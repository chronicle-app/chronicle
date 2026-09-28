/* eslint-disable camelcase -- Fixtures use Are.na API field names. */
import axios from 'axios';

// Synthetic Are.na v3 API fixtures and an in-process fake of the API. The fake
// replaces axios's default adapter, so the plugin's requests never leave the
// process.

export const user = (id, name, avatar = null) => ({
  id,
  type: 'User',
  slug: name.toLowerCase().replace(' ', '-'),
  name,
  avatar,
});

export const me = user(1, 'Pat Example', 'https://example.com/avatars/pat.png');
export const alex = user(2, 'Alex Example');

const connection = (id, connectedAt, by) => ({
  id,
  position: 1,
  pinned: false,
  connected_at: connectedAt,
  connected_by: by,
});

export const moodBoard = {
  id: 10,
  type: 'Channel',
  slug: 'mood-board',
  title: 'Mood board',
  description: { markdown: 'Things I like', plain: 'Things I like' },
  visibility: 'public',
  state: 'available',
  owner: me,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-03-01T00:00:00Z',
};

export const sharedReading = {
  id: 11,
  type: 'Channel',
  slug: 'shared-reading',
  title: 'Shared reading',
  description: null,
  visibility: 'closed',
  state: 'available',
  owner: alex,
  created_at: '2024-12-01T00:00:00Z',
  updated_at: '2025-02-01T00:00:00Z',
};

export const photoBlock = {
  id: 20,
  type: 'Image',
  base_type: 'Block',
  title: 'Synthetic photo',
  description: { markdown: 'A photo', plain: 'A photo' },
  content: null,
  source: { url: 'https://example.com/photo', title: null },
  image: {
    src: 'https://example.com/images/20.jpg',
    width: 800,
    height: 600,
    alt_text: 'A synthetic photo',
  },
  user: me,
  comment_count: 0,
  created_at: '2025-01-09T00:00:00Z',
  updated_at: '2025-01-09T00:00:00Z',
};

export const textBlock = {
  id: 21,
  type: 'Text',
  base_type: 'Block',
  title: null,
  content: 'Hello from Alex',
  user: alex,
  comment_count: 2,
  created_at: '2025-01-02T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
};

export const myComment = {
  id: 30,
  type: 'Comment',
  body: { markdown: 'Nice', plain: 'Nice' },
  created_at: '2025-01-04T00:00:00Z',
  updated_at: '2025-01-04T00:00:00Z',
  user: me,
};

const page = (data, hasMore = false) => ({
  meta: {
    current_page: 1,
    next_page: hasMore ? 2 : null,
    total_pages: hasMore ? 2 : 1,
    has_more_pages: hasMore,
  },
  data,
});

/** Responses keyed by path, then by page number for paged endpoints. */
export const routes = {
  '/me': me,
  '/users/2': alex,
  // Two pages, oldest channel first, so the client-side sort is exercised.
  '/users/1/contents': { 1: page([sharedReading], true), 2: page([moodBoard]) },
  '/users/2/contents': { 1: page([sharedReading]) },
  '/channels/10/contents': {
    1: page([
      { ...sharedReading, connection: connection(101, '2025-01-05T00:00:00Z', me) },
      { ...photoBlock, connection: connection(100, '2025-01-10T00:00:00Z', me) },
    ]),
  },
  '/channels/11/contents': {
    1: page([
      { ...textBlock, connection: connection(102, '2025-01-03T00:00:00Z', alex) },
      { ...photoBlock, connection: connection(103, '2025-01-01T00:00:00Z', alex) },
    ]),
  },
  '/blocks/21/comments': {
    1: page([
      myComment,
      {
        id: 31,
        type: 'Comment',
        body: 'Thanks',
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-05T00:00:00Z',
        user: alex,
      },
    ]),
  },
  '/users/1/following': {
    1: page([
      alex,
      sharedReading,
      { id: 40, type: 'Group', slug: 'example-group', name: 'Example Group', avatar: null },
    ]),
  },
  '/users/2/following': { 1: page([me]) },
};

/**
 * Serve `routes` through axios's adapter for the duration of a test. Returns the
 * list of requests made, as `{ url, params, authorization }`.
 */
export function fakeArena(t) {
  const requests = [];
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    const authorization = config.headers.get('Authorization');
    requests.push({ url: config.url, params: config.params, authorization });
    const route = routes[config.url];
    const data = config.params?.page === undefined ? route : route?.[config.params.page];
    if (data === undefined) {
      throw new Error(`Unexpected request: ${config.url} ${JSON.stringify(config.params)}`);
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config, request: {} };
  };
  t.after(() => {
    axios.defaults.adapter = original;
  });
  return requests;
}
