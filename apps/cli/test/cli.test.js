import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  };
  const run = (...args) =>
    spawnSync(process.execPath, [bin, ...args], {
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
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
  assert.deepEqual(sources.map(x => x.source).sort(), [
    'claude-code',
    'imessage',
    'shell',
    'things-todo',
  ]);
  const help = success(run('extract', 'shell', '--help'));
  assert.match(help, /history/);
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
  const output = success(
    run('extract', 'shell', '--input', input, '--raw', '--limit', '1', '--output', 'stdout')
  );
  assert.equal(JSON.parse(output).command, 'printf fixture');
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

test('global config and explicit flag precedence reach the dynamic dispatcher', t => {
  const { input, run } = fixture(t);
  success(run('config', 'set', 'limit', '1'));
  const args = ['extract', 'shell', '--input', input, '--raw'];
  assert.equal(JSON.parse(success(run(...args))).command, 'printf fixture');
  assert.equal((success(run(...args, '--limit', '0')).match(/"command"/g) || []).length, 2);
});

test('auth stores synthetic credentials and noninteractive missing token fails promptly', t => {
  const { dir, run } = fixture(t);
  success(run('auth', 'set', 'fixture', '--token', 'synthetic-token'));
  assert.match(readFileSync(join(dir, 'config/credentials.json'), 'utf8'), /synthetic-token/);
  const result = run('auth', 'set', 'missing');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--token/);
});

test('installed plugin discovery uses oclif data directory, including unscoped packages', t => {
  const { dir, run } = fixture(t);
  const plugin = join(dir, 'data/node_modules/fixture-plugin');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(
    join(plugin, 'package.json'),
    JSON.stringify({
      name: 'fixture-plugin',
      type: 'module',
      exports: './index.js',
      chronicle: { plugin: true },
    })
  );
  writeFileSync(
    join(plugin, 'index.js'),
    `export class Fixture { static source = 'fixture'; static strategy = 'file'; static delivery = 'export'; static recordTypes = ['rows']; static schema = {}; }`
  );
  assert.ok(
    JSON.parse(success(run('sources', '--format', 'json'))).some(x => x.source === 'fixture')
  );
});

test('unsupported loader and missing input file fail without success output', t => {
  const { run } = fixture(t);
  for (const args of [
    ['--loader', 'store'],
    ['--input', '/nonexistent-synthetic-history'],
  ]) {
    const result = run('extract', 'shell', ...args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /re-run to resume/);
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
        async setup() { ${phase === 'setup' ? "throw new Error('synthetic setup failure');" : ''} }
        async teardown() { writeFileSync(${JSON.stringify(marker)}, 'closed'); }
        async *extract() { yield this.createRecord({ name: 'fixture' }); }
      }`
    );
    const result = run('extract', 'fixture');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`synthetic ${phase} failure`));
    assert.equal(readFileSync(marker, 'utf8'), 'closed');
    assert.equal(result.stdout, '');
  }
});

test('missing CSV input reports a normal command error instead of an unhandled stream error', t => {
  const { dir, run } = fixture(t);
  const result = run('extract', 'csv', '--input', join(dir, 'missing.csv'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});
