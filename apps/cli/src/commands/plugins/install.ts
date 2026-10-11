import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { listSources } from '../../plugins/catalog.js';
import { installPlugin, resolveInstallTarget } from '../../plugins/install.js';
import { tokens } from '../../output/index.js';

export default class PluginsInstall extends BaseCommand<typeof PluginsInstall> {
  static override description = 'Install a plugin from the catalog, npm, or a folder';

  static override examples = [
    'chronicle plugins install lastfm',
    'chronicle plugins install @someone/chronicle-plugin',
    'chronicle plugins install ./my-plugin',
  ];

  static override args = {
    plugin: Args.string({
      description: 'A catalog name, npm package, or path',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsInstall);
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });

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
    this.log(`${t.success('Installed')} ${t.strong(name)}`);
    for (const s of sources) {
      this.log(`  ${t.command(`chronicle extract ${s.source}`)}`);
    }
  }
}
