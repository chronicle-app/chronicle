import { BaseCommand } from '../../../baseCommand.js';
import { Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';
import { presetDefinitions } from '../../../config/display.js';
import { definitions, stdoutWidth, tokens } from '../../../output/index.js';

export default class PresetListCommand extends BaseCommand<typeof PresetListCommand> {
  static override description = 'List the presets';

  static override examples = [
    'chronicle config preset list',
    'chronicle config preset list --json',
  ];

  static override flags = {
    json: Flags.boolean({
      summary: 'Print them as JSON',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PresetListCommand);
    const configManager = new ConfigManager(this.config.configDir);

    let presets;
    try {
      presets = (await configManager.loadConfig()).presets ?? {};
    } catch (error) {
      this.failFrom(error, "Couldn't read the presets");
    }

    if (flags.json) {
      this.log(JSON.stringify(presets, null, 2));
      return;
    }

    if (Object.keys(presets).length === 0) {
      this.logger.info('No presets');
      this.hint('Run `chronicle config preset create quick --limit 5` to save one.');
      return;
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    for (const line of definitions(presetDefinitions(presets, t), t, stdoutWidth(), 0)) {
      this.log(line);
    }
  }
}
