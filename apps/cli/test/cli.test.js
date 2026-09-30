import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const bin = process.env.CHRONICLE_TEST_BIN || resolve(import.meta.dirname, '../bin/run.js');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    CHRONICLE_CONFIG_DIR: join(dir, 'config'),
    CHRONICLE_DATA_DIR: join(dir, 'data'),
    CHRONICLE_CACHE_DIR: join(dir, 'cache'),
    CHRONICLE_SKIP_NEW_VERSION_CHECK: '1',
    NO_COLOR: '1',
    // Keep oclif from wrapping error messages, so assertions don't depend on path length.
    OCLIF_COLUMNS: '1000',
  };
  const runWith =
    extra =>
    (...args) =>
      spawnSync(process.execPath, [bin, ...args], {
        cwd: dir,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 60000,
      });
  const run = Object.assign(runWith({}), { with: runWith });
  const input = join(dir, 'history');
  writeFileSync(input, ': 1700000000:0;echo synthetic\n: 1700000001:0;printf fixture\n');
  return { dir, env, input, run };
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

test('bundled sources are discoverable from an unrelated cwd; JSON has no diagnostics', t => {
  const { run } = fixture(t);
  const sources = JSON.parse(success(run('sources', '--format', 'json')));
  // Every workspace plugin the CLI depends on is a source, whether the CLI
  // runs from the workspace or from installed packages (CHRONICLE_TEST_BIN).
  const { dependencies } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
  );
  const pluginsDir = resolve(import.meta.dirname, '../../../plugins');
  const bundled = readdirSync(pluginsDir)
    .map(dir => join(pluginsDir, dir, 'package.json'))
    .filter(existsSync)
    .map(file => JSON.parse(readFileSync(file, 'utf8')))
    .filter(pkg => pkg.chronicle?.plugin === true && pkg.name in dependencies)
    .map(pkg => pkg.name);
  assert.ok(bundled.length > 0);
  const all = JSON.parse(success(run('sources', '--all', '--format', 'json')));
  for (const name of bundled) {
    assert.ok(
      all.some(x => x.package === name && x.installed),
      `${name} is not listed as installed`
    );
  }
  // A bare `chronicle extract <source>` needs exactly one default strategy per source.
  for (const { source, strategies } of all.filter(x => x.installed)) {
    const defaults = strategies.filter(strategy => strategy.default);
    assert.equal(defaults.length, 1, `${source} has ${defaults.length} default strategies`);
  }
  // Legacy sources are listed only on request, and the table says so.
  assert.ok(sources.every(x => x.tier !== 'legacy'));
  assert.match(success(run('sources')), /Not showing \d+ legacy sources.*chronicle sources --all/);
  const legacy = all.filter(x => x.tier === 'legacy');
  assert.ok(legacy.length > 0);
  assert.match(success(run('sources', 'info', legacy[0].source)), /tier: +legacy/);
  assert.match(success(run('sources', '--all')), new RegExp(`${legacy[0].source} .*legacy`));
  // An unknown source is reported as one, even with a source's own flags.
  const unknown = run('extract', 'no-such-source', '--limit', '1');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /No source named "no-such-source"/);

  const help = success(run('extract', 'shell', '--help'));
  assert.match(help, /history/);
  // `extract help [source]` reads like `git help`, and --list-types lists only the kinds.
  assert.equal(success(run('extract', 'help', 'shell')), help);
  assert.match(success(run('extract', 'help')), /chronicle extract <source> --help/);
  assert.equal(success(run('extract', 'shell', '--list-types')), 'commands  history\n');
  assert.doesNotMatch(success(run('--help')), /archive|sync|serve/);
});

test('raw extraction, four output loaders, file output and stream mode', t => {
  const { dir, input, run } = fixture(t);
  for (const loader of ['json', 'csv', 'yaml', 'table']) {
    const output = success(
      run(
        'extract',
        'shell',
        '--input',
        input,
        '--raw',
        '--limit',
        '1',
        '--loader',
        loader,
        '--quiet'
      )
    );
    assert.match(output, /printf fixture/);
    assert.doesNotMatch(output, /Scanning|Processed|\u001b/);
    const file = join(dir, `out.${loader}`);
    const stdout = success(
      run(
        'extract',
        'shell',
        '--input',
        input,
        '--raw',
        '--limit',
        '1',
        '--loader',
        loader,
        '--output',
        file,
        '--stream',
        '--quiet'
      )
    );
    assert.equal(stdout, '');
    assert.match(readFileSync(file, 'utf8'), /printf fixture/);
  }
  const result = run(
    'extract',
    'shell',
    '--input',
    input,
    '--raw',
    '--limit',
    '1',
    '--output',
    'stdout'
  );
  assert.equal(JSON.parse(success(result)).command, 'printf fixture');
  // Unless quiet, the run ends with its summary on stderr, stamped with the
  // time when stderr isn't a terminal, and the default --limit says when it
  // cut the run short.
  // Anchored to the end only: some Node versions warn on stderr first.
  assert.match(result.stderr, /(^|\n)\d\d:\d\d:\d\d ✓ shell · \S+ {2}1 command {2}in \S+\n$/);
  // A supervisor reads the same run as JSON events on stderr. --delay slows
  // each extracted record, for watching a run while debugging.
  const events = run(
    ...['extract', 'shell', '--input', input, '--raw', '--limit', '1'],
    ...['--log-format', 'json', '--delay', '150']
  )
    .stderr.split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line));
  const done = events.find(event => event.kind === 'summary');
  assert.deepEqual(done.fields.counts, { commands: 1 });
  assert.deepEqual(done.run.source, 'shell');
  assert.ok(events.every(event => event.run.id === done.run.id));
  assert.ok(done.fields.durationMs >= 150);
  const long = join(dir, 'long-history');
  writeFileSync(
    long,
    Array.from({ length: 101 }, (_, i) => `: ${1700000000 + i}:0;echo ${i}\n`).join('')
  );
  const capped = run('extract', 'shell', '--input', long, '--raw', '--output', 'stdout');
  assert.match(capped.stderr, /100 commands.*\n.*first 100 · use --limit 0 for all/);
  // With a count from the source (a streamed run asks), the hint says how many there are.
  const counted = run('extract', 'shell', '--input', long, '--raw', '--stream');
  assert.match(counted.stderr, /first 100 of 101 · use --limit 0 for all/);
  // The default limit that didn't cut anything short gets no hint.
  const exact = join(dir, 'exact-history');
  writeFileSync(
    exact,
    Array.from({ length: 100 }, (_, i) => `: ${1700000000 + i}:0;echo ${i}\n`).join('')
  );
  assert.doesNotMatch(run('extract', 'shell', '--input', exact, '--raw').stderr, /first 100/);
  const chosen = run('extract', 'shell', '--input', long, '--raw', '--limit', '100');
  assert.doesNotMatch(chosen.stderr, /first 100/);
  // Tabular output hints at the other column mode, but only when it would show more.
  const labelled = run('extract', 'shell', '--input', input, '--loader', 'csv');
  assert.match(labelled.stderr, /--columns schema/);
  const flat = run('extract', 'shell', '--input', input, '--raw', '--loader', 'csv');
  assert.doesNotMatch(flat.stderr, /--columns/);
  const schema = run(
    'extract',
    'shell',
    '--input',
    input,
    '--loader',
    'csv',
    '--columns',
    'schema'
  );
  assert.match(success(schema), /^@type,.*agent\.handle.*object\.body/);
  assert.doesNotMatch(schema.stderr, /--columns/);
});

test('CSV static command accepts piped input and file input', t => {
  const { dir, env, run } = fixture(t);
  const input = join(dir, 'input.csv');
  writeFileSync(input, 'name,value\nsynthetic,42\n');
  assert.equal(JSON.parse(success(run('extract', 'csv', '--input', input))).name, 'synthetic');
  const piped = spawnSync(process.execPath, [bin, 'extract', 'csv', '--input', '-'], {
    cwd: dir,
    env,
    input: 'name,value\nsynthetic,42\n',
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(JSON.parse(success(piped)).value, '42');
});

test('transformation flags pick fields, sample records and truncate base64', t => {
  const { dir, input, run } = fixture(t);
  const args = ['extract', 'shell', '--input', input, '--raw', '--limit', '0', '--loader', 'csv'];
  assert.equal(
    success(run(...args, '--fields', 'command')),
    'command\nprintf fixture\necho synthetic\n'
  );
  assert.equal(success(run(...args, '--sample', '0')), '');
  assert.equal(success(run(...args, '--sample', '1')).split('\n').length, 4);
  assert.notEqual(run(...args, '--sample', '2').status, 0);

  const csv = join(dir, 'encoded.csv');
  writeFileSync(csv, `name,encoded\nsynthetic,${'A'.repeat(200)}\n`);
  const record = JSON.parse(success(run('extract', 'csv', '--input', csv, '--truncate-base64')));
  assert.equal(record.name, 'synthetic');
  assert.equal(record.encoded.length, 103);
});

test('global config and explicit flag precedence reach the dynamic dispatcher', t => {
  const { input, run } = fixture(t);
  success(run('config', 'set', 'limit', '1'));
  const args = ['extract', 'shell', '--input', input, '--raw'];
  assert.equal(JSON.parse(success(run(...args))).command, 'printf fixture');
  assert.equal((success(run(...args, '--limit', '0')).match(/"command"/g) || []).length, 2);
});

test('auth stores and removes synthetic credentials; missing token fails promptly', t => {
  const { dir, run } = fixture(t);
  success(run('auth', 'set', 'fixture', '--token', 'synthetic-token'));
  assert.match(readFileSync(join(dir, 'config/credentials.json'), 'utf8'), /synthetic-token/);
  assert.match(success(run('auth', 'status', 'fixture')), /Valid/);
  success(run('auth', 'remove', 'fixture'));
  assert.match(success(run('auth', 'status', 'fixture')), /No credentials stored/);
  const result = run('auth', 'set', 'missing');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--token/);
});

test('plugins install a local plugin that shares the CLI’s etl and auth, and uninstall it', t => {
  const { dir, run } = fixture(t);
  // Outside any node_modules, the plugin's imports resolve only through the
  // CLI's shared modules.
  const plugin = join(dir, 'fixture-plugin');
  mkdirSync(plugin);
  writeFileSync(
    join(plugin, 'package.json'),
    JSON.stringify({
      name: 'fixture-plugin',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
      chronicle: { plugin: true },
    })
  );
  writeFileSync(
    join(plugin, 'index.js'),
    `import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { Extractor } from '@chronicle.app/etl';
OAuthProviderRegistry.register(class { static providerId = 'fixture'; static getConfig() { return {}; } });
export class Fixture extends Extractor {
  static source = 'fixture'; static strategy = 'file'; static delivery = 'export';
  static recordTypes = ['rows']; static default = true;
  async *extract() { yield this.createRecord({ name: 'installed fixture' }); }
}`
  );
  success(run('plugins', 'install', './fixture-plugin'));
  // Reinstalling from the same path leaves its dependency entry unchanged.
  success(run('plugins', 'install', './fixture-plugin'));
  assert.match(success(run('plugins')), /fixture-plugin 1\.0\.0 +installed/);
  const [listing] = JSON.parse(success(run('sources', '--source', 'fixture', '--format', 'json')));
  assert.equal(listing.origin, 'installed');
  assert.equal(listing.tier, null);
  assert.match(success(run('sources', '--source', 'fixture')), /not in catalog · fixture-plugin/);
  assert.match(success(run('auth', 'login', '--list')), /fixture/);
  const extracted = run('extract', 'fixture', '--raw');
  assert.equal(JSON.parse(success(extracted)).name, 'installed fixture');
  // Sharing modules with plugins uses no deprecated loader API (DEP0205 on Node 26+).
  assert.doesNotMatch(extracted.stderr, /DeprecationWarning/);

  success(run('plugins', 'uninstall', 'fixture-plugin'));
  assert.equal(
    JSON.parse(success(run('sources', '--source', 'fixture', '--format', 'json'))).length,
    0
  );
});

test('a default input picks no strategy; an --input you give picks the export', t => {
  const { dir, run } = fixture(t);
  // Shaped like WhatsApp: a local default that knows its database's path, and
  // an export strategy that requires a file you hand it. (Export names sort
  // alphabetically, and the later class's --input wins, as WhatsApp's does.)
  mkdirSync(join(dir, 'two-strategies'));
  writeFileSync(
    join(dir, 'two-strategies/package.json'),
    JSON.stringify({ name: 'two-strategies', type: 'module', exports: './index.js' })
  );
  writeFileSync(
    join(dir, 'two-strategies/index.js'),
    `import { Extractor, z } from '@chronicle.app/etl';
export class LocalDb extends Extractor {
  static source = 'two'; static strategy = 'app-db'; static delivery = 'local';
  static recordTypes = ['rows']; static default = true;
  static schema = Extractor.schema.extend({ input: z.string().default('/nowhere/app.db') });
  async *extract() { yield this.createRecord({ from: 'app-db' }); }
}
export class Backup extends Extractor {
  static source = 'two'; static strategy = 'dump'; static delivery = 'export';
  static recordTypes = ['rows'];
  static schema = Extractor.schema.extend({ input: z.string() });
  async *extract() { yield this.createRecord({ from: 'dump' }); }
}`
  );
  success(run('plugins', 'add', './two-strategies'));
  assert.equal(JSON.parse(success(run('extract', 'two', '--raw'))).from, 'app-db');
  assert.equal(JSON.parse(success(run('extract', 'two', '--raw', '--input', 'x'))).from, 'dump');
  assert.equal(
    JSON.parse(success(run('extract', 'two', '--raw', '--strategy', 'dump', '--input', 'x'))).from,
    'dump'
  );
});

test('plugins add runs a file in place, taking over its source until removed', t => {
  const { dir, input, run } = fixture(t);
  writeFileSync(
    join(dir, 'my-shell.js'),
    `import { Extractor } from '@chronicle.app/etl';
export class MyShell extends Extractor {
  static source = 'shell'; static strategy = 'history'; static delivery = 'local';
  static recordTypes = ['commands']; static default = true;
  async *extract() { yield this.createRecord({ command: 'local fixture' }); }
}`
  );
  writeFileSync(join(dir, 'empty.js'), 'export const nothing = 1;\n');

  assert.match(success(run('plugins', 'add', './my-shell.js')), /chronicle extract shell/);
  const refused = run('plugins', 'add', './empty.js');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /No extractor found/);
  mkdirSync(join(dir, 'copy'));
  writeFileSync(join(dir, 'copy', 'my-shell.js'), readFileSync(join(dir, 'my-shell.js')));
  const sameName = run('plugins', 'add', './copy/my-shell.js');
  assert.notEqual(sameName.status, 0);
  assert.match(sameName.stderr, /already named my-shell/);
  assert.match(success(run('plugins')), /my-shell +local/);
  const [listing] = JSON.parse(success(run('sources', '--source', 'shell', '--format', 'json')));
  assert.equal(listing.origin, 'local');
  assert.match(success(run('sources', '--source', 'shell')), /local · my-shell/);

  // A second local plugin for the source keeps the first one's extractors.
  writeFileSync(
    join(dir, 'other-shell.js'),
    `import { Extractor } from '@chronicle.app/etl';
export class OtherShell extends Extractor {
  static source = 'shell'; static strategy = 'other'; static delivery = 'local';
  static recordTypes = ['commands'];
  async *extract() { yield this.createRecord({ command: 'other fixture' }); }
}`
  );
  success(run('plugins', 'add', './other-shell.js'));
  const strategies = JSON.parse(success(run('sources', '--source', 'shell', '--format', 'json')));
  assert.match(JSON.stringify(strategies), /"history"/);
  assert.match(JSON.stringify(strategies), /"other"/);
  success(run('plugins', 'remove', 'other-shell'));

  const local = run('extract', 'shell', '--raw');
  assert.equal(JSON.parse(success(local)).command, 'local fixture');
  assert.match(local.stderr, /Using the local plugin for shell/);
  assert.doesNotMatch(run('extract', 'csv', '--input', input).stderr, /local plugin/);

  success(run('plugins', 'remove', 'my-shell'));
  const bundled = run('extract', 'shell', '--input', input, '--raw', '--limit', '1');
  assert.equal(JSON.parse(success(bundled)).command, 'printf fixture');
  assert.doesNotMatch(bundled.stderr, /local plugin/);

  // A deleted plugin folder can still be removed by its name, and otherwise
  // comes off the list on the next run.
  const localList = () =>
    JSON.parse(readFileSync(join(dir, 'config/config.json'), 'utf8')).plugins ?? [];
  for (const name of ['gone-first', 'gone-second']) {
    mkdirSync(join(dir, name));
    writeFileSync(
      join(dir, name, 'package.json'),
      JSON.stringify({ name, type: 'module', exports: './index.js' })
    );
    writeFileSync(join(dir, name, 'index.js'), readFileSync(join(dir, 'other-shell.js')));
    success(run('plugins', 'add', `./${name}`));
    rmSync(join(dir, name), { recursive: true });
  }
  success(run('plugins', 'remove', 'gone-first'));
  assert.doesNotMatch(localList().join(), /gone-first/);
  const pruned = run('sources', '--format', 'json');
  assert.match(success(pruned), /^\[/);
  assert.match(pruned.stderr, /Removed a local plugin that no longer exists {2}path=.*gone-second/);
  assert.deepEqual(localList(), []);
  assert.doesNotMatch(run('sources', '--format', 'json').stderr, /gone-second/);
});

test('plugins new scaffolds a plugin for the source kind that reads it and passes its smoke test', t => {
  const { dir, run } = fixture(t);
  writeFileSync(join(dir, 'export.csv'), 'Title,Date\nSynthetic row,2024-01-01\n');

  // Without a terminal, how the data arrives must be given.
  const unasked = run('plugins', 'new', 'my-rows');
  assert.notEqual(unasked.status, 0);
  assert.match(unasked.stderr, /--from/);

  assert.match(success(run('plugins', 'new', 'my-rows', '--from', 'csv')), /AGENTS\.md/);
  const plugin = join(dir, 'my-rows');
  assert.match(readFileSync(join(plugin, 'AGENTS.md'), 'utf8'), /## Start here/);
  assert.match(success(run('plugins')), /my-rows 0\.1\.0 +local/);

  // Runs from its .ts source without a build, relaunching Node to strip types
  // where it doesn't by default.
  const rows = success(run('extract', 'my-rows', '--input', 'export.csv', '--raw', '--preview'));
  assert.match(rows, /Title: Synthetic row/);

  // Its smoke test passes against the Chronicle packages the CLI runs with.
  let root = resolve(bin, '..');
  while (!existsSync(join(root, 'node_modules/@chronicle.app/etl'))) root = resolve(root, '..');
  mkdirSync(join(plugin, 'node_modules/@chronicle.app'), { recursive: true });
  for (const name of ['etl', 'schema']) {
    symlinkSync(
      realpathSync(join(root, 'node_modules/@chronicle.app', name)),
      join(plugin, 'node_modules/@chronicle.app', name)
    );
  }
  const smoke = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--test',
      'src/my-rows.test.js',
    ],
    { cwd: plugin, encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(smoke.status, 0, smoke.stdout + smoke.stderr);

  assert.notEqual(run('plugins', 'new', 'my-rows', '--from', 'csv').status, 0);
  assert.notEqual(run('plugins', 'new', 'lastfm', '--from', 'csv').status, 0);
  const onFile = run('plugins', 'new', 'my-file', '--from', 'csv', '--dir', 'export.csv');
  assert.notEqual(onFile.status, 0);
  assert.match(onFile.stderr, /isn't a folder/);
});

test(
  'a catalog source that is not installed points at plugins install',
  // Beside the packed CLI, every plugin is installed.
  { skip: process.env.CHRONICLE_TEST_BIN && 'every plugin is installed in the packed check' },
  t => {
    const { run } = fixture(t);
    const env = { CHRONICLE_WORKSPACE_PLUGINS: '0' };
    const all = JSON.parse(success(run.with(env)('sources', '--all', '--format', 'json')));
    // Without the checkout's plugins, exactly the bundled ones are installed.
    const { dependencies } = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
    );
    for (const x of all) assert.equal(x.installed, x.package in dependencies, x.package);

    const missing = all.find(x => x.source === 'google-reader');
    assert.equal(missing.installed, false);
    // Listed from the manifest the catalog carries, though not installed.
    assert.deepEqual(
      missing.strategies.map(strategy => strategy.name),
      ['takeout']
    );
    const result = run.with(env)('extract', 'google-reader', '--limit', '1');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /chronicle plugins install google-reader/);
    assert.match(
      success(run.with(env)('extract', 'google-reader', '--help')),
      /chronicle plugins install google-reader/
    );
  }
);

test('unsupported loader and missing input file fail without success output, even when quiet', t => {
  const { dir, run } = fixture(t);
  for (const args of [
    ['--loader', 'store'],
    ['--input', '/nonexistent-synthetic-history'],
  ]) {
    const result = run('extract', 'shell', ...args, '--quiet');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /re-run to resume/);
  }
  // A missing or unreadable input is a typed failure: a clear message, a next
  // step, and exit code 4, which a supervisor reads as "needs attention".
  const missing = run('extract', 'shell', '--input', '/nonexistent-synthetic-history');
  assert.equal(missing.status, 4);
  assert.match(missing.stderr, /No shell history found {2}path=\/nonexistent-synthetic-history/);
  if (process.getuid?.() !== 0) {
    const locked = join(dir, 'locked-history');
    writeFileSync(locked, ': 1700000000:0;echo synthetic\n');
    chmodSync(locked, 0o000);
    const refused = run('extract', 'shell', '--input', locked);
    assert.equal(refused.status, 4);
    assert.match(refused.stderr, /Can't read the shell history.*\n.*check the file's permissions/);
  }
});

test('preset selection and explicit values override global config', t => {
  const { input, run } = fixture(t);
  success(run('config', 'set', 'limit', '1'));
  success(run('config', 'preset', 'create', 'all', '--limit', '0'));
  const args = ['extract', 'shell', '--input', input, '--raw', '--preset', 'all'];
  assert.equal((success(run(...args)).match(/"command"/g) || []).length, 2);
  assert.equal(JSON.parse(success(run(...args, '--limit', '1'))).command, 'printf fixture');
});

test('failed setup and transformation release extractor resources and exit nonzero', async t => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const etlPath = createRequire(bin)
    .resolve.paths('@chronicle.app/etl')
    .map(root => join(root, '@chronicle.app/etl/dist/index.js'))
    .find(path => existsSync(path));
  const etl = pathToFileURL(etlPath).href;
  for (const phase of ['setup', 'transform']) {
    const { dir, run } = fixture(t);
    const plugin = join(dir, 'data/node_modules/failing-fixture');
    const marker = join(dir, 'closed');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      join(plugin, 'package.json'),
      JSON.stringify({
        name: 'failing-fixture',
        type: 'module',
        main: './index.js',
        chronicle: { plugin: true },
      })
    );
    writeFileSync(
      join(plugin, 'index.js'),
      `
      import { Extractor, Transformer } from ${JSON.stringify(etl)};
      import { writeFileSync } from 'node:fs';
      class FailingTransformer extends Transformer { async transform() { throw new Error('synthetic transform failure'); } }
      export class Fixture extends Extractor {
        static source = 'fixture'; static strategy = 'file'; static delivery = 'export'; static recordTypes = ['rows'];
        static defaultTransformer = FailingTransformer;
        async setup() { this.logger.warn('synthetic warning'); console.log('synthetic console output'); ${phase === 'setup' ? "throw new Error('synthetic setup failure');" : ''} }
        async teardown() { writeFileSync(${JSON.stringify(marker)}, 'closed'); }
        async *extract() { yield this.createRecord({ name: 'fixture' }); }
      }`
    );
    const result = run('extract', 'fixture');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`synthetic ${phase} failure`));
    // Plugin warnings reach stderr even when stdout is piped.
    assert.match(result.stderr, /! fixture\.file {2}synthetic warning/);
    // A plugin's console output becomes its diagnostics on stderr, never records on stdout.
    assert.match(result.stderr, /· fixture\.file {2}synthetic console output/);
    assert.equal(readFileSync(marker, 'utf8'), 'closed');
    assert.equal(result.stdout, '');
  }
});

test('missing CSV input reports a normal command error instead of an unhandled stream error', t => {
  const { dir, run } = fixture(t);
  const result = run('extract', 'csv', '--input', join(dir, 'missing.csv'));
  assert.equal(result.status, 4);
  assert.match(result.stderr, /No CSV file found/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

test('table columns fit their content, and grow columns share the width that is left', async () => {
  const { columnWidths, truncate } = await import('../dist/components/Table.js');
  const columns = [
    { key: 'source', title: 'Source' },
    { key: 'types', title: 'Types', grow: true, minWidth: 5 },
    { key: 'description', title: 'Description', grow: true, minWidth: 8 },
  ];
  const data = [{ source: 'google-reader', types: 'a'.repeat(30), description: 'b'.repeat(40) }];

  // Without a width, every column fits its content.
  assert.deepEqual(columnWidths(columns, data), [13, 30, 40]);
  // Too narrow for everything: grow columns get their minimum; the rest never shrink.
  assert.deepEqual(columnWidths(columns, data, 20), [13, 5, 8]);
  // The leftover is split evenly on top of each minimum…
  assert.deepEqual(columnWidths(columns, data, 47), [13, 14, 16]);
  // …and a column that fits its content passes its share on.
  assert.deepEqual(columnWidths(columns, data, 200), [13, 30, 40]);
  assert.deepEqual(columnWidths(columns, [{ ...data[0], types: 'abc' }], 47), [13, 5, 25]);

  assert.equal(truncate('channels, connections', 10), 'channels,…');
  assert.equal(truncate('calls', 10), 'calls');
});

test('a plugin fails with a typed error and exit code, and hints under the summary', async t => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const etlPath = createRequire(bin)
    .resolve.paths('@chronicle.app/etl')
    .map(root => join(root, '@chronicle.app/etl/dist/index.js'))
    .find(path => existsSync(path));
  const etl = pathToFileURL(etlPath).href;
  const { dir, run } = fixture(t);
  const plugin = join(dir, 'data/node_modules/typed-fixture');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(
    join(plugin, 'package.json'),
    JSON.stringify({
      name: 'typed-fixture',
      type: 'module',
      main: './index.js',
      chronicle: { plugin: true },
    })
  );
  writeFileSync(
    join(plugin, 'index.js'),
    `
    import { AuthRequired, Extractor } from ${JSON.stringify(etl)};
    export class Fixture extends Extractor {
      static source = 'typed'; static strategy = 'api'; static delivery = 'api'; static recordTypes = ['rows'];
      async setup() {
        if (process.env.FIXTURE_MODE === 'auth') throw new AuthRequired('No typed credentials', { source: 'typed' });
      }
      async *extract() {
        this.hint('attachments skipped', { action: 'grant access to include them' });
        yield this.createRecord({ name: 'fixture' });
      }
    }`
  );
  // Auth: exit code 3, the sign-in command as the next step, and in JSON as data.
  const auth = run.with({ FIXTURE_MODE: 'auth' })('extract', 'typed', '--raw');
  assert.equal(auth.status, 3);
  assert.match(auth.stderr, /No typed credentials\n.*run `chronicle auth login typed`/);
  assert.equal(auth.stdout, '');
  const events = run
    .with({ FIXTURE_MODE: 'auth' })('extract', 'typed', '--raw', '--log-format', 'json')
    .stderr.split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line));
  const failure = events.find(event => event.kind === 'error');
  assert.deepEqual(failure.error, { code: 'auth-required', exitCode: 3 });
  assert.equal(failure.hint.action, 'run `chronicle auth login typed`');
  // A plugin's hint on a successful run prints under the summary.
  const hinted = run('extract', 'typed', '--raw');
  assert.equal(hinted.status, 0, hinted.stderr);
  assert.match(
    hinted.stderr,
    /✓ typed · api {2}1 row.*\n.*attachments skipped · grant access to include them\n/
  );
});
