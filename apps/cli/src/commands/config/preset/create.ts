import { BaseCommand } from '../../../baseCommand.js';
import { Args, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';
import { typedFlags } from '../../../config/display.js';

export default class PresetCreateCommand extends BaseCommand<typeof PresetCreateCommand> {
  static override description = 'Save flags as a preset to use with `--preset`';

  static override usage = 'config preset create <name> [flags...]';

  static override examples = [
    'chronicle config preset create quick --limit 5 --loader table',
    'chronicle config preset create everything --limit 0 -d "Every record"',
  ];

  static override args = {
    name: Args.string({
      description: "The preset's name",
      required: true,
    }),
  };

  static override flags = {
    description: Flags.string({
      char: 'd',
      summary: 'What the preset is for',
    }),
  };

  // Allow unknown flags to be captured
  static override strict = false;
  static override parsesInInit = false;

  async run(): Promise<void> {
    // Parse manually to capture unknown flags
    const presetName = this.argv[0];
    if (!presetName) {
      this.fail('No preset name given', {
        hint: 'Name it before its flags, like `chronicle config preset create quick --limit 5`.',
      });
    }
    const configManager = new ConfigManager(this.config.configDir);

    try {
      // Parse flags from argv (skip first argument which is the preset name)
      const presetFlags: Record<string, any> = {};
      let description: string | undefined;

      // Process argv to capture all --flag=value or --flag value pairs
      for (let i = 1; i < this.argv.length; i++) {
        const arg = this.argv[i];
        if (typeof arg === 'string' && arg.startsWith('--')) {
          let flagName: string;
          let flagValue: any;

          if (arg.includes('=')) {
            // Handle --flag=value format
            const [name, ...valueParts] = arg.slice(2).split('=');
            flagName = name;
            flagValue = valueParts.join('=');
          } else {
            // Handle --flag value format
            flagName = arg.slice(2);
            const nextArg = this.argv[i + 1];

            if (typeof nextArg === 'string' && !nextArg.startsWith('--')) {
              flagValue = nextArg;
              i++; // Skip next arg since we consumed it
            } else {
              // Boolean flag
              flagValue = true;
            }
          }

          // Handle special description flag
          if (flagName === 'description' || flagName === 'd') {
            description = String(flagValue);
          } else {
            // Try to parse as number or boolean
            if (flagValue === 'true') flagValue = true;
            else if (flagValue === 'false') flagValue = false;
            else if (!Number.isNaN(Number(flagValue)) && flagValue !== '') {
              flagValue = Number(flagValue);
            }

            presetFlags[flagName] = flagValue;
          }
        }
      }

      if (Object.keys(presetFlags).length === 0) {
        this.fail('No flags given', {
          hint: `Add the flags to save, like \`chronicle config preset create ${presetName} --limit 5\`.`,
        });
      }

      const existing = await configManager.getPreset(presetName);
      await configManager.savePreset(presetName, {
        description,
        flags: presetFlags,
      });

      this.logger.emit({
        level: 'info',
        kind: 'summary',
        message: `${existing ? 'Updated' : 'Saved'} the preset ${presetName} with ${typedFlags(presetFlags)}`,
      });
    } catch (error) {
      this.failFrom(error, "Couldn't save the preset");
    }
  }
}
