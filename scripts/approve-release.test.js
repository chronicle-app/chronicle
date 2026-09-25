import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectStaged } from './approve-release.js';

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
