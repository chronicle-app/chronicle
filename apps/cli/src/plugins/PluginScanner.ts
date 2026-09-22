import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Config } from '@oclif/core';
import { glob } from 'glob';
import { Delivery, Extractor } from '@chronicle.app/etl';

export interface ExtractorMetadata {
  source: string;
  /** The named way in, in the source's own vocabulary — what `--via` selects. */
  strategy: string;
  /** Catalog classification of how this source reaches us — never user-typed. */
  delivery: Delivery;
  recordType: string[];
  description: string;
  extractor: typeof Extractor;
  packageName: string;
  default?: boolean;
}

/** One way into a source: its strategy name, delivery, and the extractors on it. */
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

export class PluginScanner {
  /**
   * Find all Chronicle plugins in local plugins directory and node_modules
   */
  static async findChroniclePlugins(): Promise<Array<{ name: string; path: string }>> {
    try {
      const plugins: Array<{ name: string; path: string }> = [];
      const foundPluginNames = new Set<string>();

      // First, look in the local plugins directory (preferred over node_modules).
      // Locate it from this module's own position in the checkout
      // (apps/cli/dist/plugins/) so the scan works from any cwd; only if the
      // walk finds no workspace root fall back to probing the cwd.
      const cwd = process.cwd();
      const workspaceRoot = await findWorkspaceRoot(
        path.dirname(fileURLToPath(import.meta.url)),
        isWorkspaceRoot
      );
      const localPluginsPath = workspaceRoot
        ? path.join(workspaceRoot, 'plugins')
        : cwd.endsWith('/apps/cli')
          ? path.join(cwd, '../../plugins')
          : path.join(cwd, 'plugins');
      try {
        const localPlugins = await glob('*/', { cwd: localPluginsPath });

        for (const pluginDir of localPlugins) {
          const pluginPath = path.join(localPluginsPath, pluginDir);
          const packageJsonPath = path.join(pluginPath, 'package.json');

          try {
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

            // Check if this package declares itself as a Chronicle plugin
            if (packageJson.chronicle?.plugin === true) {
              plugins.push({
                name: packageJson.name,
                path: pluginPath,
              });
              foundPluginNames.add(packageJson.name);
            }
          } catch {
            // Skip directories that don't have readable package.json
            continue;
          }
        }
      } catch {
        // Local plugins directory might not exist, continue with node_modules
      }

      const config = await Config.load(fileURLToPath(new URL('../../', import.meta.url)));
      const roots = [
        path.join(fileURLToPath(new URL('../../', import.meta.url)), 'node_modules'),
        path.join(config.dataDir, 'node_modules'),
        path.join(cwd, 'node_modules'),
      ];
      for (const name of ['shell', 'things-todo', 'imessage', 'claude-code']) {
        const packageName = `@chronicle.app/${name}`;
        if (!foundPluginNames.has(packageName)) {
          const entry = fileURLToPath(import.meta.resolve(packageName));
          plugins.push({ name: packageName, path: path.dirname(path.dirname(entry)) });
          foundPluginNames.add(packageName);
        }
      }
      for (const plugin of config.plugins.values()) {
        if (
          (plugin.pjson as any).chronicle?.plugin === true &&
          !foundPluginNames.has(plugin.name)
        ) {
          plugins.push({ name: plugin.name, path: plugin.root });
          foundPluginNames.add(plugin.name);
        }
      }
      for (const nodeModulesPath of roots) {
        for (const packageFile of await glob(['*/package.json', '@*/*/package.json'], {
          cwd: nodeModulesPath,
        })) {
          const packagePath = path.join(nodeModulesPath, packageFile);
          const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
          if (pkg.chronicle?.plugin === true && !foundPluginNames.has(pkg.name)) {
            plugins.push({ name: pkg.name, path: path.dirname(packagePath) });
            foundPluginNames.add(pkg.name);
          }
        }
      }

      if (plugins.length === 0) {
        console.warn(
          `No Chronicle plugins found (looked in ${localPluginsPath} and ${roots.join(', ')})`
        );
      }

      return plugins;
    } catch (error) {
      console.warn('Failed to scan for Chronicle plugins:', error);
      return [];
    }
  }

  static async importPlugin(plugin: { name: string; path: string }): Promise<any> {
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
  }): Promise<ExtractorMetadata[]> {
    try {
      const pluginModule = await this.importPlugin(plugin);

      // Find all exported classes that extend Extractor
      const extractors: ExtractorMetadata[] = [];

      for (const [exportName, exportValue] of Object.entries(pluginModule)) {
        if (this.isExtractorClass(exportValue)) {
          const ExtractorClass = exportValue as typeof Extractor;

          // Validate required metadata
          if (!ExtractorClass.source || !ExtractorClass.strategy) {
            // Only log in verbose mode to reduce noise
            if (process.argv.includes('--verbose')) {
              console.warn(
                `Skipping extractor ${exportName} from ${plugin.name}: missing source or strategy`
              );
            }
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
    } catch (error) {
      console.warn(`Failed to scan plugin ${plugin.name}:`, error);
      return [];
    }
  }

  /**
   * Scan all Chronicle plugins and return grouped extractors
   */
  static async scanAllPlugins(): Promise<Map<string, ExtractorMetadata[]>> {
    const plugins = await this.findChroniclePlugins();
    const extractorsBySource = new Map<string, ExtractorMetadata[]>();

    for (const plugin of plugins) {
      const extractors = await this.scanPluginExtractors(plugin);

      for (const extractor of extractors) {
        const existing = extractorsBySource.get(extractor.source) || [];
        existing.push(extractor);
        extractorsBySource.set(extractor.source, existing);
      }
    }

    for (const [source, extractors] of extractorsBySource) {
      this.assertStrategiesAreCoherent(source, extractors);
    }

    return extractorsBySource;
  }

  /**
   * A strategy name is the source's public handle for one way in, so within a
   * source it must mean exactly one thing. Several extractor classes sharing it
   * is the norm (YouTube's four API extractors); two *packages* claiming it, or
   * one name arriving with two deliveries, is a collision a person could not
   * resolve with `--via`. Local plugins already win over node_modules copies by
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
            'A strategy names one way in — rename one of them.'
        );
      }
      if (deliveries.size > 1) {
        throw new Error(
          `The "${strategy}" strategy for ${source} declares more than one delivery ` +
            `(${[...deliveries].join(', ')}). One way in reaches us one way.`
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
