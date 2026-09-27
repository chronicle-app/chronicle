import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FoursquareProxy from '../dist/utils/FoursquareProxy.js';

/**
 * Point Chronicle's credential store at an empty temp directory, so
 * resolveCredentials never reads the host's stored credentials.
 */
export function isolateCredentials(t) {
  const dir = mkdtempSync(join(tmpdir(), 'foursquare-config-'));
  const previous = process.env.CHRONICLE_CONFIG_DIR;
  process.env.CHRONICLE_CONFIG_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.CHRONICLE_CONFIG_DIR;
    else process.env.CHRONICLE_CONFIG_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

/**
 * Serve Foursquare API responses from 127.0.0.1. `respond(path, params)` gets
 * the request path and query parameters and returns the JSON body. Every
 * request is collected in `requests`.
 */
export async function startServer(t, respond) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const params = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, params });
    const body = respond(url.pathname, params);
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? { meta: { code: 404 } }));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v2/`;
  t.after(
    () =>
      new Promise(resolve => {
        server.close(resolve);
      })
  );
  return { baseUrl, requests };
}

/**
 * The extractor builds its FoursquareProxy against the real Foursquare host.
 * Redirect every proxy request to `baseUrl` for the rest of the test.
 */
export function redirectProxy(t, baseUrl) {
  const original = FoursquareProxy.prototype.request;
  FoursquareProxy.prototype.request = function (config) {
    this.client.defaults.baseURL = baseUrl;
    return original.call(this, config);
  };
  t.after(() => {
    FoursquareProxy.prototype.request = original;
  });
}

export const self = {
  id: '12345678',
  firstName: 'Pat',
  lastName: 'Example',
  canonicalUrl: 'https://foursquare.com/user/12345678',
  photo: {
    prefix: 'https://img.example.com/user/',
    suffix: '/12345678-EXAMPLE.jpg',
  },
};

/** A synthetic check-in at a numbered venue, `n` minutes after the epoch base. */
export function checkin(n, venue = {}) {
  return {
    id: `checkin-${n}`,
    createdAt: 1_778_300_000 - n * 60,
    venue: {
      id: `venue-${n}`,
      name: `Venue ${n}`,
      location: { lat: 43.6 + n / 1000, lng: -79.4 },
      ...venue,
    },
  };
}

export function checkinsPage(items) {
  return { meta: { code: 200 }, response: { checkins: { count: 51, items } } };
}
