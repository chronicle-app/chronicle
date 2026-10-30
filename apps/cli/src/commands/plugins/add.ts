import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { addLocalPlugin } from '../../plugins/local.js';
import { strategiesOf } from '../../plugins/PluginScanner.js';
import { tokens } from '../../output/index.js';

export default class PluginsAdd extends BaseCommand<typeof PluginsAdd> {
  static override description = 'Run a plugin from a folder on this machine, without installing it';

  static override examples = [
    'chronicle plugins add ./my-source',
    'chronicle plugins add ./quick-source.ts',
  ];

  static override args = {
    path: Args.string({
      description: "A plugin's folder (with its package.json), or a single file",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(PluginsAdd);
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });

    let added;
    try {
      added = await addLocalPlugin(this.config.configDir, args.path);
    } catch (error) {
      this.failFrom(error);
    }

    this.log(`${t.success('Added')} ${t.strong(added.name)} ${t.muted(added.path)}`);
    for (const source of new Set(added.extractors.map(e => e.source))) {
      const strategies = strategiesOf(added.extractors.filter(e => e.source === source)).map(
        s => `${s.name} (${s.delivery})`
      );
      this.log(`  ${t.command(`chronicle extract ${source}`)}  ${t.muted(strategies.join(', '))}`);
    }
    for (const transformer of added.transformers) {
      const command = t.command(`chronicle extract <source> --transformer ${transformer.source}`);
      this.log(
        `  ${command}${transformer.description ? `  ${t.muted(transformer.description)}` : ''}`
      );
    }
  }
}
