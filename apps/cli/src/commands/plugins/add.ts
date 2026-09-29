import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { addLocalPlugin } from '../../plugins/local.js';
import { strategiesOf } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';

export default class PluginsAdd extends BaseCommand<typeof PluginsAdd> {
  static override description = 'Run a plugin from a folder on this machine, without installing it';

  static override examples = [
    'chronicle plugins add ./my-source',
    'chronicle plugins add ./quick-source.ts',
  ];

  static override args = {
    path: Args.string({
      description: "The plugin's folder (with its package.json), or a single file",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsAdd);
    const theme = getTheme(this.flags.theme);

    let added;
    try {
      added = await addLocalPlugin(this.config.configDir, args.path);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    this.log(
      `${theme.success('Added')} ${theme.textBold(added.name)} ${theme.textDim(added.path)}`
    );
    for (const source of new Set(added.extractors.map(e => e.source))) {
      const strategies = strategiesOf(added.extractors.filter(e => e.source === source)).map(
        s => `${s.name} (${s.delivery})`
      );
      this.log(
        `  ${theme.text(`chronicle extract ${source}`)}  ${theme.textDim(strategies.join(', '))}`
      );
    }
  }
}
