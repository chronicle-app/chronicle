import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import {
  FoursquareExtractor,
  FoursquareOAuthProvider,
  FoursquareTransformer,
} from '../dist/index.js';
import {
  checkin,
  checkinsPage,
  isolateCredentials,
  redirectProxy,
  self,
  startServer,
} from './fixture.test-helper.js';

// A fake token, passed as config; nothing is read from the credential store.
const token = 'test-oauth-token';

const agent = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'foursquare',
  sourceId: '12345678',
  name: 'Pat Example',
  url: 'https://foursquare.com/user/12345678',
  sameAs: ['@me'],
  emblem: {
    '@type': 'ImageObject',
    '@key': ['url'],
    url: 'https://img.example.com/user/300x300/12345678-EXAMPLE.jpg',
  },
};

// A full venue: categories (primary listed second) and a formatted address.
const cafe = checkin(0, {
  id: '0123456789abcdef01234567',
  name: 'Corner Café',
  categories: [
    { id: 'cat-bakery', name: 'Bakery' },
    { id: 'cat-cafe', name: 'Café', primary: true },
  ],
  location: {
    lat: 43.65,
    lng: -79.38,
    formattedAddress: ['1 Example St', 'Toronto ON', 'Canada'],
    city: 'Toronto',
  },
});

function serve(t, pages) {
  return startServer(t, (path, params) => {
    if (path === '/v2/users/self') {
      return { meta: { code: 200 }, response: { user: self } };
    }
    if (path === '/v2/users/self/checkins') {
      return checkinsPage(pages[Number(params.offset)] ?? []);
    }
  });
}

async function extract(config) {
  const extractor = new FoursquareExtractor({ 'access-token': token, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

async function transform(record) {
  const nodes = await new FoursquareTransformer().performTransform(record);
  return nodes.map(node => node.data);
}

test('check-ins become CheckInActions on Venues, across pages', async t => {
  isolateCredentials(t);
  const firstPage = [cafe, ...Array.from({ length: 49 }, (_, i) => checkin(i + 1))];
  const { baseUrl, requests } = await serve(t, { 0: firstPage, 50: [checkin(50)] });
  redirectProxy(t, baseUrl);

  const records = await extract({});

  assert.equal(records.length, 51);
  assert.deepEqual(
    requests.map(r => [r.path, r.params]),
    [
      ['/v2/users/self', { oauth_token: token, v: '20170310' }],
      ['/v2/users/self/checkins', { limit: '50', offset: '0', oauth_token: token, v: '20170310' }],
      ['/v2/users/self/checkins', { limit: '50', offset: '50', oauth_token: token, v: '20170310' }],
    ]
  );

  const timestamp = new Date(cafe.createdAt * 1000);
  assert.deepEqual(await transform(records[0]), [
    {
      '@type': 'CheckInAction',
      '@key': ['@type', 'source', 'sourceId'],
      '@assertedAt': timestamp,
      timestamp,
      source: 'foursquare',
      sourceId: 'checkin-0',
      agent,
      object: {
        '@type': 'Venue',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'foursquare',
        sourceId: '0123456789abcdef01234567',
        name: 'Corner Café',
        location: {
          '@type': 'Location',
          latitude: 43.65,
          longitude: -79.38,
          address: '1 Example St, Toronto ON, Canada',
        },
        category: ['Café', 'Bakery'],
      },
    },
  ]);

  // A bare venue: no categories, no address.
  const [bare] = await transform(records[50]);
  assert.deepEqual(bare.object, {
    '@type': 'Venue',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'foursquare',
    sourceId: 'venue-50',
    name: 'Venue 50',
    location: { '@type': 'Location', latitude: 43.65, longitude: -79.4 },
  });
});

test('since becomes afterTimestamp and limit stops paging', async t => {
  isolateCredentials(t);
  const firstPage = Array.from({ length: 50 }, (_, i) => checkin(i));
  const { baseUrl, requests } = await serve(t, { 0: firstPage, 50: [checkin(50)] });
  redirectProxy(t, baseUrl);

  const since = new Date('2026-01-01T00:00:00Z');
  const records = await extract({ since, limit: 3 });

  assert.deepEqual(
    records.map(r => r.data.id),
    ['checkin-0', 'checkin-1', 'checkin-2']
  );
  assert.equal(records[0].context.actor.id, '12345678');
  // One page is enough for the limit.
  assert.deepEqual(
    requests.slice(1).map(r => r.params),
    [
      {
        limit: '50',
        offset: '0',
        afterTimestamp: String(since.getTime() / 1000),
        oauth_token: token,
        v: '20170310',
      },
    ]
  );
});

test('setup fails without a token', async t => {
  isolateCredentials(t);
  const extractor = new FoursquareExtractor({});
  await assert.rejects(extractor.setup(), /Foursquare access token is required/);
});

test('the OAuth provider is registered and builds the authorization URL', () => {
  assert.equal(OAuthProviderRegistry.get('foursquare'), FoursquareOAuthProvider);
  const provider = new FoursquareOAuthProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://127.0.0.1:7463/callback',
    state: 'state-1',
  });
  assert.equal(
    provider.buildAuthUrl(),
    'https://foursquare.com/oauth2/authenticate?client_id=client-id&response_type=code' +
      '&redirect_uri=http%3A%2F%2F127.0.0.1%3A7463%2Fcallback&state=state-1'
  );
  assert.equal(FoursquareOAuthProvider.getConfig().requiresClientSecret, true);
});
