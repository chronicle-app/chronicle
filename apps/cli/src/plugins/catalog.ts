import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Delivery } from '@chronicle.app/etl';
import {
  PluginScanner,
  cliRoot,
  findWorkspaceRoot,
  isWorkspaceRoot,
  type FoundPlugin,
  type PluginOrigin,
} from './PluginScanner.js';

export type Tier = 'core' | 'official' | 'legacy' | 'listed';

/** One plugin in the maintainer's catalog. */
export interface CatalogEntry {
  name: string;
  package: string;
  tier: Tier;
  summary: string;
  /** The plugin's manifest, embedded when the CLI is packed; read from `plugins/` in a checkout. */
  sources?: Manifest;
}

/** One strategy for a source, as a plugin's `chronicle` manifest declares it. */
export interface ManifestStrategy {
  delivery: Delivery;
  recordTypes: string[];
  default?: boolean;
}

export interface ManifestSource {
  strategies: Record<string, ManifestStrategy>;
  platforms?: NodeJS.Platform[];
  requires?: string[];
}

/** The `chronicle.sources` field of a plugin's package.json. */
export type Manifest = Record<string, ManifestSource>;

/** A source as `chronicle sources` lists it: the manifest joined with the catalog. */
export interface SourceListing {
  source: string;
  /** The catalog's short name; for a plugin outside the catalog, its package name. */
  plugin: string;
  package: string;
  /** Null when the plugin is installed but not in the catalog. */
  tier: Tier | null;
  summary: string;
  installed: boolean;
  /** Where the plugin was found; null when it isn't installed. */
  origin: PluginOrigin | null;
  strategies: Array<ManifestStrategy & { name: string }>;
  platforms: NodeJS.Platform[];
  requires: string[];
  /** False when the source can't run on this platform. */
  supported: boolean;
}

/** The catalog entry for a short name or package name. */
export function findEntry(catalog: CatalogEntry[], name: string): CatalogEntry | undefined {
  return catalog.find(entry => entry.name === name || entry.package === name);
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The catalog ships beside the CLI's package.json with each plugin's manifest
 * embedded. In a checkout it lives at the workspace root, and the manifests
 * are read from `plugins/`.
 */
export async function loadCatalog(): Promise<CatalogEntry[]> {
  const packaged = await readJson(path.join(cliRoot, 'catalog.json'));
  if (packaged) return packaged.plugins;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = await findWorkspaceRoot(here, isWorkspaceRoot);
  if (!workspaceRoot) return [];
  const catalog = await readJson(path.join(workspaceRoot, 'catalog.json'));
  const entries: CatalogEntry[] = catalog?.plugins ?? [];
  for (const entry of entries) {
    const pkg = await readJson(path.join(workspaceRoot, 'plugins', entry.name, 'package.json'));
    if (pkg?.chronicle?.sources) entry.sources = pkg.chronicle.sources;
  }
  return entries;
}

/**
 * A plugin's manifest from its package.json. A plugin without one is imported
 * and its manifest derived from its extractor classes.
 */
async function manifestOf(plugin: FoundPlugin): Promise<Manifest> {
  const pkg = plugin.file ? null : await readJson(path.join(plugin.path, 'package.json'));
  if (pkg?.chronicle?.sources) return pkg.chronicle.sources;
  const manifest: Manifest = {};
  for (const e of await PluginScanner.scanPluginExtractors(plugin)) {
    manifest[e.source] ??= { strategies: {} };
    const { strategies } = manifest[e.source];
    strategies[e.strategy] ??= { delivery: e.delivery, recordTypes: [] };
    const strategy = strategies[e.strategy];
    for (const type of e.recordType) {
      if (!strategy.recordTypes.includes(type)) strategy.recordTypes.push(type);
    }
    if (e.default) strategy.default = true;
  }
  return manifest;
}

/**
 * Every catalog source and every installed plugin's sources, from manifests.
 * Plugin code is only imported for an installed plugin without a manifest.
 */
export async function listSources(): Promise<SourceListing[]> {
  const catalog = await loadCatalog();
  const byPackage = new Map(catalog.map(entry => [entry.package, entry]));
  const listings: SourceListing[] = [];
  const installed = new Set<string>();

  for (const plugin of await PluginScanner.findChroniclePlugins()) {
    installed.add(plugin.name);
    const entry = byPackage.get(plugin.name);
    for (const [source, manifest] of Object.entries(await manifestOf(plugin))) {
      const platforms = manifest.platforms ?? [];
      listings.push({
        source,
        plugin: entry?.name ?? plugin.name,
        package: plugin.name,
        tier: entry?.tier ?? null,
        summary: plugin.origin === 'local' ? (plugin.file ?? plugin.path) : (entry?.summary ?? ''),
        installed: true,
        origin: plugin.origin,
        strategies: Object.entries(manifest.strategies).map(([name, strategy]) => ({
          name,
          ...strategy,
        })),
        platforms,
        requires: manifest.requires ?? [],
        supported: platforms.length === 0 || platforms.includes(process.platform),
      });
    }
  }

  // A catalog plugin that isn't installed is listed from its embedded
  // manifest, or by its short name without one.
  for (const entry of catalog) {
    if (installed.has(entry.package)) continue;
    const manifest = entry.sources ?? { [entry.name]: { strategies: {} } };
    for (const [source, { strategies, platforms = [], requires = [] }] of Object.entries(
      manifest
    )) {
      listings.push({
        source,
        plugin: entry.name,
        package: entry.package,
        tier: entry.tier,
        summary: entry.summary,
        installed: false,
        origin: null,
        strategies: Object.entries(strategies).map(([name, strategy]) => ({ name, ...strategy })),
        platforms,
        requires,
        supported: platforms.length === 0 || platforms.includes(process.platform),
      });
    }
  }

  // A local plugin takes over each source it provides.
  const local = new Set(listings.filter(l => l.origin === 'local').map(l => l.source));
  return listings
    .filter(l => l.origin === 'local' || !local.has(l.source))
    .sort((a, b) => a.source.localeCompare(b.source));
}
