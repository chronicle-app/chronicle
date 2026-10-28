import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'chronicle-annotations-check-'));
try {
  const output = join(directory, 'generated.ts');
  execFileSync(process.execPath, [
    fileURLToPath(new URL('generate-annotations.js', import.meta.url)),
    createRequire(import.meta.url).resolve('@chronicle.app/schema/chronicle.ttl'),
    output,
  ]);
  assert.equal(
    readFileSync(output, 'utf8'),
    readFileSync(new URL('../src/annotations/generated.ts', import.meta.url), 'utf8'),
    'Generated annotations are stale; run npm run generate -w @chronicle.app/persistence and commit the output.'
  );
  console.log('Generated annotations match chronicle.ttl.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
