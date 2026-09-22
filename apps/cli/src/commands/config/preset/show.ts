import { Args, Command, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';

export default class PresetShowCommand extends Command {
  static override description = 'Show details of a configuration preset';

  static override examples = [
    '<%= config.bin %> <%= command.id %> test',
    '<%= config.bin %> <%= command.id %> chronicle --json',
  ];

  static override args = {
    name: Args.string({
      description: 'Name of the preset to show',
      required: true,
    }),
  };

  static override flags = {
    json: Flags.boolean({
      description: 'Output in JSON format',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PresetShowCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const preset = await configManager.getPreset(args.name);

      if (!preset) {
        this.error(`Preset '${args.name}' not found`);
      }

      if (flags.json) {
        this.log(JSON.stringify(preset, null, 2));
        return;
      }

      // Human-readable format
      this.log(`Preset: ${preset.name}`);
      this.log('='.repeat(preset.name.length + 8));

      if (preset.description) {
        this.log(`Description: ${preset.description}`);
      }

      this.log(`Created: ${preset.created}`);
      if (preset.modified && preset.modified !== preset.created) {
        this.log(`Modified: ${preset.modified}`);
      }

      const flagCount = Object.keys(preset.flags).length;
      this.log(`\nFlags (${flagCount}):`);

      if (flagCount === 0) {
        this.log('  (none)');
      } else {
        for (const [key, value] of Object.entries(preset.flags)) {
          this.log(`  --${key}: ${JSON.stringify(value)}`);
        }
      }

      this.log(`\nUsage:`);
      this.log(`  chronicle extract <source> --preset ${preset.name}`);
      this.log(`  chronicle extract <source> --preset ${preset.name} --limit 10  # override flags`);
    } catch (error) {
      this.error(`Failed to show preset: ${error}`);
    }
  }
}
