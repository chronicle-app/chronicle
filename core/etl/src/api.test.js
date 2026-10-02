import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import {
  ApiAuthError,
  ApiProxy,
  ApiRateLimitError,
  paginateByPage,
  paginateCursor,
  paginateOffset,
} from '../dist/index.js';

// A local HTTP server stands in for a source API; nothing leaves 127.0.0.1.
const requests = [];
let server;
let baseURL;

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({
      path: url.pathname,
      authorization: request.headers.authorization,
      at: Date.now(),
    });
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(body));
    };
    switch (url.pathname) {
      case '/items': {
        const cursor = url.searchParams.get('cursor');
        return send(200, cursor ? { items: [2] } : { items: [1], cursor: 'next' });
      }
      case '/secure': {
        return send(401, { error: 'unauthorized' });
      }
      case '/busy': {
        return send(429, {}, url.searchParams.has('retry') ? { 'retry-after': '42' } : {});
      }
      case '/broken': {
        return send(500, { error: 'broken' });
      }
      default: {
        return send(200, { ok: true });
      }
    }
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(
  () =>
    new Promise(resolve => {
      server.close(resolve);
    })
);

class FixtureProxy extends ApiProxy {
  async initialize() {
    // Tests have no stored credentials.
  }

  get(url, params) {
    // proxy: false keeps any host proxy settings out of the test.
    return this.request({ url, method: 'GET', params, proxy: false });
  }

  useToken(token) {
    this.setAccessToken(token);
  }

  items() {
    return this.paginateCursor({
      fetchPage: cursor => this.get('/items', cursor ? { cursor } : undefined),
    });
  }
}

test('ApiProxy returns response data and sends the bearer token only once one is set', async () => {
  const proxy = new FixtureProxy({ baseURL });
  assert.deepEqual(await proxy.get('/anon'), { ok: true });
  proxy.useToken('fixture-token');
  await proxy.get('/authed');
  const seen = requests.filter(request => ['/anon', '/authed'].includes(request.path));
  assert.deepEqual(
    seen.map(request => request.authorization),
    [undefined, 'Bearer fixture-token']
  );
});

test('ApiProxy maps 401 and 429 to typed errors and passes other failures through', async () => {
  const proxy = new FixtureProxy({ baseURL });

  const auth = await proxy.get('/secure').catch(error => error);
  assert.ok(auth instanceof ApiAuthError);
  assert.equal(auth.status, 401);
  assert.match(auth.message, /FixtureProxy.*re-authorize/);
  // The API errors are the typed ones: a supervisor reads the exit code, not the text.
  assert.equal(auth.code, 'auth-required');
  assert.equal(auth.exitCode, 3);

  const limited = await proxy.get('/busy', { retry: 1 }).catch(error => error);
  assert.ok(limited instanceof ApiRateLimitError);
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfterSeconds, 42);
  assert.equal(limited.exitCode, 5);
  assert.match(limited.hint, /42s/);

  const unhinted = await proxy.get('/busy').catch(error => error);
  assert.ok(unhinted instanceof ApiRateLimitError);
  assert.equal(unhinted.retryAfterSeconds, undefined);

  const broken = await proxy.get('/broken').catch(error => error);
  assert.ok(!(broken instanceof ApiAuthError) && !(broken instanceof ApiRateLimitError));
  assert.equal(broken.response.status, 500);
});

test('ApiProxy pagination follows the cursor and waits pageDelayMs between pages', async () => {
  const proxy = new FixtureProxy({ baseURL, pageDelayMs: 50 });
  const start = requests.length;
  assert.deepEqual(await proxy.items(), [1, 2]);
  const pages = requests.slice(start);
  assert.equal(pages.length, 2);
  assert.ok(pages[1].at - pages[0].at >= 45, 'second page waited for the page delay');
});

const range = (start, count) => Array.from({ length: count }, (_, index) => start + index);

function recording(fetchPage) {
  const calls = [];
  const fetch = async argument => {
    calls.push(argument);
    return fetchPage(argument);
  };
  return { calls, fetch };
}

test('paginateOffset stops on a short or empty batch and slices to the limit', async () => {
  const data = range(0, 20);
  const exact = recording(offset => data.slice(offset, offset + 10));
  assert.deepEqual(await paginateOffset({ fetchPage: exact.fetch, pageSize: 10 }), data);
  assert.deepEqual(exact.calls, [0, 10, 20]);

  const short = recording(offset => range(0, 25).slice(offset, offset + 10));
  assert.deepEqual(await paginateOffset({ fetchPage: short.fetch, pageSize: 10 }), range(0, 25));
  assert.deepEqual(short.calls, [0, 10, 20]);

  assert.deepEqual(await paginateOffset({ fetchPage: async () => [], pageSize: 10 }), []);

  const endless = recording(offset => range(offset, 10));
  assert.deepEqual(
    await paginateOffset({ fetchPage: endless.fetch, pageSize: 10, limit: 15 }),
    range(0, 15)
  );
  assert.equal(endless.calls.length, 2);
});

test('paginateByPage stops at totalPages, on an empty page, or at the limit', async () => {
  const pages = { 1: range(0, 5), 2: range(5, 5), 3: range(10, 5) };
  const known = recording(page => ({ items: pages[page] ?? [], totalPages: 3 }));
  assert.deepEqual(await paginateByPage({ fetchPage: known.fetch }), range(0, 15));
  assert.deepEqual(known.calls, [1, 2, 3]);

  const shortfall = recording(page => ({ items: page === 1 ? range(0, 5) : [], totalPages: 10 }));
  assert.deepEqual(await paginateByPage({ fetchPage: shortfall.fetch }), range(0, 5));
  assert.equal(shortfall.calls.length, 2);

  const limited = recording(page => ({ items: range((page - 1) * 5, 5), totalPages: 100 }));
  assert.deepEqual(await paginateByPage({ fetchPage: limited.fetch, limit: 12 }), range(0, 12));
  assert.equal(limited.calls.length, 3);

  const zeroBased = recording(page => ({ items: [page], totalPages: 2 }));
  assert.deepEqual(await paginateByPage({ fetchPage: zeroBased.fetch, startPage: 0 }), [0, 1]);
});

test('paginateCursor treats a null cursor as the end and slices to the limit', async () => {
  const single = recording(() => ({ items: [1], cursor: null }));
  assert.deepEqual(await paginateCursor({ fetchPage: single.fetch }), [1]);
  assert.equal(single.calls.length, 1);

  const endless = recording(cursor => {
    const start = cursor ? Number(cursor) : 0;
    return { items: range(start, 4), cursor: String(start + 4) };
  });
  assert.deepEqual(await paginateCursor({ fetchPage: endless.fetch, limit: 6 }), range(0, 6));
  assert.deepEqual(endless.calls, [undefined, '4']);
});
