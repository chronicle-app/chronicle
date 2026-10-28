import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNew, trustOutcome } from './trust-packages.js';

test('a package is new when its first release on npm is this version', () => {
  assert.equal(isNew('0.5.0', '0.5.0'), true);
  assert.equal(isNew(['0.0.0-stage', '0.5.0'], '0.5.0'), true);
  assert.equal(isNew(['0.0.0-stage', '0.4.0', '0.5.0'], '0.5.0'), false);
  assert.equal(isNew(['0.4.0', '0.5.0'], '0.5.0'), false);
  assert.equal(isNew(undefined, '0.5.0'), false);
});

test('classifies the result of npm trust github', () => {
  assert.equal(trustOutcome({ status: 0, stderr: '' }), 'trusted');
  assert.equal(
    trustOutcome({ status: 1, stderr: 'npm error code E409\nnpm error 409 Conflict' }),
    'already-trusted'
  );
  assert.equal(
    trustOutcome({
      status: 1,
      stderr: 'npm error code EOTP\nThis operation requires a one-time password',
    }),
    'failed'
  );
});
