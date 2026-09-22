import { Args, Command, Flags } from '@oclif/core';
import { ConfigManager } from '../../../config/index.js';

export default class PresetCreateCommand extends Command {
  static override description = 'Create a configuration preset';

  static override examples = [
    '<%= config.bin %> <%= command.id %> test --limit 5 --log-level debug',
    '<%= config.bin %> <%= command.id %> export --loader json --limit 0',
  ];

  static override args = {
    name: Args.string({
      description: 'Name of the preset to create',
      required: true,
    }),
  };

  static override flags = {
    description: Flags.string({
      char: 'd',
      description: 'Description of the preset',
    }),
  };

  // Allow unknown flags to be captured
  static override strict = false;

  async run(): Promise<void> {
    // Parse manually to capture unknown flags
    const presetName = this.argv[0];
    if (!presetName) {
      this.error('Preset name is required');
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
        this.error('No flags provided for preset. At least one flag must be specified.');
      }

      // Check if preset already exists
      const existing = await configManager.getPreset(presetName);
      if (existing) {
        this.log(`Preset '${presetName}' already exists. Updating...`);
      }

      await configManager.savePreset(presetName, {
        description,
        flags: presetFlags,
      });

      const flagCount = Object.keys(presetFlags).length;
      const action = existing ? 'Updated' : 'Created';
      this.log(`${action} preset '${presetName}' with ${flagCount} flags`);

      if (description) {
        this.log(`Description: ${description}`);
      }

      // Show the flags that were saved
      this.log('Flags:');
      for (const [key, value] of Object.entries(presetFlags)) {
        this.log(`  --${key}: ${JSON.stringify(value)}`);
      }
    } catch (error) {
      this.error(`Failed to create preset: ${error}`);
    }
  }
}
