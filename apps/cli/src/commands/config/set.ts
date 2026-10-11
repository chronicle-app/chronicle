import { BaseCommand } from '../../baseCommand.js';
import { Args } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';

export default class ConfigSetCommand extends BaseCommand<typeof ConfigSetCommand> {
  static override description = "Set a flag's default for every command";

  static override examples = ['chronicle config set limit 500', 'chronicle config set loader yaml'];

  static override args = {
    key: Args.string({
      description: 'The flag, like limit',
      required: true,
    }),
    value: Args.string({
      description: 'Its default',
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
      this.logger.emit({
        level: 'info',
        kind: 'summary',
        message: `Set the default for ${args.key} to ${JSON.stringify(parsedValue)}`,
      });
    } catch (error) {
      this.failFrom(error, "Couldn't set the default");
    }
  }
}
