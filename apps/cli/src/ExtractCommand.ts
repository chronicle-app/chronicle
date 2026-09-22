import { Command, Interfaces } from '@oclif/core';

import { BaseCommand } from './baseCommand.js';
import { inkInput } from './components/InkInput.js';
import { PluginScanner } from './plugins/PluginScanner.js';
import { FlagManager } from './utils/FlagManager.js';

type _Flags<T extends typeof Command> = Interfaces.InferredFlags<
  T['flags'] & (typeof ExtractCommand)['baseFlags']
>;

export { dateFlag } from './utils/FlagManager.js';

// ANSI escape sequence patterns
const ANSI_ESCAPE_START = '\u001B';
const ANSI_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE_START}\\[[\\d;]*m`, 'g');

export default abstract class ExtractCommand<T extends typeof Command> extends BaseCommand<T> {
  protected selectedExtractor: any;

  /**
   * Override catch to handle required flag prompting at the framework level
   */
  async catch(error: any): Promise<any> {
    // Check if this is a missing required flag error
    if (error instanceof Error && error.message.includes('Missing required flag')) {
      const match = error.message.match(
        new RegExp(`Missing required flag ([^\\s${ANSI_ESCAPE_START}]+)`)
      );
      if (match) {
        const missingFlag = match[1].replaceAll(ANSI_ESCAPE_PATTERN, ''); // Strip ANSI codes
        try {
          const prompted = await this.promptForRequiredFlag(missingFlag);
          if (prompted) {
            // Add the prompted value to argv and create new instance
            const flagWithDashes =
              missingFlag.length === 1 ? `-${missingFlag}` : `--${missingFlag}`;
            // Update this.argv for the re-run
            const newArgv = [...this.argv, flagWithDashes, prompted];
            this.argv = newArgv;

            // Re-initialize with new arguments
            await this.init();
            return this.run();
          }
        } catch {
          // If prompting fails, fall back to original error
          return super.catch(error);
        }
      }
    }
    return super.catch(error);
  }

  /**
   * Prompt user for a missing required flag
   */
  private async promptForRequiredFlag(flagName: string): Promise<string | null> {
    if (!process.stdin.isTTY) return null;
    try {
      const ExtractCommandClass = this.constructor as typeof ExtractCommand;
      const { flags } = ExtractCommandClass;
      const flagDef = flags[flagName];

      if (!flagDef) return null;

      // Show helpful message before prompting
      console.error(`\n  Missing required flag: --${flagName}`);
      if (flagDef.summary) {
        console.error(`  ${flagDef.summary}`);
      }

      // Show all required flags for this command
      const requiredFlags = Object.entries(flags)
        .filter(([, def]: [string, any]) => def?.required === true)
        .map(([name]) => `--${name}`)
        .join(', ');

      if (requiredFlags) {
        console.error(`  Required flags for this command: ${requiredFlags}`);
      }

      console.error(`  You can also provide this flag directly: --${flagName} <value>\n`);

      const result = await inkInput(`Enter value for required flag --${flagName}:`, {
        validate(input: string) {
          if (!input.trim()) return `${flagName} is required`;
          return true;
        },
      });

      if (result.cancelled) {
        throw new Error('Input cancelled by user');
      }

      return result.value;
    } catch (error) {
      // Handle user cancellation (Ctrl+C)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('force closed') || errorMessage.includes('User aborted')) {
        this.error('Operation cancelled by user');
      }
      throw error;
    }
  }

  async init(): Promise<void> {
    // Set up global console capture IMMEDIATELY at the start of init

    try {
      await super.init();
    } catch (error) {
      // Check if this is a missing required flag error during init
      if (error instanceof Error && error.message.includes('Missing required flag')) {
        const match = error.message.match(/Missing required flag (.+)/);
        if (match) {
          const missingFlag = match[1];
          const prompted = await this.promptForRequiredFlag(missingFlag);
          if (prompted) {
            // Add the prompted value to argv and try init again
            const flagWithDashes =
              missingFlag.length === 1 ? `-${missingFlag}` : `--${missingFlag}`;
            this.argv = [...this.argv, flagWithDashes, prompted];
            // Re-run init with the new argv
            await super.init();
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    const ExtractCommandClass = this.constructor as typeof ExtractCommand;

    // Auto-discover extractors if source is specified but extractors are not
    let { extractors } = ExtractCommandClass;
    if (!extractors && ExtractCommandClass.source) {
      try {
        extractors = await ExtractCommandClass.discoverExtractorsForSource(
          ExtractCommandClass.source
        );
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    }

    // A static-extractor command (`extract csv`) names its own extractor; every
    // source with more than one way in goes through the dispatcher instead.
    const selected = Array.isArray(extractors)
      ? (extractors.find((e: any) => e.default) ?? extractors[0])?.extractor
      : extractors;

    if (!selected) {
      this.error('No extractor available for this command');
    }

    if (this.flags['list-types']) {
      this.log((selected.recordTypes || []).join('\n'));
      this.exit(0);
    }

    this.selectedExtractor = selected;
  }

  static override baseFlags = FlagManager.getBaseFlags(BaseCommand.baseFlags);

  static override description = 'Extract records from a source';
  static extractors: any; // Can be single extractor or array of extractor options
  static source?: string; // Source name for auto-discovery
  static delivery?: 'export' | 'api' | 'local' | 'direct'; // How the source reaches us

  /**
   * Convert a Zod schema to OCLIF flags
   */
  static schemaToFlags(
    { helpGroup = 'EXTRACTION', schema } = {} as {
      helpGroup?: string;
      schema?: any;
    }
  ) {
    return FlagManager.schemaToFlags(schema || this.extractors, helpGroup, this.baseFlags);
  }

  /**
   * Auto-discover extractors for a given source from the plugin registry
   * This allows commands to specify just a source name instead of manually listing extractors
   */
  static async discoverExtractorsForSource(source: string) {
    const extractorsBySource = await PluginScanner.scanAllPlugins();
    const sourceExtractors = extractorsBySource.get(source) || [];

    if (sourceExtractors.length === 0) {
      throw new Error(`No extractors found for source: ${source}`);
    }

    return sourceExtractors.map(extractor => ({
      name: extractor.strategy,
      description: extractor.description,
      extractor: extractor.extractor,
      default: extractor.default,
    }));
  }

  public async run(): Promise<any> {
    const { runExtraction } = await import('./utils/runExtraction.js');
    return runExtraction(
      this.selectedExtractor,
      this.flags,
      (this.constructor as any).id || 'extract'
    );
  }

  /**
   * Get schema defaults for flag resolution
   * Override to provide ExtractCommand-specific defaults
   */
  protected getSchemaDefaults(): Record<string, any> {
    return {
      loader: 'json', // Default loader from FlagManager
      limit: 100, // Default limit from FlagManager
      headers: true, // Default headers from FlagManager
      validate: true, // Default validate from FlagManager
      stream: false, // Default stream from FlagManager
    };
  }

  /**
   * Log error messages
   */
  private logError(message: string, error: any): void {
    if (!this.flags.quiet) {
      console.error(`\u001B[0m[ERROR] ${message}`, error instanceof Error ? error.message : error);
      if (this.flags.verbose && error instanceof Error && error.stack) {
        console.error(`\u001B[0m[TRACE] Stack:`, error.stack);
      }
    }
  }

  /**
   * Handle initialization step reporting - can be overridden by subclasses
   */
  protected reportInitializationStep(message: string): void {
    if (!this.flags.quiet) {
      console.error(`\u001B[0mℹ ${message}`);
    }
  }
}
