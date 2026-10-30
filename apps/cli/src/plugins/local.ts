import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Transformer } from '@chronicle.app/etl';
import { ConfigManager } from '../config/ConfigManager.js';
import { PluginScanner, localPlugin, type ExtractorMetadata } from './PluginScanner.js';

/**
 * Load a plugin from a file or directory once, and save its absolute path to
 * the local list. Throws with what to change if it won't load or exports
 * neither an extractor nor a transformer for `--transformer`.
 */
export async function addLocalPlugin(
  configDir: string,
  pluginPath: string
): Promise<{
  name: string;
  path: string;
  extractors: ExtractorMetadata[];
  transformers: Array<typeof Transformer>;
}> {
  const absolute = path.resolve(pluginPath);
  if (!existsSync(absolute)) throw new Error(`Nothing at ${absolute}.`);

  let plugin;
  let extractors;
  let transformers;
  try {
    plugin = await localPlugin(absolute);
    const pluginModule = await PluginScanner.importPlugin(plugin);
    extractors = PluginScanner.extractorsOf(plugin, pluginModule);
    transformers = PluginScanner.transformersOf(pluginModule);
  } catch (error) {
    throw new Error(`Couldn't load ${absolute}: ${error instanceof Error ? error.message : error}`);
  }
  if (extractors.length === 0 && transformers.length === 0) {
    throw new Error(
      `No extractor or transformer found in ${absolute}. A plugin exports a class that ` +
        'extends Extractor and sets static source, strategy, delivery, and recordTypes, or ' +
        "one that extends Transformer and sets static source and inputSchema = 'chronicle'."
    );
  }

  const configManager = new ConfigManager(configDir);
  const config = await configManager.loadConfig();
  // Plugins are keyed by name, so a second one of the same name would never load.
  for (const other of config.plugins ?? []) {
    if (other === absolute) continue;
    let otherName;
    try {
      otherName = (await localPlugin(other)).name;
    } catch {
      continue;
    }
    if (otherName === plugin.name) {
      throw new Error(
        `Another local plugin is already named ${plugin.name}: ${other}. Rename one, or ` +
          `remove that one with "chronicle plugins remove ${other}".`
      );
    }
  }
  config.plugins = [...new Set([...(config.plugins ?? []), absolute])];
  await configManager.saveConfig(config);
  return { name: plugin.name, path: absolute, extractors, transformers };
}
