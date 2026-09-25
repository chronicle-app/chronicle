import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentCoAuthors } from './check-commit-message.js';

const script = fileURLToPath(new URL('check-commit-message.js', import.meta.url));

test('agent co-author trailers are found, human co-authors are not', () => {
  const message = [
    'Fix the thing',
    '',
    'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>',
    'co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>',
    'Co-authored-by: Cursor Agent <cursoragent@cursor.com>',
    'Co-authored-by: Sam Example <sam@example.com>',
  ].join('\n');
  assert.deepEqual(agentCoAuthors(message), [
    'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>',
    'co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>',
    'Co-authored-by: Cursor Agent <cursoragent@cursor.com>',
  ]);
  assert.deepEqual(
    agentCoAuthors('Mention Claude in the body\n\nCo-authored-by: Sam <sam@example.com>'),
    []
  );
});

test('the hook rejects agent co-authors and ignores comment lines', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-commit-message-'));
  const run = message => {
    const file = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    return spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  };
  try {
    const rejected = run('Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /noreply@anthropic\.com/);
    assert.equal(run('Fix\n# Co-Authored-By: Claude <noreply@anthropic.com>\n').status, 0);
    assert.equal(run('Fix\n\nCo-authored-by: Sam <sam@example.com>\n').status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
