import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';
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
    // `node --test` at a terminal sets FORCE_COLOR, and Node warns on stderr
    // when it's set alongside NO_COLOR.
    FORCE_COLOR: undefined,
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
  // A bare `chronicle extract <source>` reads one strategy's defaults, so a
  // source has at most one; with none, the run asks which kinds.
  for (const { source, strategies } of all.filter(x => x.installed)) {
    const defaults = strategies.filter(strategy => strategy.default);
    assert.ok(defaults.length <= 1, `${source} has ${defaults.length} default strategies`);
  }
  // Legacy sources are listed only on request, and a hint under the table says so.
  assert.ok(sources.every(x => x.tier !== 'legacy'));
  const table = run('sources');
  // A status column only where a source isn't ready to run, such as one for another OS.
  assert.match(success(table), /^source +strategy +(status +)?description/);
  assert.match(table.stderr, /Not showing \d+ legacy sources.*chronicle sources --all/);
  const legacy = all.filter(x => x.tier === 'legacy');
  assert.ok(legacy.length > 0);
  assert.match(success(run('sources', 'info', legacy[0].source)), /tier +legacy/);
  assert.match(success(run('sources', '--all')), new RegExp(`^${legacy[0].source} .*legacy`, 'm'));
  // An unknown source is reported as one, even with a source's own flags.
  const unknown = run('extract', 'no-such-source', '--limit', '1');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /No source named "no-such-source"/);

  const help = success(run('extract', 'shell', '--help'));
  assert.match(help, /history/);
  // `extract help [source]` reads like `git help`, `help` after the source
  // asks for help too, and --list-types lists only the kinds.
  assert.equal(success(run('extract', 'help', 'shell')), help);
  assert.equal(success(run('extract', 'shell', 'help')), help);
  assert.match(success(run('extract', 'help')), /chronicle extract <source>/);
  const listed = run('extract', 'shell', '--list-types');
  assert.equal(success(listed), 'commands  history\n');
  // With one kind there's nothing to pick, so no hint. With several, how to
  // pick goes to stderr, with a runnable example, so the list still pipes.
  // (Older Node versions warn about SQLite on stderr; that isn't a hint.)
  assert.doesNotMatch(listed.stderr, /chronicle extract shell/);
  assert.match(run('extract', 'github', '--list-types').stderr, /chronicle extract github \w+/);
  assert.doesNotMatch(success(run('--help')), /archive|sync|serve/);

  // Usage mistakes: exit 2, a typed error, and a hint naming the way forward.
  // The wording is the style guide's to keep, not this test's.
  const usageError = (args, code, mentions) => {
    const result = run(...args, '--log-format', 'json');
    assert.equal(result.status, 2, args.join(' '));
    const error = result.stderr
      .split('\n')
      .filter(line => line.startsWith('{'))
      .map(line => JSON.parse(line))
      .find(event => event.kind === 'error');
    assert.ok(error, `${args.join(' ')} reports an error`);
    if (code) assert.equal(error.error.code, code, args.join(' '));
    if (mentions) assert.match(error.hint?.action ?? '', mentions, args.join(' '));
  };
  usageError(['extract', 'shell', '--type', 'command'], 'unknown-record-type', /shell commands/);
  usageError(['extract', 'shell', '--type', 'likes'], 'unknown-record-type', /--list-types/);
  usageError(['extract', 'shell', '-T'], 'unknown-flag', /--type/);
  usageError(['extract', 'shell', '-t'], 'missing-flag-value', /--list-types/);
  usageError(['extract', 'shell', 'commands', '--type', 'commands']);
  usageError(['extract'], undefined, /chronicle sources/);
  usageError(['sorces'], 'unknown-command', /chronicle sources/);
  // Every error reads the same way: Chronicle's error line, never oclif's.
  for (const args of [['extract'], ['sorces'], ['extract', 'shell', '-T']]) {
    const { stderr } = run(...args);
    assert.match(stderr, /✗ Error: /, args.join(' '));
    assert.doesNotMatch(stderr, /›|USAGE/, args.join(' '));
  }
  // The source help lists --type and --list-types with the common flags.
  assert.match(help, /-L, --list-types/);
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
  // The outcome on one line, a line per kind under it.
  assert.match(result.stderr, /✓ shell · .*\n.*1 command\n$/);
  // A kind named after the source reads just that kind.
  const named = run('extract', 'shell', 'commands', '--input', input, '--raw', '--limit', '1');
  assert.equal(JSON.parse(success(named)).command, 'printf fixture');
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
  assert.match(capped.stderr, /100 commands\n.*↳ .*--limit 0/);
  // With a count from the source (a streamed run asks), the hint says how many there are.
  const counted = run('extract', 'shell', '--input', long, '--raw', '--stream');
  assert.match(counted.stderr, /↳ .*101.*--limit 0/);
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
  // A type every row shares is left out of the table rather than set above it.
  const table = success(run('extract', 'shell', '--input', input, '--loader', 'table'));
  assert.match(table, /echo synthetic/);
  assert.doesNotMatch(table, /Action/);
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
  assert.equal(success(run('config', 'get', 'limit')), '1\n');
  const args = ['extract', 'shell', '--input', input, '--raw'];
  assert.equal(JSON.parse(success(run(...args))).command, 'printf fixture');
  assert.equal((success(run(...args, '--limit', '0')).match(/"command"/g) || []).length, 2);
  // Without a terminal to confirm at, a reset says to use --force instead of hanging or crashing.
  const reset = run('config', 'reset');
  assert.equal(reset.status, 2);
  assert.match(reset.stderr, /chronicle config reset --force/);
  success(run('config', 'reset', '--force'));
  assert.notEqual(run('config', 'get', 'limit').status, 0);
});

test('every command has help, asked for any way, drawn by the help class', async t => {
  const { env, run } = fixture(t);
  const listed = JSON.parse(success(run('commands', '--format', 'json')));
  const ask = args =>
    new Promise(resolve => {
      const child = spawn(process.execPath, [bin, ...args], { env, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => (stdout += chunk));
      child.stderr.on('data', chunk => (stderr += chunk));
      child.on('close', status => resolve({ status, stdout, stderr }));
    });
  // Multi-word commands as a shell passes them: each word its own argument.
  // `help` after the words asks too, whether they take an argument or not.
  const asked = listed
    .map(({ command }) => command.split(' '))
    .filter(words => words.length > 1)
    .flatMap(words => [
      [...words, '--help'],
      ['help', ...words],
      [...words, 'help'],
    ]);
  const results = await Promise.all(asked.map(ask));
  for (const [i, { status, stdout, stderr }] of results.entries()) {
    const args = asked[i].join(' ');
    assert.equal(status, 0, `${args}: ${stderr}`);
    const id = asked[i].filter(word => word !== 'help' && word !== '--help').join(' ');
    // The usage line names the command; oclif's own help would say USAGE and $.
    assert.match(stdout, new RegExp(`^Usage\\n  chronicle ${id}`, 'm'), args);
    assert.doesNotMatch(stdout, /USAGE|\$ chronicle|--\w[\w-]*=</, args);
  }
  // Topics list their commands, and the root lists each command once.
  assert.match(success(run('config', 'preset', '--help')), /config preset show/);
  assert.equal(
    success(run('config', 'preset', 'help')),
    success(run('config', 'preset', '--help'))
  );
  assert.equal(success(run('sources', 'help')), success(run('sources', '--help')));
  const root = success(run('--help'));
  assert.equal(root.match(/^ {2}extract /gm)?.length, 1);
  assert.doesNotMatch(root, /^ {2}e /m);
  // `commands` lists them all the same way, oclif's in plain words.
  const commands = success(run('commands'));
  assert.match(commands, /^command +description\n/);
  assert.match(commands, /^config preset show +Show a preset's flags$/m);
  assert.match(commands, /^autocomplete +Set up tab completion for your shell$/m);
  // Piped, no column is cut, however long.
  assert.match(
    commands,
    /^auth set +Store an API key or token for a provider that doesn't use OAuth$/m
  );
  assert.doesNotMatch(commands, /^e /m);
  // A whole command in one quoted argument gets it back with its words apart.
  const quoted = run('auth list --help', '--log-format', 'json');
  assert.equal(quoted.status, 2);
  assert.match(quoted.stderr, /unknown-command.*chronicle auth list --help/);
  // Asked for help, it's given back with --help kept, and the flags after it.
  const quotedHelp = run('auth list', '--help', '--log-format', 'json');
  assert.equal(quotedHelp.status, 2);
  assert.match(
    JSON.parse(quotedHelp.stderr).hint.action,
    /`chronicle auth list --help --log-format json`/
  );
  assert.match(run('help', 'auth list').stderr, / chronicle auth list --help\n/);
  // `help` is oclif's command, without --log-format; its unknown command reads like any other.
  const unknown = run('help', 'nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /✗ Error: Unknown command "nope"/);
  assert.equal(
    JSON.parse(run('nope', '--help', '--log-format', 'json').stderr).error.code,
    'unknown-command'
  );
  // A typo under a command that's also a topic gets the closest command.
  const typo = run('plugins', 'instal');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /`chronicle plugins install`/);
  // `--nested-commands` lists every command, not just the top level.
  const nested = success(run('help', '--nested-commands'));
  assert.match(nested, /^ {2}config preset show /m);
  assert.doesNotMatch(root, /^ {2}config preset show /m);
});

test('auth stores and removes synthetic credentials; missing token fails promptly', t => {
  const { dir, run } = fixture(t);
  success(run('auth', 'set', 'fixture', '--token', 'synthetic-token'));
  assert.match(readFileSync(join(dir, 'config/credentials.json'), 'utf8'), /synthetic-token/);
  assert.match(success(run('auth', 'status', 'fixture')), /status +valid/);
  assert.match(success(run('auth', 'list')), /fixture +valid/);
  success(run('auth', 'remove', 'fixture'));
  // Nothing stored is the same error, with the same way forward, whatever asks.
  for (const verb of ['status', 'remove']) {
    const none = run('auth', verb, 'fixture', '--log-format', 'json');
    assert.equal(none.status, 2, verb);
    const error = JSON.parse(none.stderr.split('\n').find(line => line.includes('"error"')));
    assert.equal(error.error.code, 'no-credentials', verb);
    assert.match(error.hint.action, /chronicle auth list/, verb);
  }
  const result = run('auth', 'set', 'missing');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--token/);
});

test('Google sign-in needs its setup at a terminal, or a client file', t => {
  const { dir, run } = fixture(t);
  // No terminal to walk through the setup in.
  const unattended = run('auth', 'login', 'google');
  assert.equal(unattended.status, 3);
  assert.match(unattended.stderr, /chronicle auth login google/);

  const typo = run('auth', 'login', 'google', '--add', 'mail');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /gmail/);

  // A downloaded client goes straight to Google's sign-in page, with PKCE and
  // the default access; nobody signs in, so it times out.
  const file = join(dir, 'client_secret_synthetic.json');
  writeFileSync(
    file,
    JSON.stringify({ installed: { client_id: 'synthetic-id', client_secret: 's' } })
  );
  const login = run(
    'auth',
    'login',
    'google',
    '--client-file',
    file,
    '--no-browser',
    '--timeout',
    '1',
    '--port',
    '0'
  );
  assert.notEqual(login.status, 0);
  const url = new URL(login.stderr.match(/https:\/\/accounts\.google\.com\S+/)[0]);
  assert.equal(url.searchParams.get('client_id'), 'synthetic-id');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state'));
  assert.match(url.searchParams.get('scope'), /gmail\.readonly.*calendar\.readonly/);
});

test('a sign-in reply for another sign-in is refused', async t => {
  const { dir, env } = fixture(t);
  const file = join(dir, 'client.json');
  writeFileSync(
    file,
    JSON.stringify({ installed: { client_id: 'synthetic-id', client_secret: 's' } })
  );
  const child = spawn(
    process.execPath,
    [bin, 'auth', 'login', 'google', '--client-file', file, '--no-browser', '--port', '0'],
    { cwd: dir, env }
  );
  let stderr = '';
  const exited = new Promise(resolve => child.on('close', resolve));
  const url = await new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => {
      stderr += chunk;
      const found = stderr.match(/https:\/\/accounts\.google\.com\S+/);
      if (found) resolve(new URL(found[0]));
    });
    child.on('close', () => reject(new Error(stderr)));
  });
  // A reply with a state this sign-in didn't send: another page's, or forged.
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('code', 'synthetic-code');
  callback.searchParams.set('state', 'not-this-one');
  await fetch(callback);
  assert.notEqual(await exited, 0);
  assert.match(stderr, /different sign-in/);
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
  assert.match(success(run('plugins')), /fixture-plugin +1\.0\.0 +installed/);
  const [listing] = JSON.parse(success(run('sources', '--source', 'fixture', '--format', 'json')));
  assert.equal(listing.origin, 'installed');
  assert.equal(listing.tier, null);
  assert.match(success(run('sources', 'info', 'fixture')), /plugin +fixture-plugin\n/);
  assert.match(success(run('sources', 'info', 'fixture')), /tier +not in catalog/);
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
  assert.match(success(run('sources', 'info', 'shell')), /plugin +my-shell\n/);

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

test('a run that names no kinds reads those its options ask for', t => {
  const { dir, run } = fixture(t);
  writeFileSync(
    join(dir, 'tally.js'),
    `import { Extractor, z } from '@chronicle.app/etl';
class Tally extends Extractor {
  static source = 'tally'; static strategy = 'local'; static delivery = 'local';
  static schema = Extractor.schema.extend({ only: z.string().optional() });
  static kindsFor = config => (config.only ? [config.only] : undefined);
  async *extract() { yield this.createRecord({ kind: this.constructor.recordTypes[0] }); }
}
export class Apples extends Tally { static recordTypes = ['apples']; }
export class Pears extends Tally { static recordTypes = ['pears']; }`
  );
  success(run('plugins', 'add', './tally.js'));

  // Neither kind is a default, so without the option a run must name one.
  const unnamed = run('extract', 'tally', '--raw');
  assert.notEqual(unnamed.status, 0);
  assert.match(unnamed.stderr, /No record types given/);
  assert.equal(
    JSON.parse(success(run('extract', 'tally', '--only', 'pears', '--raw'))).kind,
    'pears'
  );

  // Kinds named win, and the run says which the option asks for that it leaves out.
  const output = join(dir, 'apples.json');
  const named = run('extract', 'tally', 'apples', '--only', 'pears', '--output', output);
  success(named);
  const written = readFileSync(output, 'utf8');
  assert.match(written, /"apples"/);
  assert.doesNotMatch(written, /"pears"/);
  assert.match(named.stderr, /The options ask for pears too, which this run doesn't read/);
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
  assert.match(success(run('plugins')), /my-rows +0\.1\.0 +local/);

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

/**
 * A home folder holding what sources scan looks for: shell histories, Chrome
 * profiles with the folder Chrome keeps beside them, and an Obsidian vault
 * the registry lists beside one that's gone. Chrome and Obsidian sit where
 * each looks on macOS and on Linux.
 */
function scanHome(dir) {
  const home = join(dir, 'home');
  const plant = (file, content = 'synthetic') => {
    mkdirSync(dirname(join(home, file)), { recursive: true });
    writeFileSync(join(home, file), content);
  };
  plant('.zsh_history', ': 1700000000:0;echo synthetic\n');
  plant('.bash_history', '');
  for (const userData of ['Library/Application Support/Google/Chrome', '.config/google-chrome']) {
    for (const profile of ['Default', 'Profile 1', 'System Profile']) {
      plant(`${userData}/${profile}/History`);
    }
    plant(
      `${userData}/Local State`,
      JSON.stringify({
        profile: { info_cache: { Default: { name: 'Personal' }, 'Profile 1': { name: 'Work' } } },
      })
    );
  }
  const vault = join(dir, 'My Vault');
  mkdirSync(join(vault, '.obsidian'), { recursive: true });
  writeFileSync(join(vault, 'note.md'), '# Synthetic\n');
  for (const config of ['Library/Application Support/obsidian', '.config/obsidian']) {
    plant(
      `${config}/obsidian.json`,
      JSON.stringify({ vaults: { a: { path: vault }, b: { path: join(dir, 'gone') } } })
    );
  }
  return { home, vault };
}

test('sources scan finds what a home folder holds, with a command that extracts each', t => {
  const { dir, run } = fixture(t);
  const { home, vault } = scanHome(dir);
  const scan = run.with({ HOME: home, GH_TOKEN: 'synthetic-token' });
  const rows = JSON.parse(success(scan('sources', 'scan', '--format', 'json')));
  const row = (source, label) => rows.find(r => r.source === source && r.label === label);

  // Shell's defaults find zsh first; bash needs its flag, and an empty history says so.
  assert.equal(row('shell', '~/.zsh_history').command, 'chronicle extract shell');
  assert.equal(row('shell', '~/.bash_history').command, 'chronicle extract shell --shell bash');
  assert.equal(row('shell', '~/.bash_history').status, 'empty');
  // Chrome's profiles by the names its menu shows; its Default needs no flag.
  const chrome = rows.filter(r => r.source === 'chrome');
  assert.deepEqual(chrome.map(r => r.label).sort(), ['Personal', 'Work']);
  assert.equal(row('chrome', 'Personal').command, 'chronicle extract chrome');
  assert.equal(row('chrome', 'Work').command, 'chronicle extract chrome --profile "Profile 1"');
  // Only the vault that's still there, its folder the input.
  const vaults = rows.filter(r => r.source === 'obsidian');
  assert.equal(vaults.length, 1);
  assert.deepEqual(vaults[0].config, { input: vault });
  // A credential says where it came from, never what it is.
  assert.equal(row('github', 'GH_TOKEN').evidence.credential, 'GH_TOKEN');
  assert.equal(row('github', 'GH_TOKEN').status, 'ready');
  assert.doesNotMatch(JSON.stringify(rows), /synthetic-token/);

  // The commands it prints run (Chrome's need a real History database).
  for (const command of [row('shell', '~/.zsh_history').command, vaults[0].command]) {
    const args = command.match(/"[^"]*"|\S+/g).map(word => word.replaceAll('"', ''));
    const extracted = scan(...args.slice(1).map(w => w.replace(/^~/, home)), '--limit', '1');
    assert.equal(extracted.status, 0, `${command}: ${extracted.stderr}`);
  }

  // The table, with the next step under it.
  const table = scan('sources', 'scan');
  assert.match(table.stdout, /^chrome +app-db +Work +ready$/m);
  assert.match(table.stderr, /Run `chronicle extract \S+/);

  // A profile its permissions close is there, but can't be read.
  const closed = ['.config/google-chrome', 'Library/Application Support/Google/Chrome'].map(
    userData => join(home, userData, 'Profile 1')
  );
  for (const folder of closed) chmodSync(folder, 0o000);
  try {
    const rows = JSON.parse(success(scan('sources', 'scan', 'chrome', '--format', 'json')));
    const work = rows.find(r => r.label === 'Work');
    assert.equal(work.status, 'unreadable');
    assert.equal(work.command, 'chronicle extract chrome --profile "Profile 1"');
  } finally {
    for (const folder of closed) chmodSync(folder, 0o755);
  }

  // One source with nothing there says where it looked, and isn't an error.
  const zotero = scan('sources', 'scan', 'zotero');
  assert.equal(zotero.status, 0, zotero.stderr);
  assert.match(zotero.stderr, /Nothing found for zotero/);
  assert.match(zotero.stderr, /Looked in ~\/Zotero\/zotero\.sqlite/);
  const unknown = scan('sources', 'scan', 'nope');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /chronicle sources --all/);
});

test('survey counts what each ready source holds, and says what it left out', t => {
  const { dir, run } = fixture(t);
  const { home } = scanHome(dir);
  const survey = run.with({ HOME: home, GH_TOKEN: 'synthetic-token' });
  const surveyed = JSON.parse(success(survey('survey', '--format', 'json')));
  const of = (source, label) => surveyed.find(r => r.source === source && r.label === label);
  assert.equal(of('shell', '~/.zsh_history').command, 'chronicle extract shell');
  assert.deepEqual(of('shell', '~/.zsh_history').survey, {
    commands: {
      count: 1,
      earliest: '2023-11-14T22:13:20.000Z',
      latest: '2023-11-14T22:13:20.000Z',
      measures: [{ key: 'distinctCommands', label: 'different', value: 1 }],
    },
  });
  assert.equal(surveyed.find(r => r.source === 'obsidian').survey.notes.count, 1);
  // A History that isn't a database fails its survey, and says why.
  assert.equal(of('chrome', 'Personal').survey, null);
  assert.ok(of('chrome', 'Personal').error);
  // A source online is listed but not counted; one that isn't ready isn't listed.
  assert.equal(of('github', 'GH_TOKEN').survey, null);
  assert.equal(of('github', 'GH_TOKEN').online, true);
  assert.equal(of('shell', '~/.bash_history'), undefined);

  const shown = survey('survey');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /^source +found +records +years +more$/m);
  assert.match(shown.stdout, /~\/\.zsh_history +1 command +2023 +1 different/);
  assert.match(shown.stderr, /Couldn't count 2 sources/);
  assert.match(shown.stdout, /^github +GH_TOKEN +online, not counted/m);
  assert.match(shown.stderr, /1 source found isn't ready/);
  // One source: what it is and where it was read from, then its records' count, first and last.
  const detail = success(survey('survey', 'shell'));
  assert.match(detail, /^shell {2}Shell history/m);
  assert.match(detail, /^`~\/\.zsh_history` {2}\d+ B · changed /m);
  assert.match(detail, /^1 command$/m);
  assert.match(detail, /^ {2}first +2023-11-1\d \d\d:\d\d$/m);
  assert.match(detail, /^ {2}different +1$/m);
  // A single year has no bars: its count says it all.
  assert.doesNotMatch(detail, /█/);
  const [zsh] = JSON.parse(success(survey('survey', 'shell', '--format', 'json')));
  assert.deepEqual(zsh.survey.commands.byMonth, { '2023-11': 1 });
  // Every source's survey leaves months out; a scan points to it.
  assert.match(survey('sources', 'scan').stderr, /chronicle survey/);
  assert.notEqual(survey('survey', 'no-such-source').status, 0);
});

test('survey takes the options extract does, and counts an export it is pointed at', t => {
  const { dir, run } = fixture(t);
  const { home } = scanHome(dir);
  const survey = run.with({ HOME: home });
  const storyline = join(dir, 'moves', 'json', 'daily', 'storyline');
  mkdirSync(storyline, { recursive: true });
  const place = { id: 1, name: 'Somewhere', type: 'user', location: { lat: 1, lon: 2 } };
  writeFileSync(
    join(storyline, 'storyline_20150101.json'),
    JSON.stringify([
      {
        date: '20150101',
        segments: [
          {
            type: 'place',
            startTime: '20150101T090000-0300',
            endTime: '20150101T100000-0300',
            place,
          },
        ],
      },
    ])
  );
  writeFileSync(
    join(storyline, 'storyline_20140509.json'),
    JSON.stringify([
      {
        date: '20140509',
        segments: [
          {
            type: 'place',
            startTime: '20140509T090000-0300',
            endTime: '20140509T100000-0300',
            place,
          },
        ],
      },
    ])
  );
  const input = join(dir, 'moves');
  const [counted] = JSON.parse(
    success(survey('survey', 'moves-app', '--input', input, '--format', 'json'))
  );
  assert.equal(counted.label, input);
  assert.match(counted.command, /^chronicle extract moves-app --input /);
  assert.deepEqual(counted.survey, {
    places: {
      count: 2,
      earliest: '2014-05-09T12:00:00.000Z',
      latest: '2015-01-01T12:00:00.000Z',
      byMonth: { '2014-05': 1, '2015-01': 1 },
    },
    moves: { count: 0, byMonth: {} },
  });
  // Years when there are several, each a bar against the busiest.
  const years = success(survey('survey', 'moves-app', '--input', input));
  assert.match(years, /^2 places$/m);
  assert.match(years, /^ {2}2014 {2}█{30} {2}1$/m);
  assert.match(years, /^ {2}2015 {2}█{30} {2}1$/m);
  // Without one: where to point it.
  const bare = survey('survey', 'moves-app');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /moves-app reads an export you point it at/);
  assert.match(bare.stderr, /chronicle survey moves-app --input <path>/);
  assert.match(survey('survey', 'moves-app', '--input', join(dir, 'gone')).stderr, /Nothing at/);
  // A source's own help lists its options beside survey's.
  const help = success(survey('survey', 'moves-app', '--help'));
  assert.match(help, /chronicle survey moves-app/);
  assert.match(help, /--input/);
  assert.match(help, /--format/);
  assert.doesNotMatch(help, /--loader|--output/);
  // Options alone are one run: since a date, and in the command that extracts it.
  const [since] = JSON.parse(
    success(survey('survey', 'shell', '--since', '2024-01-01', '--format', 'json'))
  );
  assert.equal(since.command, 'chronicle extract shell --since 2024-01-01');
  assert.equal(since.survey.commands.count, 0);
});

test(
  'sources scan finds a source whose plugin is not installed, from the catalog',
  { skip: process.env.CHRONICLE_TEST_BIN && 'every plugin is installed in the packed check' },
  t => {
    const { dir, run } = fixture(t);
    const { home } = scanHome(dir);
    const scan = run.with({ HOME: home, CHRONICLE_WORKSPACE_PLUGINS: '0' });
    const rows = JSON.parse(success(scan('sources', 'scan', '--format', 'json')));
    // Without its locator, each profile folder that matched is a row, by its path.
    const chrome = rows.filter(r => r.source === 'chrome');
    assert.ok(chrome.length >= 2);
    assert.ok(chrome.every(r => !r.installed && r.plugin === 'chrome'));
    assert.ok(rows.some(r => r.source === 'shell' && r.installed));
    assert.match(scan('sources', 'scan').stderr, /chronicle plugins install \S+/);
  }
);

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
    assert.match(
      success(run.with(env)('sources', 'info', 'google-reader')),
      /plugin +@chronicle\.app\/google-reader, not installed/
    );
    // The table says which sources aren't installed, and with none listed that
    // runs here, its hint names only a command that works.
    assert.match(success(run.with(env)('sources', '--all')), /^google-reader .*not installed/m);
    const alone = run.with(env)('sources', '--source', 'google-reader');
    assert.match(alone.stderr, /chronicle sources info google-reader/);
    assert.doesNotMatch(alone.stderr, /chronicle extract/);
    // With no providers to list, `auth login --list` says so, as `auth list` does.
    const providers = run.with(env)('auth', 'login', '--list');
    assert.equal(providers.status, 0, providers.stderr);
    assert.match(providers.stderr, /`chronicle plugins`/);
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
    assert.match(refused.stderr, /Can't read the shell history.*\n.*↳ .*permissions/);
  }
});

test('preset selection and explicit values override global config', t => {
  const { input, run } = fixture(t);
  success(run('config', 'set', 'limit', '1'));
  success(run('config', 'preset', 'create', 'all', '--limit', '0', '-d', 'Every record'));
  // `-d`, as help lists it, is the description.
  assert.equal(
    JSON.parse(success(run('config', 'preset', 'show', 'all', '--json'))).description,
    'Every record'
  );
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
    assert.match(result.stderr, /! fixture {2}synthetic warning/);
    // A plugin's console output becomes its diagnostics on stderr, never records on stdout.
    assert.match(result.stderr, /· fixture {2}synthetic console output/);
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
  assert.match(auth.stderr, /No typed credentials[\s\S]*chronicle auth login typed/);
  assert.equal(auth.stdout, '');
  const events = run
    .with({ FIXTURE_MODE: 'auth' })('extract', 'typed', '--raw', '--log-format', 'json')
    .stderr.split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line));
  const failure = events.find(event => event.kind === 'error');
  assert.deepEqual(failure.error, { code: 'auth-required', exitCode: 3 });
  assert.match(failure.hint.action, /chronicle auth login typed/);
  // A plugin's hint on a successful run prints under the summary.
  const hinted = run('extract', 'typed', '--raw');
  assert.equal(hinted.status, 0, hinted.stderr);
  assert.match(
    hinted.stderr,
    /✓ typed · rows.*\n.*1 row\n[\s\S]*attachments skipped[\s\S]*grant access/
  );
});
