import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileCredentialManager, OAuthProvider } from '../dist/index.js';

function configDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A token endpoint on 127.0.0.1 that hands out numbered access tokens. */
async function tokenEndpoint(t) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push(Object.fromEntries(new URLSearchParams(body)));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          access_token: `refreshed-${requests.length}`,
          expires_in: 3600,
          scope: 'openid email extra',
        })
      );
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/token`, requests };
}

const signIn = (account, extra = {}) => ({
  provider: 'synthetic',
  access_token: `access-${account}`,
  refresh_token: `refresh-${account}`,
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'openid email',
  created_at: new Date().toISOString(),
  account,
  ...extra,
});

test('each account keeps its own sign-in, and a refresh updates the one it read', async t => {
  const dir = configDir(t);
  const { url, requests } = await tokenEndpoint(t);
  const store = new FileCredentialManager(dir);

  // An hour-old sign-in for one account, a fresh one for the other.
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await store.storeCredentials(
    'synthetic',
    signIn('ada@example.com', { created_at: old, tokenUrl: url }),
    'client',
    'secret'
  );
  await store.storeCredentials(
    'synthetic',
    signIn('bo@example.com', { tokenUrl: url }),
    'client',
    'secret'
  );

  // The latest sign-in is the default; an account picks its own.
  assert.equal((await store.getCredentials('synthetic')).account, 'bo@example.com');
  assert.equal(
    await store.getValidToken('synthetic', { account: 'BO@example.com' }),
    'access-bo@example.com'
  );

  // The expired account refreshes at its stored token URL and keeps the new scope.
  assert.equal(
    await store.getValidToken('synthetic', { account: 'ada@example.com' }),
    'refreshed-1'
  );
  assert.deepEqual(requests, [
    { grant_type: 'refresh_token', refresh_token: 'refresh-ada@example.com' },
  ]);
  const ada = await store.getCredentials('synthetic', { account: 'ada@example.com' });
  assert.equal(ada.scope, 'openid email extra');
  const bo = await store.getCredentials('synthetic', { account: 'bo@example.com' });
  assert.equal(bo.accessToken, 'access-bo@example.com');

  // Signing in again replaces that account's entry. Google sends no refresh
  // token on a repeat consent, so the stored one stays.
  await store.storeCredentials(
    'synthetic',
    signIn('ada@example.com', { refresh_token: undefined, access_token: 'again' }),
    'client',
    'secret'
  );
  const entries = await store.getAllCredentials('synthetic');
  assert.deepEqual(
    entries.map(entry => [entry.account, entry.accessToken, entry.refreshToken]),
    [
      ['bo@example.com', 'access-bo@example.com', 'refresh-bo@example.com'],
      ['ada@example.com', 'again', 'refresh-ada@example.com'],
    ]
  );
  assert.equal(await store.getCredentials('synthetic', { account: 'cy@example.com' }), null);

  // A provider without accounts keeps one entry, however often it signs in.
  await store.storeCredentials('plain', signIn(undefined, { access_token: 'one' }));
  await store.storeCredentials('plain', signIn(undefined, { access_token: 'two' }));
  const file = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8'));
  assert.deepEqual(
    file.plain.map(entry => entry.accessToken),
    ['two']
  );
});

class PkceProvider extends OAuthProvider {
  static providerId = 'pkce';
  static authorizationUrl = 'https://auth.example/authorize';
  static tokenUrl = 'https://auth.example/token';
  static scopes = ['openid'];
  static scopeSets = { mail: ['mail.read'], calendar: ['calendar.read', 'mail.read'] };
  static pkce = true;

  posted;
  async postToken(url, data) {
    this.posted = Object.fromEntries(data);
    const claims = Buffer.from(JSON.stringify({ email: 'ada@example.com' })).toString('base64url');
    return { access_token: 'access', token_type: 'Bearer', id_token: `h.${claims}.s` };
  }

  accountFrom(response) {
    return JSON.parse(Buffer.from(response.id_token.split('.')[1], 'base64url')).email;
  }
}

test('a PKCE sign-in sends the challenge and its verifier, and names the account', async () => {
  const codeVerifier = OAuthProvider.createCodeVerifier();
  const provider = new PkceProvider({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://127.0.0.1:1/callback',
    scopes: PkceProvider.scopesFor(['mail', 'calendar']),
    state: 'state-1',
    codeVerifier,
  });
  const url = new URL(provider.buildAuthUrl());
  assert.equal(url.searchParams.get('scope'), 'openid mail.read calendar.read');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('code_challenge'),
    createHash('sha256').update(codeVerifier).digest('base64url')
  );

  const tokens = await provider.exchangeCodeForToken('code');
  assert.equal(provider.posted.code_verifier, codeVerifier);
  assert.equal(tokens.account, 'ada@example.com');
  assert.equal(tokens.tokenUrl, 'https://auth.example/token');

  // A set counts as granted only when all its scopes were.
  assert.deepEqual(PkceProvider.scopeSetsIn('openid mail.read'), ['mail']);
  assert.throws(() => PkceProvider.scopesFor(['drive']), /Unknown access "drive"/);
});
