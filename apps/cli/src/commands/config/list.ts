import { BaseCommand } from '../../baseCommand.js';
import { Flags } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';
import { presetDefinitions, valueText } from '../../config/display.js';
import { card, definitions, heading, stdoutWidth, tokens } from '../../output/index.js';

export default class ConfigListCommand extends BaseCommand<typeof ConfigListCommand> {
  static override description = 'List the flag defaults and presets';

  static override examples = ['chronicle config list', 'chronicle config list --json'];

  static override flags = {
    json: Flags.boolean({
      summary: 'Print it as JSON',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigListCommand);
    const configManager = new ConfigManager(this.config.configDir);

    let config;
    try {
      config = await configManager.loadConfig();
    } catch (error) {
      this.failFrom(error, "Couldn't read the config");
    }

    if (flags.json) {
      this.log(JSON.stringify(config, null, 2));
      return;
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const width = stdoutWidth();
    const none = `  ${t.muted('none')}`;
    const defaults = Object.entries(config.global ?? {});
    const presets = config.presets ?? {};
    this.log(heading('Flag defaults', t, width));
    if (defaults.length === 0) this.log(none);
    const entries = defaults.map(([key, value]) => [key, valueText(value)] as [string, string]);
    for (const line of card(undefined, entries, t, width - 2, { wrap: true })) {
      this.log(`  ${line}`);
    }
    this.log('');
    this.log(heading('Presets', t, width));
    if (Object.keys(presets).length === 0) this.log(none);
    for (const line of definitions(presetDefinitions(presets, t), t, width)) this.log(line);
    this.log('');
    this.log(heading('File', t, width));
    this.log(`  ${configManager.getConfigPath()}`);
  }
}
