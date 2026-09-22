import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishOrder, tarballName } from './publish-packages.js';

const pkg = (name, dependencies = {}, extra = {}) => ({
  pkg: { name, version: '0.2.0', dependencies, ...extra },
});

test('publishes dependencies first and skips private workspaces', () => {
  const order = publishOrder([
    pkg('@fixture/cli', { '@fixture/plugin': '0.2.0', '@fixture/etl': '0.2.0' }),
    pkg('@fixture/plugin', { '@fixture/etl': '0.2.0', zod: '^3' }),
    pkg('@fixture/etl', {}, { devDependencies: { '@fixture/tsconfig': '0.2.0' } }),
    pkg('@fixture/tsconfig'),
    pkg('@fixture/internal', { '@fixture/cli': '0.2.0' }, { private: true }),
  ]).map(({ pkg }) => pkg.name);
  assert.deepEqual(order, ['@fixture/tsconfig', '@fixture/etl', '@fixture/plugin', '@fixture/cli']);
});

test('rejects dependency cycles', () => {
  assert.throws(() =>
    publishOrder([
      pkg('@fixture/a', { '@fixture/b': '0.2.0' }),
      pkg('@fixture/b', { '@fixture/a': '0.2.0' }),
    ])
  );
});

test('names tarballs the way npm pack does', () => {
  assert.equal(
    tarballName({ name: '@chronicle.app/cli', version: '0.1.0' }),
    'chronicle.app-cli-0.1.0.tgz'
  );
});
