import path from 'node:path';
import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { localPlugin } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';

export default class PluginsRemove extends BaseCommand<typeof PluginsRemove> {
  static override description = 'Stop running a plugin added with `chronicle plugins add`';

  static override examples = [
    'chronicle plugins remove my-source',
    'chronicle plugins remove ./my-source',
  ];

  static override args = {
    plugin: Args.string({ description: 'The plugin name or path', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsRemove);
    const theme = getTheme(this.flags.theme);
    const configManager = new ConfigManager(this.config.configDir);
    const config = await configManager.loadConfig();
    const paths = config.plugins ?? [];

    const absolute = path.resolve(args.plugin);
    const matches = async (pluginPath: string) => {
      if (pluginPath === absolute) return true;
      try {
        return (await localPlugin(pluginPath)).name === args.plugin;
      } catch {
        // Gone or unreadable: match on its folder or file name instead.
        return path.basename(pluginPath).replace(/\.[cm]?[jt]s$/, '') === args.plugin;
      }
    };
    const kept: string[] = [];
    for (const pluginPath of paths) {
      if (!(await matches(pluginPath))) kept.push(pluginPath);
    }
    if (kept.length === paths.length) {
      this.fail(`${args.plugin} isn't a local plugin`, {
        hint: 'See the local plugins: `chronicle plugins`',
      });
    }

    config.plugins = kept;
    await configManager.saveConfig(config);
    this.log(`${theme.success('Removed')} ${theme.textBold(args.plugin)}`);
  }
}
