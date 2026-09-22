import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('shared release updates dependencies and lockfile without changing vocabulary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-version-'));
  const script = fileURLToPath(new URL('version-packages.js', import.meta.url));
  const write = (path, value) => writeFileSync(join(directory, path), JSON.stringify(value));
  const read = path => JSON.parse(readFileSync(join(directory, path), 'utf8'));
  const run = version =>
    spawnSync(process.execPath, [script, version], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(directory, 'cache') },
    });
  try {
    mkdirSync(join(directory, 'core/schema'), { recursive: true });
    write('package.json', {
      name: 'release-fixture',
      private: true,
      version: '0.1.0',
      workspaces: ['core/*'],
      dependencies: { '@fixture/schema': '0.1.0' },
    });
    write('core/schema/package.json', { name: '@fixture/schema', version: '0.1.0' });
    writeFileSync(join(directory, 'core/schema/chronicle.ttl'), 'vocabulary fixture');
    const invalid = run('0.2.0-01');
    assert.notEqual(invalid.status, 0);
    assert.equal(read('package.json').version, '0.1.0');
    const updated = run('0.2.0');
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(read('package.json').dependencies['@fixture/schema'], '0.2.0');
    assert.equal(read('core/schema/package.json').version, '0.2.0');
    assert.equal(
      readFileSync(join(directory, 'core/schema/chronicle.ttl'), 'utf8'),
      'vocabulary fixture'
    );
    const checked = run('--check');
    assert.equal(checked.status, 0, checked.stderr);
    write('core/schema/package.json', { name: '@fixture/schema', version: '0.1.0' });
    assert.notEqual(run('--check').status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
