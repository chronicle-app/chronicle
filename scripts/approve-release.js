import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPublished } from './stage-release.js';

// Approves the staged versions of a release, then publishes its draft GitHub
// release, which creates the v<version> tag, and deploys the schema site.
// Approval needs npm two-factor authentication for every package.

// Staged publishing needs a newer npm than Node.js bundles.
const NPM = ['npx', '--yes', 'npm@12'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function npm(args, options) {
  return run(NPM[0], [...NPM.slice(1), ...args], options);
}

// Picks the staged item for each package at the release version.
export function selectStaged(items, names, version) {
  const selected = new Map();
  for (const item of items) {
    if (item.version !== version || !names.includes(item.packageName)) continue;
    assert.ok(
      !selected.has(item.packageName),
      `${item.packageName}@${version} is staged more than once`
    );
    selected.set(item.packageName, item);
  }
  return selected;
}

function publicPackages() {
  const result = run('npm', ['query', '.workspace', '--json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)
    .filter(pkg => !pkg.private)
    .map(pkg => pkg.name)
    .sort();
}

function main() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const tag = 'v' + version;
  const release = run('gh', ['release', 'view', tag, '--json', 'isDraft', '--jq', '.isDraft']);
  assert.equal(release.status, 0, `No release ${tag}. Has the Release workflow staged it?`);
  if (release.stdout.trim() !== 'true') {
    console.log(`Release ${tag} is already published.`);
    return;
  }

  const names = publicPackages();
  const pending = names.filter(name => !isPublished(name, version));
  const listed = npm(['stage', 'list', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  const staged = selectStaged(JSON.parse(listed.stdout), pending, version);
  const missing = pending.filter(name => !staged.has(name));
  assert.deepEqual(missing, [], `Not staged at ${version}: ${missing.join(', ')}`);

  for (const [name, item] of staged) {
    console.log(`Approving ${name}@${version}`);
    const approved = npm(['stage', 'approve', item.id], { stdio: 'inherit' });
    assert.equal(approved.status, 0, `Could not approve ${name}@${version}`);
  }
  const unpublished = names.filter(name => !isPublished(name, version));
  assert.deepEqual(unpublished, [], `Not on npm yet: ${unpublished.join(', ')}`);

  const published = run('gh', ['release', 'edit', tag, '--draft=false'], { stdio: 'inherit' });
  assert.equal(published.status, 0, 'Could not publish release ' + tag);
  const deployed = run('gh', ['workflow', 'run', 'schema-site.yml', '--ref', 'main'], {
    stdio: 'inherit',
  });
  assert.equal(deployed.status, 0, 'Could not start the Schema site workflow');
  console.log(`Released ${tag}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
