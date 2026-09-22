import { ConfigManager } from './ConfigManager.js';
import type { PresetConfig } from './schema.js';

export interface FlagSource {
  source: 'explicit' | 'preset' | 'global' | 'environment' | 'default';
  preset?: string;
}

export interface ResolvedFlags {
  flags: Record<string, any>;
  sources: Record<string, FlagSource>;
}

/**
 * Resolves flags from multiple sources in priority order
 */
export class FlagResolver {
  constructor(private configManager: ConfigManager) {}

  /**
   * Check if a flag was explicitly provided on the command line
   */
  private isExplicitCliArg(flagName: string): boolean {
    // Check for long form
    const hasLongForm = process.argv.some(
      arg => arg === `--${flagName}` || arg.startsWith(`--${flagName}=`)
    );

    // Check for short form (handle known mappings)
    const shortFormMappings: Record<string, string> = {
      verbose: 'v',
      quiet: 'q',
      preset: 'p',
      input: 'i',
      limit: 'l',
      since: 's',
      until: 'u',
      output: 'o',
    };
    const shortChar = shortFormMappings[flagName];
    const hasShortForm = shortChar
      ? process.argv.some(arg => arg === `-${shortChar}` || arg.startsWith(`-${shortChar}=`))
      : false;

    return hasLongForm || hasShortForm;
  }

  /**
   * Resolve flags from all sources in priority order
   *
   * Priority (highest to lowest):
   * 1. Explicit CLI flags
   * 2. Preset configurations (left to right)
   * 3. Global config values
   * 4. Environment variables
   * 5. Schema defaults
   */
  async resolveFlags(
    explicitFlags: Record<string, any>,
    presetNames: string[] = [],
    environmentVars: Record<string, any> = {},
    schemaDefaults: Record<string, any> = {}
  ): Promise<ResolvedFlags> {
    const resolvedFlags: Record<string, any> = {};
    const sources: Record<string, FlagSource> = {};

    // 5. Start with schema defaults (lowest priority)
    for (const [key, value] of Object.entries(schemaDefaults)) {
      if (value !== undefined) {
        resolvedFlags[key] = value;
        sources[key] = { source: 'default' };
      }
    }

    // 4. Apply environment variables
    for (const [key, value] of Object.entries(environmentVars)) {
      if (value !== undefined) {
        resolvedFlags[key] = value;
        sources[key] = { source: 'environment' };
      }
    }

    // 3. Apply global config values
    const config = await this.configManager.loadConfig();
    if (config.global) {
      for (const [key, value] of Object.entries(config.global)) {
        if (value !== undefined) {
          resolvedFlags[key] = value;
          sources[key] = { source: 'global' };
        }
      }
    }

    // 2. Apply preset configurations (left to right)
    for (const presetName of presetNames) {
      const preset = await this.configManager.getPreset(presetName);
      if (preset) {
        for (const [key, value] of Object.entries(preset.flags)) {
          if (value !== undefined) {
            resolvedFlags[key] = value;
            sources[key] = { source: 'preset', preset: presetName };
          }
        }
      } else {
        throw new Error(`Preset '${presetName}' not found`);
      }
    }

    // 1. Apply explicit CLI flags (highest priority)
    for (const [key, value] of Object.entries(explicitFlags)) {
      if (value !== undefined) {
        // Check if this "explicit" flag is actually just an oclif default
        const isActuallyDefault = schemaDefaults[key] === value && !this.isExplicitCliArg(key);

        if (isActuallyDefault) {
          // This is just an oclif default, don't override existing source unless there isn't one
          if (!sources[key]) {
            resolvedFlags[key] = value;
            sources[key] = { source: 'default' };
          }
          continue;
        }

        resolvedFlags[key] = value;
        sources[key] = { source: 'explicit' };
      }
    }

    return { flags: resolvedFlags, sources };
  }

  /**
   * Parse comma-separated preset names
   */
  parsePresetNames(presetString?: string): string[] {
    if (!presetString) return [];
    return presetString
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);
  }

  /**
   * Format flag sources for debugging output
   */
  formatSources(sources: Record<string, FlagSource>): string[] {
    const lines: string[] = [];
    for (const [flag, source] of Object.entries(sources)) {
      const sourceDesc = source.preset ? `${source.source} (${source.preset})` : source.source;
      lines.push(`  ${flag}: ${sourceDesc}`);
    }
    return lines;
  }
}
