import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { npmAtTerminal, publicPackages } from './approve-release.js';

// Gives each package new on npm at this version the trusted publisher the
// Release workflow stages through: this repository's release.yml, allowed
// `npm stage publish` only. npm can trust only a package that exists, so a
// new package's first version is published from a local checkout with
// `npm run release`, which runs this last. npm asks for two-factor
// authentication on the first package; choose to skip it for the next five
// minutes and the rest go through. Name packages to trust those instead. It
// can be run again after a failure; a package that already trusts a
// publisher is skipped.

const REPOSITORY = 'chronicle-app/chronicle';
const WORKFLOW = 'release.yml';
// npm asks for a pause between trust requests, to stay under its rate limit.
const PAUSE_MS = 2000;

/**
 * Whether a package's first release on npm is this version. A prerelease
 * isn't one: staging a package's first version adds a `0.0.0-stage`
 * placeholder. `npm view versions` gives a lone version as a string, and none
 * for a package not on npm.
 */
export function isNew(versions, version) {
  return [versions ?? []].flat().find(release => !release.includes('-')) === version;
}

/** Classifies the result of `npm trust github` from its exit status and errors. */
export function trustOutcome({ status, stderr }) {
  if (status === 0) return 'trusted';
  // npm keeps one trusted publisher per package and refuses a second.
  if (/\bE409\b|already exists/i.test(stderr)) return 'already-trusted';
  return 'failed';
}

function versionsOf(name) {
  const result = spawnSync('npm', ['view', name, 'versions', '--json', '--prefer-online'], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result.status === 0 ? JSON.parse(result.stdout) : undefined;
}

async function main(named) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const names =
    named.length > 0
      ? named
      : publicPackages()
          .map(pkg => pkg.name)
          .filter(name => isNew(versionsOf(name), version))
          .sort();
  if (names.length === 0) {
    console.log(`No package is new on npm at ${version}.`);
    return;
  }

  const failed = [];
  for (const [index, name] of names.entries()) {
    if (index > 0) await sleep(PAUSE_MS);
    console.log(`Trusting ${REPOSITORY}'s ${WORKFLOW} to stage ${name}`);
    const outcome = trustOutcome(
      await npmAtTerminal([
        'trust',
        'github',
        name,
        '--file',
        WORKFLOW,
        '--repo',
        REPOSITORY,
        '--allow-stage-publish',
        '--yes',
      ])
    );
    if (outcome === 'already-trusted') console.log(`${name} already trusts a publisher.`);
    if (outcome === 'failed') failed.push(name);
  }
  assert.deepEqual(failed, [], `Could not trust a publisher for ${failed.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
