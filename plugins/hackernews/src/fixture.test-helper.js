import { createServer } from 'node:http';
import HackerNewsProxy from '../dist/utils/HackerNewsProxy.js';

// A fake Hacker News Firebase API on 127.0.0.1, so no test reaches the network.

export const USERNAME = 'sam';

/** Unix seconds for an item: ids and times rise together, as on Hacker News. */
export const at = id => 1_700_000_000 + id * 60;

const item = (id, fields) => ({ id, time: at(id), ...fields });

// One thread under Sam's story 100, one under Riley's story 101:
//
//   100 story (sam)             101 story (riley)
//   ├── 104 alex                ├── 107 sam
//   │   └── 108 riley           │   └── 111 riley (dead)
//   │       └── 110 sam         └── 109 sam (deleted)
//   └── 106 sam
export const ITEMS = {
  100: item(100, {
    type: 'story',
    by: 'sam',
    title: 'Sourdough at altitude',
    url: 'https://example.com/bread',
    kids: [104, 106],
  }),
  101: item(101, {
    type: 'story',
    by: 'riley',
    title: 'Show HN: A trail map',
    url: 'https://example.com/trails',
    kids: [107, 109],
  }),
  103: item(103, {
    type: 'story',
    by: 'sam',
    title: 'Ask HN: What do you bake?',
    text: 'Weekends only.<p>See <a href="https://example.com/starter">my starter</a>.',
  }),
  104: item(104, {
    type: 'comment',
    by: 'alex',
    parent: 100,
    text: 'Salt &amp; time.',
    kids: [108],
  }),
  105: item(105, { type: 'poll', by: 'sam', title: 'Favourite flour?', parts: [] }),
  106: item(106, { type: 'comment', by: 'sam', parent: 100, text: 'Thanks, all.' }),
  107: item(107, { type: 'comment', by: 'sam', parent: 101, text: 'Lovely map.', kids: [111] }),
  108: item(108, { type: 'comment', by: 'riley', parent: 104, text: 'And patience.', kids: [110] }),
  109: { id: 109, deleted: true, type: 'comment', parent: 101, time: at(109) },
  110: item(110, { type: 'comment', by: 'sam', parent: 108, text: '<i>So</i> much patience.' }),
  111: item(111, { type: 'comment', by: 'riley', parent: 107, dead: true, text: 'Thanks!' }),
};

export const USER = {
  id: USERNAME,
  created: 1_600_000_000,
  karma: 42,
  about: 'Bread <i>and</i> bikes.',
  submitted: [110, 109, 107, 106, 105, 103, 100],
};

function respond(path) {
  const user = path.match(/^\/v0\/user\/(.+)\.json$/);
  if (user) return decodeURIComponent(user[1]) === USERNAME ? USER : null;
  const found = path.match(/^\/v0\/item\/(\d+)\.json$/);
  return found ? (ITEMS[found[1]] ?? null) : null;
}

/**
 * Start the fake API and point every proxy at it. Returns the request paths,
 * in order.
 */
export async function fakeHackerNews(t) {
  const requests = [];
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    requests.push(pathname);
    // Firebase answers a missing user or item with a 200 and `null`.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(respond(pathname)));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}/v0`;

  const { request } = HackerNewsProxy.prototype;
  HackerNewsProxy.prototype.request = function (config) {
    this.client.defaults.baseURL = origin;
    return request.call(this, config);
  };

  t.after(async () => {
    HackerNewsProxy.prototype.request = request;
    await new Promise(resolve => {
      server.close(resolve);
    });
  });
  return { requests };
}
