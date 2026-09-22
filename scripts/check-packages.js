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
