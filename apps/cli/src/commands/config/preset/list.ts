import { Command, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';

export default class PresetListCommand extends Command {
  static override description = 'List all configuration presets';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    json: Flags.boolean({
      description: 'Output in JSON format',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PresetListCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const config = await configManager.loadConfig();
      const presets = config.presets || {};

      if (flags.json) {
        this.log(JSON.stringify(presets, null, 2));
        return;
      }

      const presetNames = Object.keys(presets);

      if (presetNames.length === 0) {
        this.log('No presets configured.');
        this.log('Create a preset with: chronicle config preset create <name> [flags...]');
        return;
      }

      this.log('Configuration Presets:');
      this.log('=====================');

      for (const name of presetNames.sort()) {
        const preset = presets[name];
        const flagCount = Object.keys(preset.flags).length;

        this.log(`\n${name}`);
        if (preset.description) {
          this.log(`  Description: ${preset.description}`);
        }
        this.log(`  Flags: ${flagCount}`);
        this.log(`  Created: ${preset.created}`);
        if (preset.modified && preset.modified !== preset.created) {
          this.log(`  Modified: ${preset.modified}`);
        }
      }

      this.log(`\nTotal: ${presetNames.length} presets`);
      this.log('Use "chronicle config preset show <name>" to see details');
    } catch (error) {
      this.error(`Failed to list presets: ${error}`);
    }
  }
}
