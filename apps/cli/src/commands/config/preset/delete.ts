import { BaseCommand } from '../../../baseCommand.js';
import { Args, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';
import { canAsk } from '../../../output/index.js';

export default class PresetDeleteCommand extends BaseCommand<typeof PresetDeleteCommand> {
  static override description = 'Delete a preset';

  static override examples = [
    'chronicle config preset delete quick',
    'chronicle config preset delete quick --force',
  ];

  static override args = {
    name: Args.string({
      description: "The preset's name",
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      summary: 'Delete without asking',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PresetDeleteCommand);
    const configManager = new ConfigManager(this.config.configDir);

    try {
      const preset = await configManager.getPreset(args.name);

      if (!preset) {
        this.fail(`No preset named "${args.name}"`, {
          code: 'unknown-preset',
          hint: 'Run `chronicle config preset list` to see them.',
        });
      }

      if (!flags.force) {
        // The question needs a terminal to answer it at.
        if (!canAsk()) {
          this.fail("Can't ask to confirm without a terminal", {
            hint: `Run \`chronicle config preset delete ${args.name} --force\` to delete it without asking.`,
          });
        }
        const { confirm } = await import('../../../output/prompts.js');
        const result = await confirm(`Delete the preset ${args.name}?`, {
          defaultValue: false,
          theme: flags.theme,
        });

        if (result.cancelled || !result.confirmed) {
          this.logger.info('Delete cancelled');
          return;
        }
      }

      if (!(await configManager.deletePreset(args.name))) {
        this.fail(`Couldn't delete the preset ${args.name}`);
      }
      this.summary(`Deleted the preset ${args.name}`);
    } catch (error) {
      this.failFrom(error, "Couldn't delete the preset");
    }
  }
}
