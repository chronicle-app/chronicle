import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stages every packed tarball whose version is not yet on npm. Staged versions
// stay private until a maintainer approves them with `npm run release:approve`.
// Run from the Release workflow, which authenticates through trusted publishing.

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

export function readManifest(tarball) {
  const result = run('tar', ['-xOzf', tarball, 'package/package.json']);
  if (result.status !== 0) throw new Error(`Could not read ${tarball}: ${result.stderr}`);
  const { name, version } = JSON.parse(result.stdout);
  return { name, version };
}

export function isPublished(name, version) {
  // Ask the registry rather than npm's cache, which can miss a new version.
  const result = run('npm', ['view', `${name}@${version}`, 'version', '--prefer-online']);
  return result.status === 0 && result.stdout.trim() === version;
}

function main(directory) {
  const tarballs = readdirSync(directory)
    .filter(file => file.endsWith('.tgz'))
    .sort()
    .map(file => join(directory, file));
  if (tarballs.length === 0) throw new Error('No tarballs in ' + directory);
  for (const tarball of tarballs) {
    const { name, version } = readManifest(tarball);
    if (isPublished(name, version)) {
      console.log(`${name}@${version} is already published.`);
      continue;
    }
    const staged = run('npm', ['stage', 'publish', tarball], { stdio: 'inherit' });
    if (staged.status !== 0) throw new Error(`Could not stage ${name}@${version}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2] ?? 'artifacts/npm');
