import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function vocabularyVersion(ontology) {
  const match = /owl:versionInfo\s+"([^"]+)"/.exec(ontology);
  assert.ok(match, 'The ontology has no owl:versionInfo');
  return match[1];
}

// With --draft, creates a draft release without a tag; publishing the draft
// creates the tag on the same commit.
function main(draft) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const tag = 'v' + version;
  const gh = (args, options = {}) => spawnSync('gh', args, { encoding: 'utf8', ...options });
  if (gh(['release', 'view', tag]).status === 0) {
    console.log(`Release ${tag} already exists.`);
    return;
  }
  const vocabulary = vocabularyVersion(readFileSync('core/schema/chronicle.ttl', 'utf8'));
  const target = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const created = gh(
    [
      'release',
      'create',
      tag,
      '--target',
      process.env.GITHUB_SHA || target,
      '--title',
      tag,
      '--notes',
      `Software ${version} · vocabulary ${vocabulary}`,
      '--generate-notes',
      ...(draft ? ['--draft'] : []),
    ],
    { stdio: 'inherit' }
  );
  assert.equal(created.status, 0, 'Could not create release ' + tag);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.includes('--draft'));
