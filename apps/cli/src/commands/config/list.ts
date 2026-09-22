import { Command, Flags } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';
import { renderConfigScreen } from '../../screens/index.js';

export default class ConfigListCommand extends Command {
  static override description = 'List all configuration values';

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
    const { flags } = await this.parse(ConfigListCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const config = await configManager.loadConfig();

      if (flags.json) {
        this.log(JSON.stringify(config, null, 2));
        return;
      }

      // Use organized screen component
      renderConfigScreen(config, configManager.getConfigPath(), {
        theme: 'default',
      });
    } catch (error) {
      this.error(`Failed to list configuration: ${error}`);
    }
  }
}
