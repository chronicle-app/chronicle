import { BaseCommand } from '../../baseCommand.js';
import { Args } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';

export default class ConfigGetCommand extends BaseCommand<typeof ConfigGetCommand> {
  static override description = 'Get a global configuration value';

  static override examples = [
    '<%= config.bin %> <%= command.id %> log-level',
    '<%= config.bin %> <%= command.id %> loader',
  ];

  static override args = {
    key: Args.string({
      description: 'Configuration key to get',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGetCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const value = await configManager.getGlobalValue(args.key);

      if (value === undefined) {
        this.log(`Configuration key '${args.key}' is not set`);
        this.exit(1);
      }

      // Output the value in a format suitable for scripts
      this.log(JSON.stringify(value));
    } catch (error) {
      this.failFrom(error, 'Failed to get configuration');
    }
  }
}
