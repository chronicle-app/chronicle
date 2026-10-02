import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { listSources } from '../../plugins/catalog.js';
import { installPlugin, resolveInstallTarget } from '../../plugins/install.js';
import { getTheme } from '../../theme.js';

export default class PluginsInstall extends BaseCommand<typeof PluginsInstall> {
  static override description = 'Install a plugin by its catalog name, package name, or path';

  static override examples = [
    'chronicle plugins install lastfm',
    'chronicle plugins install @someone/chronicle-plugin',
    'chronicle plugins install ./my-plugin',
  ];

  static override args = {
    plugin: Args.string({ description: 'Catalog name, package, or path', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsInstall);
    const theme = getTheme(this.flags.theme);

    const target = await resolveInstallTarget(args.plugin, this.config.version);
    if (!target.entry) {
      this.logger.warn(`${args.plugin} isn't in the Chronicle catalog`);
    }
    let name: string;
    try {
      name = await installPlugin(target);
    } catch (error) {
      this.failFrom(error);
    }

    const sources = (await listSources()).filter(s => s.package === name);
    this.log(`${theme.success('Installed')} ${theme.textBold(name)}`);
    for (const s of sources) {
      this.log(`  ${theme.text(`chronicle extract ${s.source}`)}`);
    }
  }
}
