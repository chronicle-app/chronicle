import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { renderReadme } from './sources-table.js';

// Keeps catalog.json, the plugins' `chronicle` manifests, their extractor
// classes, and the README's sources table in agreement. Needs a build.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { plugins: catalog } = JSON.parse(read('catalog.json'));
const workspace = readdirSync(new URL('plugins/', root))
  .filter(dir => existsSync(new URL(`plugins/${dir}/package.json`, root)))
  .map(dir => ({ dir, pkg: JSON.parse(read(`plugins/${dir}/package.json`)) }))
  .filter(({ pkg }) => pkg.chronicle?.plugin === true);

const tiers = new Set(['core', 'official', 'legacy', 'listed']);

/** Sources → strategies, with record types deduplicated and sorted for comparison. */
const normalized = sources =>
  Object.fromEntries(
    Object.entries(sources).map(([name, strategies]) => [
      name,
      Object.fromEntries(
        Object.entries(strategies).map(([strategyName, strategy]) => [
          strategyName,
          { ...strategy, recordTypes: [...new Set(strategy.recordTypes)].sort() },
        ])
      ),
    ])
  );

test('every workspace plugin is in the catalog under its directory name, and back', () => {
  for (const entry of catalog) {
    assert.ok(tiers.has(entry.tier), `${entry.name}: unknown tier ${entry.tier}`);
    assert.ok(entry.summary, `${entry.name}: no summary`);
  }
  assert.equal(new Set(catalog.map(entry => entry.name)).size, catalog.length);
  for (const { dir, pkg } of workspace) {
    const entry = catalog.find(e => e.package === pkg.name);
    assert.ok(entry, `${pkg.name} has no catalog entry`);
    assert.equal(entry.name, dir, `${pkg.name}: catalog name should be its directory`);
    assert.notEqual(entry.tier, 'listed', `${pkg.name} is in this repo, so not "listed"`);
  }
  for (const entry of catalog.filter(e => e.tier !== 'listed')) {
    assert.ok(
      workspace.some(({ pkg }) => pkg.name === entry.package),
      `${entry.package} is in the catalog but not in plugins/`
    );
  }
});

test('each manifest matches its plugin’s exported extractor classes', async () => {
  for (const { dir, pkg } of workspace) {
    const exported = await import(new URL(`plugins/${dir}/dist/index.js`, root).href);
    const derived = {};
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function' || typeof value.source !== 'string') continue;
      if (typeof value.strategy !== 'string' || !Array.isArray(value.recordTypes)) continue;
      derived[value.source] ??= {};
      const source = derived[value.source];
      source[value.strategy] ??= { delivery: value.delivery, recordTypes: [], default: false };
      const strategy = source[value.strategy];
      assert.equal(strategy.delivery, value.delivery, `${pkg.name}: ${value.strategy} deliveries`);
      strategy.recordTypes.push(...value.recordTypes);
      strategy.default ||= Boolean(value.default);
    }
    const declared = {};
    for (const [name, source] of Object.entries(pkg.chronicle.sources ?? {})) {
      declared[name] = {};
      for (const [strategyName, strategy] of Object.entries(source.strategies)) {
        declared[name][strategyName] = { ...strategy, default: Boolean(strategy.default) };
      }
    }
    assert.deepEqual(normalized(declared), normalized(derived), `${pkg.name}: manifest disagrees`);
  }
});

test('no plugin names a record kind after a word --type reserves', async () => {
  for (const { dir, pkg } of workspace) {
    for (const [source, { strategies }] of Object.entries(pkg.chronicle.sources ?? {})) {
      for (const strategy of Object.values(strategies)) {
        for (const kind of ['all', 'defaults']) {
          assert.ok(!strategy.recordTypes.includes(kind), `${dir}: ${source} has a "${kind}" kind`);
        }
      }
    }
  }
});

test('the CLI bundles exactly the core plugins', () => {
  const { dependencies } = JSON.parse(read('apps/cli/package.json'));
  const bundled = catalog.filter(entry => entry.package in dependencies);
  assert.deepEqual(
    bundled.map(entry => entry.name),
    catalog.filter(entry => entry.tier === 'core').map(entry => entry.name)
  );
});

test('the README sources table is current', async () => {
  assert.equal(read('README.md'), await renderReadme(), 'Run npm run readme:sources');
});
