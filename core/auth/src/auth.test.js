import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileCredentialManager, OAuthServer } from '../dist/index.js';

test('standalone credential store round trip and removal', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chronicle-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileCredentialManager(dir);
  await store.storeCredentials('fixture', { access_token: 'synthetic', token_type: 'static' });
  assert.equal((await store.getCredentials('fixture')).accessToken, 'synthetic');
  assert.equal(await store.getValidToken('fixture'), 'synthetic');
  await store.removeCredentials('fixture');
  assert.equal(await store.getCredentials('fixture'), null);
});

test('OAuth callback server receives synthetic authorization and closes', async t => {
  const server = new OAuthServer();
  t.after(() => server.stop());
  await server.start();
  const result = server.waitForCallback();
  const response = await fetch(`${server.getCallbackUrl()}?code=synthetic-code`);
  assert.equal(response.status, 200);
  assert.equal((await result).code, 'synthetic-code');
  server.stop();
});

test('OAuth timeout rejects the pending callback rather than hanging', async t => {
  const server = new OAuthServer();
  t.after(() => server.stop());
  await server.start(0, 20);
  await assert.rejects(server.waitForCallback(), /timed out/);
});

test('OAuth cancellation rejects a pending callback', async t => {
  const server = new OAuthServer();
  t.after(() => server.stop());
  await server.start();
  const pending = server.waitForCallback();
  server.stop();
  await assert.rejects(pending, /cancelled/);
});
