import { BaseCommand } from '../../baseCommand.js';
import { Args } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';

export default class ConfigGetCommand extends BaseCommand<typeof ConfigGetCommand> {
  static override description = "Print a flag's default";

  static override examples = ['chronicle config get limit', 'chronicle config get loader'];

  static override args = {
    key: Args.string({
      description: 'The flag, like limit',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGetCommand);
    const configManager = new ConfigManager(this.config.configDir);

    let value;
    try {
      value = await configManager.getGlobalValue(args.key);
    } catch (error) {
      this.failFrom(error, "Couldn't read the config");
    }

    if (value === undefined) {
      // Exit 1 like `git config`, so a script can tell an unset key from a mistake.
      this.fail(`No default set for "${args.key}"`, {
        code: 'not-set',
        exitCode: 1,
        hint: 'Run `chronicle config list` to see the defaults.',
      });
    }

    // Output the value in a format suitable for scripts
    this.log(JSON.stringify(value));
  }
}
