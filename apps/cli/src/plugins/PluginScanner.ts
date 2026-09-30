import path from 'node:path';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Config } from '@oclif/core';
import { glob } from 'glob';
import { Delivery, Extractor } from '@chronicle.app/etl';
import { createLogger } from '@chronicle.app/logging';

const logger = createLogger({ scope: 'plugins' });

export interface ExtractorMetadata {
  source: string;
  /** How the source is read, in its own vocabulary — what `--strategy` selects. */
  strategy: string;
  /** Catalog classification of how this source reaches us — never user-typed. */
  delivery: Delivery;
  recordType: string[];
  description: string;
  extractor: typeof Extractor;
  packageName: string;
  default?: boolean;
  /** Set when a plugin added with `plugins add` takes over this source: where it is. */
  localOverride?: string;
}

/** One strategy for a source: its name, delivery, and the extractors on it. */
export interface StrategyInfo {
  name: string;
  delivery: Delivery;
  extractors: ExtractorMetadata[];
  recordTypes: string[];
}

/** Group a source's extractors by strategy, in declaration order. */
export function strategiesOf(extractors: ExtractorMetadata[]): StrategyInfo[] {
  const byName = new Map<string, StrategyInfo>();
  for (const e of extractors) {
    const info = byName.get(e.strategy) ?? {
      name: e.strategy,
      delivery: e.delivery,
      extractors: [],
      recordTypes: [],
    };
    info.extractors.push(e);
    for (const rt of e.recordType) {
      if (!info.recordTypes.includes(rt)) info.recordTypes.push(rt);
    }
    byName.set(e.strategy, info);
  }
  return [...byName.values()];
}

/**
 * Walk up from `startDir` until `isRoot` accepts a directory. Returns that
 * directory, or null once the filesystem root is passed without a match.
 */
export async function findWorkspaceRoot(
  startDir: string,
  isRoot: (dir: string) => boolean | Promise<boolean>
): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (;;) {
    if (await isRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The monorepo root: a package.json with a `workspaces` field beside a plugins/ directory. */
export async function isWorkspaceRoot(dir: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
    if (!packageJson.workspaces) return false;
    return (await fs.stat(path.join(dir, 'plugins'))).isDirectory();
  } catch {
    return false;
  }
}

/** Where a plugin was found, in discovery order. */
export type PluginOrigin = 'local' | 'workspace' | 'installed' | 'beside-cli' | 'bundled';

export interface FoundPlugin {
  name: string;
  /** The plugin's directory. */
  path: string;
  origin: PluginOrigin;
  /** A single-file plugin's file, imported in place of a package entry point. */
  file?: string;
}

/** The CLI package's own directory. */
export const cliRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A plugin at a path on disk: a single file, named after it, or a directory
 * with a package.json, named by it.
 */
export async function localPlugin(
  pluginPath: string
): Promise<{ name: string; path: string; file?: string }> {
  const absolute = path.resolve(pluginPath);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) {
    const name = path.basename(absolute).replace(/\.(?:[cm]?[jt]s)$/, '');
    return { name, path: path.dirname(absolute), file: absolute };
  }
  const pkg = await readPackage(absolute);
  if (!pkg) {
    throw new Error(`${absolute} has no package.json. Add the plugin's file instead.`);
  }
  return { name: pkg.name ?? path.basename(absolute), path: absolute };
}

/** The paths added with `chronicle plugins add`, from the Chronicle config. */
export async function localPluginPaths(): Promise<string[]> {
  const { ConfigManager } = await import('../config/ConfigManager.js');
  const config = await new ConfigManager((await Config.load(cliRoot)).configDir).loadConfig();
  return config.plugins ?? [];
}

/** Take paths off the local list, as `chronicle plugins remove` would. */
async function forgetLocalPlugins(paths: string[]): Promise<void> {
  const { ConfigManager } = await import('../config/ConfigManager.js');
  const configManager = new ConfigManager((await Config.load(cliRoot)).configDir);
  const config = await configManager.loadConfig();
  config.plugins = (config.plugins ?? []).filter(p => !paths.includes(p));
  await configManager.saveConfig(config);
}

/** The data directory `chronicle plugins install` installs into. */
export async function pluginDataDir(): Promise<string> {
  return (await Config.load(cliRoot)).dataDir;
}

/**
 * The node_modules the CLI is installed in, where `npm install -g` or a
 * project's own install puts plugins beside it. Null when the CLI isn't in a
 * node_modules, as when it runs from a checkout.
 */
function besideCli(): string | null {
  let dir = path.dirname(path.resolve(cliRoot));
  if (path.basename(dir).startsWith('@')) dir = path.dirname(dir);
  return path.basename(dir) === 'node_modules' ? dir : null;
}

async function readPackage(dir: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The Chronicle plugins among the packages directly inside a node_modules. */
async function pluginsIn(nodeModules: string): Promise<Array<{ name: string; path: string }>> {
  const plugins: Array<{ name: string; path: string }> = [];
  for (const packageFile of await glob(['*/package.json', '@*/*/package.json'], {
    cwd: nodeModules,
  })) {
    const dir = path.join(nodeModules, path.dirname(packageFile));
    const pkg = await readPackage(dir);
    if (pkg?.chronicle?.plugin === true) plugins.push({ name: pkg.name, path: dir });
  }
  return plugins;
}

/**
 * The plugins bundled with the CLI: its own dependencies that declare
 * `chronicle.plugin`. Resolved from the CLI's position, so they are found
 * from any cwd.
 */
async function bundledPlugins(): Promise<Array<{ name: string; path: string }>> {
  const cliPackage = await readPackage(cliRoot);
  const plugins: Array<{ name: string; path: string }> = [];
  for (const name of Object.keys(cliPackage.dependencies ?? {})) {
    let dir: string;
    try {
      dir = path.dirname(fileURLToPath(import.meta.resolve(name)));
    } catch {
      continue;
    }
    // Walk up from the entry point to the package's own package.json.
    for (;;) {
      const pkg = await readPackage(dir);
      if (pkg?.name === name) {
        if (pkg.chronicle?.plugin === true) plugins.push({ name, path: dir });
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return plugins;
}

/**
 * Packages the CLI shares with every plugin it loads. `@chronicle.app/auth`
 * keeps the OAuth provider registry, so a plugin with its own copy would
 * register providers the CLI never sees; `etl`, `etl-sqlite`, and `schema`
 * keep extraction and validation on the CLI's version, and let a plugin run
 * without installing them.
 */
let sharingModules = false;
function shareModulesWithPlugins(): void {
  if (sharingModules) return;
  sharingModules = true;
  register(new URL('sharedModules.js', import.meta.url), {
    data: { parentURL: import.meta.url },
  });
}

export class PluginScanner {
  /**
   * Find every Chronicle plugin. In order, the first package of each name wins:
   *
   * 0. plugins added with `chronicle plugins add`
   * 1. the workspace `plugins/` directory, when running from a checkout
   *    (skipped when CHRONICLE_WORKSPACE_PLUGINS=0)
   * 2. the data directory, where `chronicle plugins install` puts them
   * 3. the node_modules the CLI is installed in, for `npm install -g`
   * 4. the plugins bundled with the CLI
   */
  static async findChroniclePlugins(): Promise<FoundPlugin[]> {
    try {
      const found = new Map<string, FoundPlugin>();
      const add = (
        plugins: Array<{ name: string; path: string; file?: string }>,
        origin: PluginOrigin
      ) => {
        for (const plugin of plugins) {
          if (!found.has(plugin.name)) found.set(plugin.name, { ...plugin, origin });
        }
      };

      const local = [];
      const gone: string[] = [];
      for (const pluginPath of await localPluginPaths()) {
        // A deleted plugin comes off the list; anything else wrong stays, with a warning.
        if (!existsSync(pluginPath)) {
          gone.push(pluginPath);
          continue;
        }
        try {
          local.push(await localPlugin(pluginPath));
        } catch (error) {
          logger.warn('Skipping a local plugin', {
            path: pluginPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (gone.length > 0) {
        await forgetLocalPlugins(gone);
        for (const pluginPath of gone) {
          logger.warn('Removed a local plugin that no longer exists', { path: pluginPath });
        }
      }
      add(local, 'local');

      // Located from this module's own position in the checkout
      // (apps/cli/dist/plugins/), so the scan works from any cwd.
      const workspaceRoot =
        process.env.CHRONICLE_WORKSPACE_PLUGINS === '0'
          ? null
          : await findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)), isWorkspaceRoot);
      if (workspaceRoot) {
        const pluginsDir = path.join(workspaceRoot, 'plugins');
        const workspace: Array<{ name: string; path: string }> = [];
        for (const dir of await glob('*/', { cwd: pluginsDir })) {
          const pkg = await readPackage(path.join(pluginsDir, dir));
          if (pkg?.chronicle?.plugin === true) {
            workspace.push({ name: pkg.name, path: path.join(pluginsDir, dir) });
          }
        }
        add(workspace, 'workspace');
      }

      add(await pluginsIn(path.join(await pluginDataDir(), 'node_modules')), 'installed');
      // Under npx or a flat install, the CLI's own dependencies sit beside it:
      // those copies are bundled, while a separately installed copy stays beside-cli.
      const bundled = await bundledPlugins();
      const bundledPaths = new Set(bundled.map(p => realpathSync(p.path)));
      const beside = besideCli();
      if (beside) {
        const plugins = await pluginsIn(beside);
        add(
          plugins.filter(p => !bundledPaths.has(realpathSync(p.path))),
          'beside-cli'
        );
      }
      add(bundled, 'bundled');

      return [...found.values()];
    } catch (error) {
      logger.warn('Failed to scan for Chronicle plugins', { error: String(error) });
      return [];
    }
  }

  static async importPlugin(plugin: { name: string; path: string; file?: string }): Promise<any> {
    shareModulesWithPlugins();
    if (plugin.file) return import(pathToFileURL(plugin.file).href);
    const pkg = JSON.parse(await fs.readFile(path.join(plugin.path, 'package.json'), 'utf8'));
    const exported = pkg.exports?.['.'] ?? pkg.exports;
    const entry =
      typeof exported === 'string'
        ? exported
        : (exported?.import ?? exported?.default ?? pkg.main ?? './dist/index.js');
    return import(pathToFileURL(path.resolve(plugin.path, entry)).href);
  }

  /**
   * Scan a plugin package for extractor classes
   */
  static async scanPluginExtractors(plugin: {
    name: string;
    path: string;
    file?: string;
  }): Promise<ExtractorMetadata[]> {
    try {
      return this.extractorsOf(plugin, await this.importPlugin(plugin));
    } catch (error) {
      logger.warn(`Failed to scan plugin ${plugin.name}`, { error: String(error) });
      return [];
    }
  }

  /** The extractor classes a plugin module exports. */
  static extractorsOf(plugin: { name: string }, pluginModule: any): ExtractorMetadata[] {
    // Find all exported classes that extend Extractor
    const extractors: ExtractorMetadata[] = [];

    for (const [exportName, exportValue] of Object.entries(pluginModule)) {
      if (this.isExtractorClass(exportValue)) {
        const ExtractorClass = exportValue as typeof Extractor;

        // Validate required metadata
        if (!ExtractorClass.source || !ExtractorClass.strategy) {
          logger.debug(
            `Skipping extractor ${exportName} from ${plugin.name}: missing source or strategy`
          );
          continue;
        }

        extractors.push({
          source: ExtractorClass.source,
          strategy: ExtractorClass.strategy,
          delivery: ExtractorClass.delivery,
          recordType: ExtractorClass.recordTypes || [],
          description:
            ExtractorClass.description ||
            `${ExtractorClass.recordTypes?.join(', ')} from ${ExtractorClass.source}`,
          extractor: ExtractorClass,
          packageName: plugin.name,
          default: ExtractorClass.default || false,
        });
      }
    }

    return extractors;
  }

  /**
   * Scan all Chronicle plugins and return grouped extractors
   */
  static async scanAllPlugins(): Promise<Map<string, ExtractorMetadata[]>> {
    const plugins = await this.findChroniclePlugins();
    const extractorsBySource = new Map<string, ExtractorMetadata[]>();

    const localSources = new Map<string, FoundPlugin[]>();
    for (const plugin of plugins) {
      const extractors = await this.scanPluginExtractors(plugin);

      for (const extractor of extractors) {
        if (plugin.origin === 'local') {
          const providers = localSources.get(extractor.source) ?? [];
          if (!providers.includes(plugin)) providers.push(plugin);
          localSources.set(extractor.source, providers);
        }
        const existing = extractorsBySource.get(extractor.source) || [];
        existing.push(extractor);
        extractorsBySource.set(extractor.source, existing);
      }
    }

    // Local plugins take over each source they provide, so one can stand in
    // for an official plugin while you work on it. Several local plugins for
    // one source all stay; a shared strategy between them fails below.
    if (localSources.size > 0) {
      const { loadCatalog } = await import('./catalog.js');
      const catalogSources = new Set(
        (await loadCatalog()).flatMap(entry => Object.keys(entry.sources ?? {}))
      );
      for (const [source, providers] of localSources) {
        const extractors = extractorsBySource.get(source)!;
        const where = new Map(providers.map(p => [p.name, p.file ?? p.path]));
        const own = extractors.filter(e => where.has(e.packageName));
        if (own.length < extractors.length || catalogSources.has(source)) {
          for (const e of own) e.localOverride = where.get(e.packageName);
        }
        extractorsBySource.set(source, own);
      }
    }

    for (const [source, extractors] of extractorsBySource) {
      this.assertStrategiesAreCoherent(source, extractors);
    }

    return extractorsBySource;
  }

  /**
   * A strategy name is the source's public handle for one way of reading it, so within a
   * source it must mean exactly one thing. Several extractor classes sharing it
   * is the norm (YouTube's four API extractors); two *packages* claiming it, or
   * one name arriving with two deliveries, is a collision a person could not
   * resolve with `--strategy`. Local plugins already win over node_modules copies by
   * package name, so anything left here is a genuine conflict.
   */
  private static assertStrategiesAreCoherent(source: string, extractors: ExtractorMetadata[]) {
    const seen = new Map<string, { packages: Set<string>; deliveries: Set<string> }>();
    for (const e of extractors) {
      const entry = seen.get(e.strategy) ?? { packages: new Set(), deliveries: new Set() };
      entry.packages.add(e.packageName);
      entry.deliveries.add(e.delivery);
      seen.set(e.strategy, entry);
    }
    for (const [strategy, { packages, deliveries }] of seen) {
      if (packages.size > 1) {
        throw new Error(
          `Two plugins claim the "${strategy}" strategy for ${source}: ${[...packages].join(', ')}. ` +
            'A strategy name must be unique within a source — rename one of them.'
        );
      }
      if (deliveries.size > 1) {
        throw new Error(
          `The "${strategy}" strategy for ${source} declares more than one delivery ` +
            `(${[...deliveries].join(', ')}). A strategy has one delivery.`
        );
      }
    }
  }

  /**
   * Check if an export is an Extractor class
   */
  private static isExtractorClass(value: any): boolean {
    if (typeof value !== 'function') return false;

    // Check if it extends Extractor by looking for required static properties
    return (
      typeof value.source === 'string' &&
      typeof value.strategy === 'string' &&
      typeof value.delivery === 'string' &&
      Array.isArray(value.recordTypes) &&
      typeof value.schema === 'object'
    );
  }

  /**
   * Validate extractor metadata
   */
  static validateExtractor(extractor: ExtractorMetadata): string[] {
    const errors: string[] = [];

    if (!extractor.source) {
      errors.push('Missing required property: source');
    }

    if (!extractor.strategy) {
      errors.push('Missing required property: strategy');
    }

    if (!extractor.delivery) {
      errors.push('Missing required property: delivery');
    }

    if (!Array.isArray(extractor.recordType)) {
      errors.push('recordType must be an array');
    }

    return errors;
  }
}
