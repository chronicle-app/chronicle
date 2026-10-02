import { BaseCommand } from '../../baseCommand.js';
import { Flags } from '@oclif/core';
import { inkConfirm } from '../../components/InkConfirm.js';
import { ConfigManager } from '../../config/index.js';

export default class ConfigResetCommand extends BaseCommand<typeof ConfigResetCommand> {
  static override description = 'Reset configuration to defaults';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigResetCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const configExists = await configManager.configExists();

      if (!configExists) {
        this.log('No configuration file exists.');
        return;
      }

      if (!flags.force) {
        const result = await inkConfirm(
          'This will delete all configuration and presets. Are you sure?',
          { defaultValue: false }
        );

        if (result.cancelled || !result.confirmed) {
          this.log('Reset cancelled.');
          return;
        }
      }

      await configManager.resetConfig();
      this.log('Configuration reset to defaults.');
    } catch (error) {
      this.failFrom(error, 'Failed to reset configuration');
    }
  }
}
