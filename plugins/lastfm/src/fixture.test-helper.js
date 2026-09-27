import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LastfmProxy from '../dist/utils/LastfmProxy.js';

/**
 * Point Chronicle's credential store at an empty temp directory, so
 * resolveCredentials never reads the host's stored credentials.
 */
export function isolateCredentials(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lastfm-config-'));
  const previous = process.env.CHRONICLE_CONFIG_DIR;
  process.env.CHRONICLE_CONFIG_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.CHRONICLE_CONFIG_DIR;
    else process.env.CHRONICLE_CONFIG_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

/**
 * Serve Last.fm API responses from 127.0.0.1. `respond(params)` gets the
 * request's query parameters and returns the JSON body. Every request's
 * parameters are collected in `requests`.
 */
export async function startServer(t, respond) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const params = Object.fromEntries(url.searchParams);
    requests.push(params);
    const body = respond(params);
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 3, message: 'Invalid Method' }));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(
    () =>
      new Promise(resolve => {
        server.close(resolve);
      })
  );
  return { baseUrl, requests };
}

/**
 * The extractors build their LastfmProxy against the real Last.fm host.
 * Redirect every proxy request to `baseUrl` for the rest of the test.
 */
export function redirectProxy(t, baseUrl) {
  const original = LastfmProxy.prototype.request;
  LastfmProxy.prototype.request = function (config) {
    this.client.defaults.baseURL = baseUrl;
    return original.call(this, config);
  };
  t.after(() => {
    LastfmProxy.prototype.request = original;
  });
}

export function images(prefix) {
  return [
    { size: 'small', '#text': `${prefix}/34s.png` },
    { size: 'medium', '#text': `${prefix}/64s.png` },
    { size: 'large', '#text': `${prefix}/174s.png` },
    { size: 'extralarge', '#text': `${prefix}/300x300.png` },
  ];
}

export const userInfo = {
  name: 'listener',
  realname: 'Sam Listener',
  url: 'https://www.last.fm/user/listener',
  image: images('https://img.example.com/user'),
};

export function page(key, items, pageNumber, totalPages) {
  const list = key === 'friends' ? 'user' : 'track';
  return {
    [key]: {
      [list]: items,
      '@attr': {
        user: 'listener',
        page: String(pageNumber),
        totalPages: String(totalPages),
        total: String(items.length * totalPages),
      },
    },
  };
}
