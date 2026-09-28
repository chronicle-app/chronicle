import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BlueskyProxy from '../dist/utils/BlueskyProxy.js';

// A fake Bluesky: a local server stands in for both bsky.social and the
// account's PDS, so no test reaches the network.

export const HANDLE = 'sam.example.com';
export const PASSWORD = 'app-password';
export const ACCESS_JWT = 'fake-access-jwt';
export const ME = {
  did: 'did:plc:sam',
  handle: HANDLE,
  displayName: 'Sam',
  description: 'Hiking and bread.',
};
export const ALEX = { did: 'did:plc:alex', handle: 'alex.example.com', displayName: 'Alex' };
export const RILEY = {
  did: 'did:plc:riley',
  handle: 'riley.example.com',
  displayName: 'Riley',
  description: 'Photos.',
};

const followUri = 'at://did:plc:sam/app.bsky.graph.follow/3kfollowalex';
const followerUri = 'at://did:plc:riley/app.bsky.graph.follow/3kfollowsam';
const likeUri = 'at://did:plc:sam/app.bsky.feed.like/3klikepost';
export const POST_URI = 'at://did:plc:riley/app.bsky.feed.post/3kpost';

// Records stored in repos, fetched one by one through com.atproto.repo.getRecord.
const repoRecords = {
  [followUri]: { createdAt: '2025-01-02T10:00:00.000Z' },
  [followerUri]: { createdAt: '2025-01-03T11:00:00.000Z' },
  [likeUri]: { createdAt: '2025-01-05T09:30:00.000Z' },
};

const post = {
  uri: POST_URI,
  author: RILEY,
  record: { text: 'Summit at sunrise', createdAt: '2025-01-04T07:00:00.000Z' },
  embed: {
    $type: 'app.bsky.embed.images#view',
    images: [
      {
        fullsize: 'https://cdn.example.com/img/summit.jpg',
        alt: 'The view from the top',
        aspectRatio: { width: 2000, height: 1500 },
      },
      { fullsize: 'https://cdn.example.com/img/trail.jpg', alt: ' ' },
    ],
  },
  viewer: { like: likeUri },
};

function page(key, items, cursor) {
  return { [key]: items, ...(cursor ? { cursor } : {}) };
}

function respond(url, method) {
  const endpoint = url.pathname.replace('/xrpc/', '');
  const query = Object.fromEntries(url.searchParams);
  switch (endpoint) {
    case 'com.atproto.identity.resolveHandle': {
      return query.handle === HANDLE ? { did: ME.did } : {};
    }
    case 'com.atproto.server.createSession': {
      return method === 'POST' ? { accessJwt: ACCESS_JWT } : null;
    }
    case 'app.bsky.actor.getProfile': {
      return query.actor === ME.did ? ME : null;
    }
    case 'app.bsky.graph.getFollows': {
      // Two pages, to exercise the cursor.
      return query.cursor === 'page-2'
        ? page('follows', [])
        : page('follows', [{ ...ALEX, viewer: { following: followUri } }], 'page-2');
    }
    case 'app.bsky.graph.getFollowers': {
      return page('followers', [{ ...RILEY, viewer: { followedBy: followerUri } }]);
    }
    case 'app.bsky.feed.getActorLikes': {
      return page('feed', [{ post }]);
    }
    case 'com.atproto.repo.getRecord': {
      const uri = `at://${query.repo}/${query.collection}/${query.rkey}`;
      return repoRecords[uri] ? { uri, value: repoRecords[uri] } : null;
    }
    default: {
      return null;
    }
  }
}

/**
 * Start the fake server and point the proxy at it: `bsky.social` requests are
 * rewritten to the local origin, and the DID resolves to the local server as
 * its PDS. Records every request so tests can check auth and paging.
 */
export async function fakeBluesky(t) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      const url = new URL(request.url, 'http://127.0.0.1');
      requests.push({
        method: request.method,
        endpoint: url.pathname.replace('/xrpc/', ''),
        query: Object.fromEntries(url.searchParams),
        authorization: request.headers.authorization,
        body: body ? JSON.parse(body) : undefined,
      });
      const json = respond(url, request.method);
      response.writeHead(json ? 200 : 400, { 'content-type': 'application/json' });
      response.end(JSON.stringify(json ?? { error: 'InvalidRequest' }));
    });
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const { request } = BlueskyProxy.prototype;
  const { didToPdsDomain } = BlueskyProxy;
  BlueskyProxy.prototype.request = function (config) {
    return request.call(this, {
      ...config,
      url: config.url.replace('https://bsky.social', origin),
    });
  };
  BlueskyProxy.didToPdsDomain = async () => origin;

  // Credentials resolve from flags, but the lookup still opens the credential
  // store: point it at an empty directory, not the host's.
  const configDir = mkdtempSync(join(tmpdir(), 'bluesky-config-'));
  const previousConfigDir = process.env.CHRONICLE_CONFIG_DIR;
  process.env.CHRONICLE_CONFIG_DIR = configDir;

  t.after(async () => {
    BlueskyProxy.prototype.request = request;
    BlueskyProxy.didToPdsDomain = didToPdsDomain;
    if (previousConfigDir === undefined) delete process.env.CHRONICLE_CONFIG_DIR;
    else process.env.CHRONICLE_CONFIG_DIR = previousConfigDir;
    rmSync(configDir, { recursive: true, force: true });
    await new Promise(resolve => {
      server.close(resolve);
    });
  });
  return { requests };
}
