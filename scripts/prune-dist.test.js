import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('built files whose source is gone are removed, and nothing else', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-prune-'));
  const script = fileURLToPath(new URL('prune-dist.js', import.meta.url));
  const touch = path => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), '');
  };
  try {
    touch('apps/cli/src/commands/kept.ts');
    touch('apps/cli/src/components/Picker.tsx');
    for (const built of [
      'commands/kept.js',
      'commands/kept.d.ts',
      'components/Picker.js',
      'commands/gone/index.js',
      'commands/gone/index.d.ts',
      'commands/gone/index.d.ts.map',
      'tsconfig.lib.tsbuildinfo',
      'catalog.json',
    ]) {
      touch(`apps/cli/dist/${built}`);
    }

    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Removed 3 built files/);

    const dist = path => existsSync(join(directory, 'apps/cli/dist', path));
    assert.ok(dist('commands/kept.js'));
    assert.ok(dist('commands/kept.d.ts'));
    assert.ok(dist('components/Picker.js'));
    assert.ok(dist('tsconfig.lib.tsbuildinfo'));
    assert.ok(dist('catalog.json'));
    // A deleted command is gone, folder and all, so oclif can't find it.
    assert.ok(!dist('commands/gone'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
