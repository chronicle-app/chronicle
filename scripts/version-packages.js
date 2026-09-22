import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const root = read('package.json');
const packages = root.workspaces.flatMap(pattern => {
  assert.match(pattern, /^[^*]+\/\*$/, 'Expected a one-level workspace pattern');
  const directory = pattern.slice(0, -2);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map(name => directory + '/' + name + '/package.json')
    .filter(path => existsSync(path))
    .map(path => ({ path, pkg: read(path) }));
});
const names = new Set(packages.map(({ pkg }) => pkg.name));
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
let argument = process.argv[2];
assert.ok(argument, 'Use --sync, --check, or an explicit <version>');
if (argument === '--sync') {
  // After `changeset version`: carry the workspaces' shared version to the root,
  // internal dependencies, and lockfile.
  const versions = new Set(packages.map(({ pkg }) => pkg.version));
  assert.equal(versions.size, 1, 'Workspaces disagree on the version: ' + [...versions].join(', '));
  [argument] = versions;
}
const entries = [{ path: 'package.json', pkg: root }, ...packages];

if (argument === '--check') {
  const lock = read('package-lock.json');
  for (const { path, pkg } of entries) {
    assert.equal(pkg.version, root.version, path + ': shared version mismatch');
    const key = path === 'package.json' ? '' : path.slice(0, -13);
    assert.equal(lock.packages[key]?.version, pkg.version, path + ': lockfile version mismatch');
    for (const section of sections) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (names.has(name)) {
          assert.equal(version, root.version, path + ': internal dependency ' + name);
          assert.equal(
            lock.packages[key]?.[section]?.[name],
            version,
            path + ': stale lockfile dependency'
          );
        }
      }
    }
  }
  console.log('Package versions and internal dependencies are aligned.');
} else {
  assert.match(
    argument,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/,
    'Expected an explicit release version'
  );
  for (const { path, pkg } of entries) {
    pkg.version = argument;
    for (const section of sections) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (names.has(name)) pkg[section][name] = argument;
      }
    }
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  }
  const result = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Lockfile update failed; rerun the command before releasing.');
  console.log(
    'Package versions updated. Vocabulary version is unchanged. No tags or packages published.'
  );
}
