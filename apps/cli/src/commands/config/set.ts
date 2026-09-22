import { Args, Command } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';

export default class ConfigSetCommand extends Command {
  static override description = 'Set a global configuration value';

  static override examples = [
    '<%= config.bin %> <%= command.id %> log-level debug',
    '<%= config.bin %> <%= command.id %> loader http',
  ];

  static override args = {
    key: Args.string({
      description: 'Configuration key to set',
      required: true,
    }),
    value: Args.string({
      description: 'Configuration value to set',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSetCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      // Try to parse as JSON, fall back to string
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(args.value);
      } catch {
        parsedValue = args.value;
      }

      await configManager.setGlobalValue(args.key, parsedValue);
      this.log(`Set ${args.key} = ${JSON.stringify(parsedValue)}`);
    } catch (error) {
      this.error(`Failed to set configuration: ${error}`);
    }
  }
}
