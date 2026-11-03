import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { findEntry, loadCatalog, type CatalogEntry } from './catalog.js';
import { legacyPluginDataDir, pluginDataDir } from './PluginScanner.js';

export interface InstallTarget {
  /** What npm installs: a pinned package, a package spec, or an absolute path. */
  spec: string;
  /** The catalog entry, when the name resolved through it. */
  entry?: CatalogEntry;
}

/**
 * What `chronicle plugins install <name>` hands npm. A catalog plugin from
 * this repo is pinned to the CLI's version, since they release together; a
 * path is made absolute; anything else is passed through as a package spec.
 */
export async function resolveInstallTarget(
  name: string,
  cliVersion: string
): Promise<InstallTarget> {
  const entry = findEntry(await loadCatalog(), name);
  if (entry) {
    const spec = entry.tier === 'listed' ? entry.package : `${entry.package}@${cliVersion}`;
    return { spec, entry };
  }
  if (/^[./~]/.test(name) || existsSync(name)) {
    return { spec: path.resolve(name.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')) };
  }
  return { spec: name };
}

/** The data directory's package.json dependencies: what's installed there. */
async function installedIn(dataDir: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dataDir, 'package.json'), 'utf8'));
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

function realpathOrSelf(file: string): string {
  return existsSync(file) ? realpathSync(file) : file;
}

/**
 * Run the user's npm against the data directory. Its output goes to stderr,
 * so `extract` can install and still keep stdout for records, and through
 * stderr's own write, so lines drawn in place there stay clear of it. It
 * runs alongside, so a spinner keeps turning and Ctrl-C is heard.
 */
async function npm(dataDir: string, args: string[]): Promise<void> {
  const child = spawn(
    'npm',
    [
      ...args,
      '--prefix',
      dataDir,
      // The CLI provides etl, schema, and auth to every plugin it loads.
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }
  );
  child.stdout!.on('data', chunk => process.stderr.write(chunk));
  child.stderr!.on('data', chunk => process.stderr.write(chunk));
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once('error', error => reject(new Error(`Couldn't run npm: ${error.message}`)));
    child.once('close', resolve);
  });
  if (status !== 0) throw new Error(`npm ${args[0]} failed (exit ${status}).`);
}

/**
 * Install a plugin into the data directory and return its package name. A
 * package that turns out not to be a Chronicle plugin is removed again.
 */
export async function installPlugin(target: InstallTarget): Promise<string> {
  const dataDir = await pluginDataDir();
  await fs.mkdir(dataDir, { recursive: true });
  if (!existsSync(path.join(dataDir, 'package.json'))) {
    await fs.writeFile(path.join(dataDir, 'package.json'), '{ "private": true }\n');
  }

  const before = await installedIn(dataDir);
  await npm(dataDir, ['install', target.spec]);
  const after = await installedIn(dataDir);
  const realSpec = existsSync(target.spec) ? realpathSync(target.spec) : undefined;
  const name =
    target.entry?.package ??
    Object.keys(after).find(dep => before[dep] !== after[dep]) ??
    // A reinstall leaves the dependency unchanged: match it by spec instead.
    Object.keys(after).find(
      dep =>
        target.spec === dep ||
        target.spec.startsWith(`${dep}@`) ||
        (realSpec !== undefined &&
          after[dep].startsWith('file:') &&
          realpathOrSelf(path.resolve(dataDir, after[dep].slice('file:'.length))) === realSpec)
    );
  if (!name) throw new Error(`npm installed ${target.spec}, but its package name is unclear.`);

  const pkg = JSON.parse(
    await fs.readFile(path.join(dataDir, 'node_modules', name, 'package.json'), 'utf8')
  );
  if (pkg.chronicle?.plugin !== true) {
    await npm(dataDir, ['uninstall', name]);
    throw new Error(`${name} isn't a Chronicle plugin (no "chronicle": { "plugin": true }).`);
  }
  return name;
}

/**
 * Remove a plugin from the data directory, or from where installs went before
 * they moved there. Returns false if it wasn't installed in either.
 */
export async function uninstallPlugin(name: string): Promise<boolean> {
  const packageName = findEntry(await loadCatalog(), name)?.package ?? name;
  for (const dataDir of [await pluginDataDir(), await legacyPluginDataDir()]) {
    if (!(packageName in (await installedIn(dataDir)))) continue;
    await npm(dataDir, ['uninstall', packageName]);
    return true;
  }
  return false;
}
