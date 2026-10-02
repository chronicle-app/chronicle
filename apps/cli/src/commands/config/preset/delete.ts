import { BaseCommand } from '../../../baseCommand.js';
import { Args, Flags } from '@oclif/core';
import { inkConfirm } from '../../../components/InkConfirm.js';
import { ConfigManager } from '../../../config/index.js';

export default class PresetDeleteCommand extends BaseCommand<typeof PresetDeleteCommand> {
  static override description = 'Delete a configuration preset';

  static override examples = [
    '<%= config.bin %> <%= command.id %> test',
    '<%= config.bin %> <%= command.id %> test --force',
  ];

  static override args = {
    name: Args.string({
      description: 'Name of the preset to delete',
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PresetDeleteCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const preset = await configManager.getPreset(args.name);

      if (!preset) {
        this.fail(`Preset '${args.name}' not found`);
      }

      if (!flags.force) {
        const result = await inkConfirm(`Delete preset '${args.name}'?`, { defaultValue: false });

        if (result.cancelled || !result.confirmed) {
          this.log('Delete cancelled.');
          return;
        }
      }

      const deleted = await configManager.deletePreset(args.name);

      if (deleted) {
        this.log(`Preset '${args.name}' deleted.`);
      } else {
        this.fail(`Failed to delete preset '${args.name}'`);
      }
    } catch (error) {
      this.failFrom(error, 'Failed to delete preset');
    }
  }
}
