import { Args, Command, Flags } from '@oclif/core';
import { ConfigManager } from '../../config/index.js';

/**
 * Base config command - shows help when run without subcommands
 */
export default class ConfigCommand extends Command {
  static override description = 'Manage Chronicle configuration';

  static override examples = [
    '<%= config.bin %> <%= command.id %> get log-level',
    '<%= config.bin %> <%= command.id %> set log-level debug',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> preset create test --limit 5',
    '<%= config.bin %> <%= command.id %> preset list',
  ];

  async run(): Promise<void> {
    // Show help when no subcommand is provided
    this.log('Manage Chronicle configuration');
    this.log('');
    this.log('Available commands:');
    this.log('  chronicle config get <key>       Get a global configuration value');
    this.log('  chronicle config set <key> <val> Set a global configuration value');
    this.log('  chronicle config list            List all configuration');
    this.log('  chronicle config reset           Reset configuration to defaults');
    this.log('  chronicle config preset create   Create a preset');
    this.log('  chronicle config preset list     List all presets');
    this.log('  chronicle config preset show     Show preset details');
    this.log('  chronicle config preset delete   Delete a preset');
    this.log('');
    this.log('Run "chronicle config <command> --help" for more information on each command.');
  }
}
