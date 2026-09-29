import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { uninstallPlugin } from '../../plugins/install.js';
import { PluginScanner } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';

export default class PluginsUninstall extends BaseCommand<typeof PluginsUninstall> {
  static override description = 'Remove a plugin installed with `chronicle plugins install`';

  static override examples = ['chronicle plugins uninstall lastfm'];

  static override args = {
    plugin: Args.string({ description: 'Catalog name or package', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsUninstall);
    const theme = getTheme(this.flags.theme);

    let removed: boolean;
    try {
      removed = await uninstallPlugin(args.plugin);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
    if (removed) {
      this.log(`${theme.success('Uninstalled')} ${theme.textBold(args.plugin)}`);
      return;
    }

    // Say where it comes from instead, if it's found somewhere else.
    const found = (await PluginScanner.findChroniclePlugins()).find(
      p => p.name === args.plugin || p.name.endsWith(`/${args.plugin}`)
    );
    this.error(
      found
        ? `${found.name} is ${ORIGINS[found.origin]} (${found.path}), not installed by chronicle.`
        : `${args.plugin} isn't installed.`
    );
  }
}

const ORIGINS = {
  local: 'added with `chronicle plugins add`, so use `chronicle plugins remove`',
  workspace: 'in this checkout',
  installed: 'installed',
  'beside-cli': 'installed beside the CLI with npm',
  bundled: 'bundled with the CLI',
} as const;
