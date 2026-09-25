import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OAuthServer } from '../dist/index.js';

// The CLI test covers stored credentials; the callback server needs a browser there.
test('OAuth callback server receives an authorization, and times out or cancels instead of hanging', async t => {
  const server = new OAuthServer();
  t.after(() => server.stop());
  await server.start();
  const result = server.waitForCallback();
  const response = await fetch(`${server.getCallbackUrl()}?code=synthetic-code`);
  assert.equal(response.status, 200);
  assert.equal((await result).code, 'synthetic-code');
  server.stop();

  const cancelled = new OAuthServer();
  await cancelled.start();
  const pending = cancelled.waitForCallback();
  cancelled.stop();
  await assert.rejects(pending, /cancelled/);

  const timedOut = new OAuthServer();
  t.after(() => timedOut.stop());
  await timedOut.start(0, 20);
  await assert.rejects(timedOut.waitForCallback(), /timed out/);
});
