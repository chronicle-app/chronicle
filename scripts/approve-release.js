import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isPublished } from './stage-release.js';

// Approves the staged versions of a release, then publishes its draft GitHub
// release, which creates the v<version> tag, and deploys the schema site.
// Approval needs npm two-factor authentication for every package: the script
// asks for one one-time password and reuses it until npm rejects it, or signs
// in through the browser for each package when none is given. It can be run
// again after a failure; packages already on npm are skipped.

// Staged publishing needs a newer npm than Node.js bundles.
const NPM = ['npx', '--yes', 'npm@12'];
const REVIEW_WAIT_MS = 60_000;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function npm(args, options) {
  return run(NPM[0], [...NPM.slice(1), ...args], options);
}

// Runs `npm stage approve`, showing its output (including the browser sign-in
// prompt) while keeping the errors to tell outcomes apart.
function approveStaged(id, otp) {
  const args = [...NPM.slice(1), 'stage', 'approve', id, ...(otp ? ['--otp', otp] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(NPM[0], args, { stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stderr }));
  });
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

/**
 * Orders packages so each comes after the workspace packages it depends on,
 * so a published package never points at a version that is not on npm yet.
 */
export function dependencyOrder(packages) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const ordered = [];
  const visiting = new Set();
  const visit = name => {
    if (ordered.includes(name)) return;
    assert.ok(!visiting.has(name), `Dependency cycle through ${name}`);
    visiting.add(name);
    const pkg = byName.get(name);
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(pkg[section] ?? {}).sort()) {
        if (byName.has(dependency)) visit(dependency);
      }
    }
    visiting.delete(name);
    ordered.push(name);
  };
  for (const name of [...byName.keys()].sort()) visit(name);
  return ordered;
}

/** Classifies the result of `npm stage approve` from its exit status and errors. */
export function approvalOutcome({ status, stderr }) {
  if (status === 0) return 'approved';
  if (/\bE409\b|automated review hasn't finished/i.test(stderr)) return 'in-review';
  if (/\bEOTP\b|one-time password/i.test(stderr)) return 'otp';
  if (/\bE404\b/.test(stderr)) return 'not-found';
  return 'failed';
}

/**
 * Approves one staged package. It waits out npm's automated review, asks for
 * a new one-time password when npm rejects the current one, and counts a
 * staged version that is gone but already on npm as approved by an earlier run.
 */
export async function approvePackage(
  name,
  { approve, published, askOtp, wait, credentials, reviewRetries = 20, otpRetries = 3 }
) {
  let reviews = 0;
  let otps = 0;
  for (;;) {
    const outcome = approvalOutcome(await approve(credentials.otp));
    if (outcome === 'approved') return;
    if (outcome === 'not-found' && (await published())) return;
    if (outcome === 'in-review' && reviews < reviewRetries) {
      reviews += 1;
      await wait(`npm is still reviewing ${name}; retrying (${reviews}/${reviewRetries})`);
      continue;
    }
    if (outcome === 'otp' && otps < otpRetries) {
      otps += 1;
      credentials.otp = await askOtp('npm rejected the one-time password. ');
      continue;
    }
    throw new Error(`Could not approve ${name} (${outcome})`);
  }
}

async function askOtp(reason = '') {
  // Without a terminal to ask in, npm signs in through the browser.
  if (!process.stdin.isTTY) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `${reason}npm one-time password (Enter to sign in through the browser instead): `
    );
    return answer.trim() || undefined;
  } finally {
    prompt.close();
  }
}

async function waitMessage(message) {
  console.log(`${message} in ${REVIEW_WAIT_MS / 1000}s.`);
  await sleep(REVIEW_WAIT_MS);
}

// A package can take a moment to appear on npm after it is approved.
async function waitUntilPublished(name, version, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (isPublished(name, version)) return true;
    if (attempt < attempts) await sleep(10_000);
  }
  return false;
}

function publicPackages() {
  const result = run('npm', ['query', '.workspace', '--json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).filter(pkg => !pkg.private);
}

async function main() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const tag = 'v' + version;
  const release = run('gh', ['release', 'view', tag, '--json', 'isDraft', '--jq', '.isDraft']);
  assert.equal(release.status, 0, `No release ${tag}. Has the Release workflow staged it?`);
  if (release.stdout.trim() !== 'true') {
    console.log(`Release ${tag} is already published.`);
    return;
  }

  const names = dependencyOrder(publicPackages());
  const pending = names.filter(name => !isPublished(name, version));
  const listed = npm(['stage', 'list', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  const staged = selectStaged(JSON.parse(listed.stdout), pending, version);
  const missing = pending.filter(name => !staged.has(name));
  assert.deepEqual(missing, [], `Not staged at ${version}: ${missing.join(', ')}`);

  const credentials = { otp: pending.length > 0 ? await askOtp() : undefined };
  for (const name of pending) {
    console.log(`Approving ${name}@${version}`);
    await approvePackage(name, {
      approve: otp => approveStaged(staged.get(name).id, otp),
      published: () => waitUntilPublished(name, version, 3),
      askOtp,
      wait: waitMessage,
      credentials,
    });
  }
  const unpublished = [];
  for (const name of names) {
    if (!(await waitUntilPublished(name, version))) unpublished.push(name);
  }
  assert.deepEqual(unpublished, [], `Not on npm yet: ${unpublished.join(', ')}`);

  const published = run('gh', ['release', 'edit', tag, '--draft=false'], { stdio: 'inherit' });
  assert.equal(published.status, 0, 'Could not publish release ' + tag);
  const deployed = run('gh', ['workflow', 'run', 'schema-site.yml', '--ref', 'main'], {
    stdio: 'inherit',
  });
  assert.equal(deployed.status, 0, 'Could not start the Schema site workflow');
  console.log(`Released ${tag}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
