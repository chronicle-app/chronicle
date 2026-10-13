import { BaseCommand } from '../../../baseCommand.js';
import { Args, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';
import { typedFlags } from '../../../config/display.js';
import { card, date, stdoutWidth, tokens } from '../../../output/index.js';

export default class PresetShowCommand extends BaseCommand<typeof PresetShowCommand> {
  static override description = "Show a preset's flags";

  static override examples = [
    'chronicle config preset show quick',
    'chronicle config preset show quick --json',
  ];

  static override args = {
    name: Args.string({
      description: "The preset's name",
      required: true,
    }),
  };

  static override flags = {
    json: Flags.boolean({
      summary: 'Print it as JSON',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PresetShowCommand);
    const configManager = new ConfigManager(this.config.configDir);

    let preset;
    try {
      preset = await configManager.getPreset(args.name);
    } catch (error) {
      this.failFrom(error, "Couldn't read the presets");
    }

    if (!preset) {
      this.fail(`No preset named "${args.name}"`, {
        code: 'unknown-preset',
        hint: 'Run `chronicle config preset list` to see them.',
      });
    }

    if (flags.json) {
      this.log(JSON.stringify(preset, null, 2));
      return;
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const entries: [string, string][] = [
      ['flags', typedFlags(preset.flags) || 'none'],
      ...(preset.description ? [['description', preset.description] as [string, string]] : []),
      ['created', date(new Date(preset.created))],
      ...(preset.modified && preset.modified !== preset.created
        ? [['modified', date(new Date(preset.modified))] as [string, string]]
        : []),
    ];
    for (const line of card(preset.name, entries, t, stdoutWidth(), { wrap: true })) this.log(line);
    this.hint(
      `Use it with \`--preset ${preset.name}\`, as in \`chronicle extract shell --preset ${preset.name}\`.`
    );
  }
}
