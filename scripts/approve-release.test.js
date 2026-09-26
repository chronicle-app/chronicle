import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvePackage, dependencyOrder, selectStaged } from './approve-release.js';

const item = (packageName, version, id) => ({ id, packageName, version });

test('selects the staged item for each package at the release version', () => {
  const selected = selectStaged(
    [
      item('@chronicle.app/etl', '0.2.0', 'a'),
      item('@chronicle.app/etl', '0.1.1', 'b'),
      item('@chronicle.app/cli', '0.2.0', 'c'),
      item('unrelated', '0.2.0', 'd'),
    ],
    ['@chronicle.app/cli', '@chronicle.app/etl'],
    '0.2.0'
  );
  assert.deepEqual(
    [...selected].map(([name, { id }]) => [name, id]),
    [
      ['@chronicle.app/etl', 'a'],
      ['@chronicle.app/cli', 'c'],
    ]
  );
});

test('refuses a version staged twice', () => {
  assert.throws(() =>
    selectStaged(
      [item('@chronicle.app/etl', '0.2.0', 'a'), item('@chronicle.app/etl', '0.2.0', 'b')],
      ['@chronicle.app/etl'],
      '0.2.0'
    )
  );
});

const pkg = (name, dependencies = {}, peerDependencies = {}) => ({
  name,
  dependencies,
  peerDependencies,
});

test('orders packages after the workspace packages they depend on', () => {
  const order = dependencyOrder([
    pkg(
      '@chronicle.app/things-todo',
      { '@chronicle.app/etl-sqlite': '0.2.0', zod: '^3' },
      {
        '@chronicle.app/etl': '>=0.1.0 <1.0.0',
      }
    ),
    pkg('@chronicle.app/etl-sqlite', {}, { '@chronicle.app/etl': '>=0.1.0 <1.0.0' }),
    pkg('@chronicle.app/cli', { '@chronicle.app/things-todo': '0.2.0' }),
    pkg('@chronicle.app/etl'),
  ]);
  const before = (a, b) => order.indexOf(a) < order.indexOf(b);
  assert.equal(order.length, 4);
  assert.ok(before('@chronicle.app/etl', '@chronicle.app/etl-sqlite'));
  assert.ok(before('@chronicle.app/etl-sqlite', '@chronicle.app/things-todo'));
  assert.ok(before('@chronicle.app/things-todo', '@chronicle.app/cli'));
});

// Replays npm's responses to `approve`, recording what the script did.
function scripted(responses, { published = false } = {}) {
  const calls = [];
  return {
    calls,
    options: {
      async approve(otp) {
        calls.push(['approve', otp]);
        return responses.shift();
      },
      published: async () => published,
      async askOtp() {
        calls.push(['askOtp']);
        return '222222';
      },
      wait: async () => calls.push(['wait']),
      credentials: { otp: '111111' },
    },
  };
}
// Real npm stderr, so these tests also cover how failures are classified.
const failed = stderr => ({ status: 1, stderr });
const review = failed(
  "npm error code E409\nnpm error 409 Conflict - POST https://registry.npmjs.org/-/stage/***/approve - @chronicle.app/tsconfig@0.2.0 can't be approved yet because automated review hasn't finished. Try again in a few minutes."
);
const expired = failed(
  'npm error code EOTP\nnpm error This operation requires a one-time password.'
);
const gone = failed(
  'npm error code E404\nnpm error 404 Not Found - POST https://registry.npmjs.org/-/stage/***/approve - staged version "***" not found'
);
const ok = { status: 0, stderr: '' };

test('waits for npm review, then approves', async () => {
  const { calls, options } = scripted([review, review, ok]);
  await approvePackage('@chronicle.app/tsconfig', options);
  assert.deepEqual(calls, [
    ['approve', '111111'],
    ['wait'],
    ['approve', '111111'],
    ['wait'],
    ['approve', '111111'],
  ]);
});

test('asks for a new one-time password when npm rejects it, and keeps it', async () => {
  const { calls, options } = scripted([expired, ok]);
  await approvePackage('@chronicle.app/etl', options);
  assert.deepEqual(calls, [['approve', '111111'], ['askOtp'], ['approve', '222222']]);
  assert.equal(options.credentials.otp, '222222');
});

test('a staged version that is gone counts only if it is on npm', async () => {
  await approvePackage('@chronicle.app/shell', scripted([gone], { published: true }).options);
  await assert.rejects(
    approvePackage('@chronicle.app/shell', scripted([gone]).options),
    /Could not approve @chronicle.app\/shell \(not-found\)/
  );
});

test('gives up after a bounded number of review waits, or on other errors', async () => {
  const { options } = scripted([review, review, review]);
  await assert.rejects(
    approvePackage('@chronicle.app/cli', { ...options, reviewRetries: 2 }),
    /in-review/
  );
  await assert.rejects(
    approvePackage('@chronicle.app/cli', scripted([failed('npm error code E500')]).options),
    /\(failed\)/
  );
});
