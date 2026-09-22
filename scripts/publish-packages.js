import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sections = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];

/** Publishable workspaces, each after every workspace it depends on. */
export function publishOrder(packages) {
  const byName = new Map(packages.map(entry => [entry.pkg.name, entry]));
  const ordered = [];
  const state = new Map();
  const visit = name => {
    if (state.get(name) === 'done') return;
    assert.notEqual(state.get(name), 'visiting', 'Dependency cycle through ' + name);
    state.set(name, 'visiting');
    const { pkg } = byName.get(name);
    for (const section of sections) {
      for (const dependency of Object.keys(pkg[section] ?? {}).sort()) {
        if (byName.has(dependency) && dependency !== name) visit(dependency);
      }
    }
    state.set(name, 'done');
    ordered.push(byName.get(name));
  };
  for (const name of [...byName.keys()].sort()) visit(name);
  return ordered.filter(({ pkg }) => !pkg.private);
}

export function tarballName({ name, version }) {
  return name.replace(/^@/, '').replace('/', '-') + '-' + version + '.tgz';
}

const read = path => JSON.parse(readFileSync(path, 'utf8'));

function readWorkspaces() {
  const root = read('package.json');
  const packages = root.workspaces.flatMap(pattern => {
    const directory = pattern.slice(0, -2);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .map(name => join(directory, name, 'package.json'))
      .filter(path => existsSync(path))
      .map(path => ({ path, pkg: read(path) }));
  });
  return { root, packages };
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  return result;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const registryIndex = argv.indexOf('--registry');
  const registry = registryIndex === -1 ? undefined : argv[registryIndex + 1];
  assert.ok(registryIndex === -1 || registry, 'Expected a URL after --registry');
  const rehearsal = dryRun || registry !== undefined;
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run through npm run release:publish.');
  const npmRun = (args, options) => run(process.execPath, [npm, ...args], options);
  const registryArgs = registry ? ['--registry', registry] : [];

  const git = args => run('git', args, { capture: true }).stdout.trim();
  assert.equal(git(['status', '--porcelain']), '', 'Commit or stash changes before publishing.');
  if (!rehearsal) {
    run('git', ['fetch', '--quiet', 'origin', 'main']);
    assert.equal(
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', 'origin/main']),
      'Publish from the merged commit: check out origin/main.'
    );
  }

  const { root, packages } = readWorkspaces();
  const { version } = root;
  const tag = 'v' + version;

  for (const script of ['quality', 'packages:check']) {
    assert.equal(npmRun(['run', script]).status, 0, script + ' failed; nothing was published.');
  }

  const published = [];
  const skipped = [];
  for (const { pkg } of publishOrder(packages)) {
    const view = npmRun(['view', pkg.name + '@' + pkg.version, 'version', ...registryArgs], {
      capture: true,
    });
    if (view.status === 0 && view.stdout.trim() === pkg.version) {
      skipped.push(pkg.name);
      continue;
    }
    assert.ok(
      view.status === 0 || /E404/.test(view.stderr),
      pkg.name + ': could not check the registry\n' + view.stderr
    );
    const tarball = resolve('artifacts/npm', tarballName(pkg));
    assert.ok(existsSync(tarball), 'Missing tarball ' + tarball);
    console.log(`\nPublishing ${pkg.name}@${pkg.version}`);
    const args = ['publish', tarball, '--access', 'public', ...registryArgs];
    if (dryRun) args.push('--dry-run');
    assert.equal(
      npmRun(args).status,
      0,
      `${pkg.name} failed to publish. Rerun to continue; published packages are skipped.`
    );
    published.push(pkg.name);
  }

  console.log(
    `\n${dryRun ? 'Would publish' : 'Published'} ${published.length}, ` +
      `already on the registry ${skipped.length}.`
  );
  if (rehearsal) return;
  if (git(['tag', '--list', tag]) === '') {
    assert.equal(run('git', ['tag', tag]).status, 0, 'Could not create ' + tag);
  }
  assert.equal(
    git(['rev-list', '-n', '1', tag]),
    git(['rev-parse', 'HEAD']),
    tag + ' already points at another commit; release tags never move.'
  );
  assert.equal(run('git', ['push', 'origin', tag]).status, 0, 'Could not push ' + tag);
  console.log(
    `Tagged ${tag}. Write release notes with software ${version} and the vocabulary version.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
