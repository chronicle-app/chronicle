import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const script = process.argv[2];
if (!['build', 'lint', 'test'].includes(script)) {
  throw new Error('Expected a workspace script: build, lint, or test.');
}

// Invoke npm through Node so this also works with npm.cmd on Windows.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this helper through npm run.');

const { workspaces } = JSON.parse(readFileSync('package.json', 'utf8'));
const packages = workspaces.flatMap(pattern => {
  // This repository uses exactly one directory level per workspace group.
  if (!pattern.endsWith('/*')) throw new Error(`Unsupported workspace pattern: ${pattern}`);
  const directory = pattern.slice(0, -2);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => existsSync(join(directory, name, 'package.json')));
});

// npm run --workspaces fails when the workspace globs match no packages.
// Only skip that specific case; propagate failures once packages arrive.
if (packages.length === 0) {
  console.log(`No workspace packages yet; nothing to ${script}.`);
} else {
  const result = spawnSync(process.execPath, [npm, 'run', script, '--workspaces', '--if-present'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
