import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      if (value.databases) strategy.databases = value.databases;
    }
    const declared = {};
    for (const [name, source] of Object.entries(pkg.chronicle.sources ?? {})) {
      declared[name] = {};
      for (const [strategyName, strategy] of Object.entries(source.strategies)) {
        // Where it's found, what its exports look like, and how setup gets it ready aren't
        // things the extractor classes say.
        const {
          locations: _locations,
          layouts: _layouts,
          files: _files,
          setup: _setup,
          summary: _summary,
          ...declaredStrategy
        } = strategy;
        declared[name][strategyName] = { ...declaredStrategy, default: Boolean(strategy.default) };
      }
    }
    assert.deepEqual(normalized(declared), normalized(derived), `${pkg.name}: manifest disagrees`);
  }
});

test('each locator and declared location belongs to a strategy, and binds only its options', async () => {
  for (const { dir, pkg } of workspace) {
    const exported = Object.values(
      await import(new URL(`plugins/${dir}/dist/index.js`, root).href)
    ).filter(value => typeof value === 'function' && typeof value.source === 'string');
    const sources = pkg.chronicle.sources ?? {};
    for (const locator of exported.filter(value => typeof value.prototype?.locate === 'function')) {
      assert.ok(
        sources[locator.source]?.strategies[locator.strategy],
        `${pkg.name}: ${locator.name} locates ${locator.source} ${locator.strategy}, which its manifest lacks`
      );
    }
    for (const [source, { strategies }] of Object.entries(sources)) {
      for (const [name, { locations = [] }] of Object.entries(strategies)) {
        const readers = exported.filter(
          value => value.source === source && value.strategy === name && value.schema?.shape
        );
        for (const location of locations) {
          assert.match(
            location.path,
            /^~\//,
            `${pkg.name}: ${location.path} isn't in the home folder`
          );
          const bound = [
            ...Object.keys(location.options ?? {}),
            ...[...location.path.matchAll(/\{(\w+)\}/g)].map(match => match[1]),
          ];
          for (const option of bound) {
            for (const reader of readers) {
              assert.ok(
                option in reader.schema.shape,
                `${pkg.name}: ${reader.name} has no "${option}"`
              );
            }
          }
        }
      }
    }
  }
});

test('each layout is paths from where its export starts, and matches only its own export', async () => {
  const { checkConditions, findExportsIn, segmentPattern } = await import(
    new URL('core/etl/dist/index.js', root).href
  );
  const sets = [];
  for (const { dir, pkg } of workspace) {
    const exported = Object.values(
      await import(new URL(`plugins/${dir}/dist/index.js`, root).href)
    ).filter(value => typeof value === 'function' && typeof value.source === 'string');
    for (const [source, { strategies }] of Object.entries(pkg.chronicle.sources ?? {})) {
      for (const [name, strategy] of Object.entries(strategies)) {
        const { layouts = [] } = strategy;
        if (layouts.length === 0) continue;
        assert.equal(strategy.delivery, 'export', `${pkg.name}: ${name} has layouts but no export`);
        const readers = exported.filter(
          value => value.source === source && value.strategy === name && value.schema?.shape
        );
        for (const layout of layouts) {
          assert.ok(layout.files?.length > 0, `${pkg.name}: a layout of ${name} names no files`);
          checkConditions([...(layout.match ?? []), ...(layout.requires ?? [])], pkg.name);
          for (const file of layout.files) {
            const segments = file.split('/');
            assert.ok(
              segments.every(segment => segment && segment !== '.' && segment !== '..'),
              `${pkg.name}: ${file} isn't a path from where the export starts`
            );
            assert.ok(!file.startsWith('~') && !file.includes('**'), `${pkg.name}: ${file}`);
            for (const segment of segments) segmentPattern(segment);
          }
          const bound = layout.files.flatMap(file =>
            [...file.matchAll(/\{(\w+)\}/g)].map(match => match[1])
          );
          for (const option of bound) {
            for (const reader of readers) {
              assert.ok(
                option in reader.schema.shape,
                `${pkg.name}: ${reader.name} has no "${option}"`
              );
            }
          }
        }
        // Across plugins, layouts are compared by their paths, which need no file's contents.
        sets.push({
          source,
          strategy: name,
          layouts: layouts.map(layout => ({ files: layout.files })),
          plugin: pkg.name,
        });
      }
    }
  }
  // Each layout's own files, as the smallest export it matches, are no other strategy's.
  for (const { source, strategy, layouts, plugin } of sets) {
    for (const layout of layouts) {
      const files = layout.files.map(file => file.replaceAll(/\*|\{\w+\}/g, 'x'));
      const { exports } = await findExportsIn(files, sets);
      assert.deepEqual(
        exports.map(e => e.root),
        [''],
        `${plugin}: ${layout.files.join(', ')} isn't found where it starts`
      );
      const others = exports[0].matches.filter(m => m.source !== source || m.strategy !== strategy);
      assert.deepEqual(
        others.map(m => `${m.source} ${m.strategy}`),
        [],
        `${plugin}: ${source} ${strategy}'s export also matches another strategy's layout`
      );
    }
  }
});

test('each file format names what a walk opens, and checks what it can', async () => {
  const { checkConditions, segmentPattern } = await import(
    new URL('core/etl/dist/index.js', root).href
  );
  for (const { pkg } of workspace) {
    for (const { strategies } of Object.values(pkg.chronicle.sources ?? {})) {
      for (const [name, strategy] of Object.entries(strategies)) {
        for (const format of strategy.files ?? []) {
          assert.ok(format.names?.length > 0, `${pkg.name}: a file of ${name} opens by no name`);
          for (const pattern of format.names) segmentPattern(pattern);
          assert.ok(format.match?.length > 0, `${pkg.name}: a file of ${name} matches anything`);
          checkConditions([...format.match, ...(format.requires ?? [])], pkg.name);
          for (const type of format.recordTypes ?? []) {
            assert.ok(strategy.recordTypes.includes(type), `${pkg.name}: ${name} has no ${type}`);
          }
        }
      }
    }
  }
});

test('each database schema names columns, and a database in it is no other strategy’s', async t => {
  const { matchSchema, readColumns } = await import(new URL('core/etl/dist/index.js', root).href);
  const { writeSchemaDatabase } = await import(new URL('core/etl-sqlite/dist/index.js', root).href);
  const dir = mkdtempSync(join(tmpdir(), 'catalog-databases-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sets = [];
  for (const { pkg } of workspace) {
    for (const [source, { strategies }] of Object.entries(pkg.chronicle.sources ?? {})) {
      for (const [name, strategy] of Object.entries(strategies)) {
        const { databases = [] } = strategy;
        for (const schema of databases) {
          const tables = Object.entries(schema.tables ?? {});
          assert.ok(tables.length > 0, `${pkg.name}: a database of ${name} names no tables`);
          for (const [table, columns] of tables) {
            assert.ok(columns.length > 0, `${pkg.name}: ${table} names no columns`);
          }
        }
        if (databases.length > 0)
          sets.push({ source, strategy: name, databases, plugin: pkg.name });
      }
    }
  }
  // A database with only a schema's needed columns is in no other strategy's.
  for (const { source, strategy, databases, plugin } of sets) {
    for (const [i, schema] of databases.entries()) {
      const file = join(dir, `${source}-${strategy}-${i}.db`);
      writeSchemaDatabase(file, schema, { optional: false });
      const columns = readColumns(file);
      for (const other of sets) {
        if (other.source === source && other.strategy === strategy) continue;
        assert.equal(
          matchSchema(columns, other.databases),
          null,
          `${plugin}: ${source} ${strategy}'s database is also in ${other.source} ${other.strategy}'s`
        );
      }
    }
  }
});

test('no plugin names a record kind after a reserved word (all, defaults, help)', async () => {
  for (const { dir, pkg } of workspace) {
    for (const [source, { strategies }] of Object.entries(pkg.chronicle.sources ?? {})) {
      for (const strategy of Object.values(strategies)) {
        for (const kind of ['all', 'defaults', 'help']) {
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
