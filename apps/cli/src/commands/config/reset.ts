import { BaseCommand } from '../../baseCommand.js';
import { Flags } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';
import { canAsk } from '../../output/index.js';

export default class ConfigResetCommand extends BaseCommand<typeof ConfigResetCommand> {
  static override description = 'Delete every flag default and preset';

  static override examples = ['chronicle config reset', 'chronicle config reset --force'];

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      summary: 'Reset without asking',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigResetCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      if (!(await configManager.configExists())) {
        this.logger.info('Nothing to reset');
        return;
      }

      if (!flags.force) {
        // The question needs a terminal to answer it at.
        if (!canAsk()) {
          this.fail("Can't ask to confirm without a terminal", {
            hint: 'Run `chronicle config reset --force` to reset without asking.',
          });
        }
        const { confirm } = await import('../../output/prompts.js');
        const result = await confirm(
          'Delete every flag default and preset, and forget the plugins you added?',
          { defaultValue: false, theme: flags.theme }
        );

        if (result.cancelled || !result.confirmed) {
          this.logger.info('Reset cancelled');
          return;
        }
      }

      await configManager.resetConfig();
      this.summary('Reset the config');
    } catch (error) {
      this.failFrom(error, "Couldn't reset the config");
    }
  }
}
