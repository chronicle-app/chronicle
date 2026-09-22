import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run after quality checks. Installs tarballs outside the monorepo to catch
// missing files and dependencies that workspace hoisting would otherwise hide.
const root = process.cwd();
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run packages:check.');
const destination = resolve('artifacts/npm');
mkdirSync(destination, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), 'chronicle-packages-'));

function run(args, cwd, capture = false) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${args.join(' ')}\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

try {
  const dependencies = {};
  for (const directory of readdirSync('core', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()) {
    const cwd = resolve('core', directory);
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const [packed] = JSON.parse(
      run([npm, 'pack', '--json', '--pack-destination', destination], cwd, true)
    );
    assert.ok(
      packed.files.some(file => file.path === 'LICENSE'),
      `${pkg.name}: missing license`
    );
    assert.ok(
      packed.files.some(file => file.path === 'README.md'),
      `${pkg.name}: missing README`
    );
    for (const { path } of packed.files) {
      assert.ok(
        !/node_modules|\.test\.|tsbuildinfo|\.map$|^\.env/.test(path),
        `${pkg.name}: unexpected ${path}`
      );
    }
    dependencies[pkg.name] = `file:${join(destination, packed.filename)}`;
  }
  const { devDependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['eslint', 'prettier', 'typescript', '@types/node']) {
    dependencies[name] = devDependencies[name];
  }
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies })
  );
  run(
    [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    consumer
  );
  // Audit the installed graph, including transitive runtime dependencies.
  // A copied package must not quietly pull a private package or old SQLite driver.
  const installed = JSON.parse(run([npm, 'ls', '--all', '--omit=dev', '--json'], consumer, true));
  const auditDependencies = node => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      assert.ok(
        !['knex', 'better-sqlite3'].includes(name),
        `Forbidden extraction dependency: ${name}`
      );
      if (name.startsWith('@chronicle.app/')) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected Chronicle dependency: ${name}`);
      }
      auditDependencies(child);
    }
  };
  auditDependencies(installed);
  writeFileSync(
    join(consumer, '.eslintrc.cjs'),
    "module.exports = { extends: ['@chronicle.app/eslint-config'] };\n"
  );
  writeFileSync(
    join(consumer, 'prettier.config.cjs'),
    "module.exports = require('@chronicle.app/prettier-config');\n"
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      extends: '@chronicle.app/tsconfig/lib.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src/**/*.ts'],
    })
  );
  mkdirSync(join(consumer, 'src'));
  let source =
    "import { createLogger } from '@chronicle.app/logging';\nexport const logger = createLogger({ quiet: true });\n";
  if (dependencies['@chronicle.app/schema']) {
    source +=
      "import { EntityAndChildrenSchema } from '@chronicle.app/schema';\nexport const entity = EntityAndChildrenSchema.parse({ '@type': 'Entity', '@key': ['sourceId'], sourceId: 'fixture-1', name: 'Example' });\n";
  }
  if (dependencies['@chronicle.app/etl']) {
    source += `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Action } from '@chronicle.app/schema';
import { ChronicleTransformer, Extractor, JsonLoader, Runner, type Record as EtlRecord } from '@chronicle.app/etl';

class PackedExtractor extends Extractor {
  static override source = 'fixture';
  static override strategy = 'memory';
  static override delivery = 'export' as const;
  static override recordTypes = ['items'];
  async *extract() {
    yield this.createRecord({ id: 'fixture-1', url: 'https://example.com/1' });
  }
}
class PackedTransformer extends ChronicleTransformer {
  protected override async transform(record: EtlRecord): Promise<Action[]> {
    return [{ '@type': 'Action', '@key': ['sourceId'], sourceId: record.data.id,
      object: { '@type': 'Entity', '@key': ['url'], url: record.data.url } }];
  }
}
const runner = new Runner({ streamExtraction: true, quiet: true })
  .addExtractor(new PackedExtractor({}))
  .addTransformer(new PackedTransformer())
  .addLoader(new JsonLoader({ output: 'etl.json' }));
let loaded = 0;
try {
  await runner.setup();
  for await (const log of runner.run()) {
    assert.equal(log.error, undefined);
    assert.equal(log.validationErrors, undefined);
    loaded += log.results.filter(result => result.success).length;
  }
} finally { await runner.teardown(); }
assert.equal(loaded, 1);
assert.equal(JSON.parse(readFileSync('etl.json', 'utf8')).object.url, 'https://example.com/1');
`;
  }
  writeFileSync(join(consumer, 'src/index.ts'), source);
  run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
  run(['node_modules/eslint/bin/eslint.js', 'src', '--ext', '.ts'], consumer);
  run(['node_modules/prettier/bin/prettier.cjs', '--check', 'prettier.config.cjs'], consumer);
  run(['dist/index.js'], consumer);
  // App/test presets must also resolve correctly from installed tarballs.
  for (const preset of ['app', 'test']) {
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        extends: `@chronicle.app/tsconfig/${preset}.json`,
        include: ['src/**/*.ts'],
      })
    );
    run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumer);
  }
  console.log(
    `Validated ${Object.keys(dependencies).filter(name => name.startsWith('@chronicle.app/')).length} package tarballs. Artifacts: ${destination}`
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
  process.chdir(root);
}
