import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'chronicle-schema-check-'));
try {
  const output = join(directory, 'schema.ts');
  execFileSync(process.execPath, [
    fileURLToPath(new URL('generate-schemas.js', import.meta.url)),
    fileURLToPath(new URL('../chronicle.ttl', import.meta.url)),
    output,
  ]);
  assert.equal(
    readFileSync(output, 'utf8'),
    readFileSync(new URL('../src/schema.ts', import.meta.url), 'utf8'),
    'Generated schema is stale; run npm run schema:generate and commit the output.'
  );
  const html = join(directory, 'schema.html');
  execFileSync(process.execPath, [
    fileURLToPath(new URL('generate-docs.js', import.meta.url)),
    fileURLToPath(new URL('../chronicle.ttl', import.meta.url)),
    html,
  ]);
  assert.equal(
    readFileSync(html, 'utf8'),
    readFileSync(new URL('../docs/schema.html', import.meta.url), 'utf8'),
    'Generated documentation is stale; run npm run schema:generate and commit the output.'
  );
  console.log('Generated schema and HTML match chronicle.ttl.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
