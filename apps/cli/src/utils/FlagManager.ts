import { CsvLoader, JsonLoader, TableLoader, YamlLoader, toKebabCase } from '@chronicle.app/etl';
import { Flags } from '@oclif/core';
import { parseDuration } from './date.js';

const DEFAULT_LIMIT = 100;

export const dateFlag = Flags.custom<Date>({
  async parse(input: string) {
    const duration = parseDuration(input);
    return duration ? new Date(Date.now() - duration) : new Date(input);
  },
});

// Loader registry mapping loader names to classes
const loaderRegistry = {
  csv: CsvLoader,
  json: JsonLoader,
  table: TableLoader,
  yaml: YamlLoader,
};

export class FlagManager {
  /**
   * Helper functions for Zod type analysis
   */
  private static isBooleanType(type: any): boolean {
    if (type.typeName === 'ZodBoolean') return true;
    if (type.typeName === 'ZodOptional') return this.isBooleanType(type.innerType._def);
    if (type.typeName === 'ZodDefault') return this.isBooleanType(type.innerType._def);
    return false;
  }

  private static getDefault(type: any): any {
    if (type.typeName === 'ZodDefault') return type.defaultValue();
    if (type.typeName === 'ZodOptional') return this.getDefault(type.innerType._def);
    return undefined;
  }

  private static isRequired(type: any): boolean {
    if (type.typeName === 'ZodOptional') return false;
    if (type.typeName === 'ZodDefault') return false;
    return true;
  }

  /**
   * The `--loader` selection flag. Its default encodes the verb: `extract`
   * defaults to stdout (`json`), `ingest` defaults to the local store.
   */
  static loaderFlag(defaultValue: keyof typeof loaderRegistry | string = 'json') {
    return Flags.string({
      default: defaultValue,
      helpGroup: 'LOADING',
      options: Object.keys(loaderRegistry),
      summary: 'The loader to use',
    });
  }

  /**
   * `--via <strategy>`: the named way in, offered as the source's own words.
   * `--strategy` is kept as an explicit alias — same axis, older spelling.
   */
  static viaFlags(candidates: Array<{ strategy: string; delivery: string }>) {
    const ways = [...new Set(candidates.map(c => c.strategy))];
    const summary =
      ways.length > 0 ? `How to read this source: ${ways.join(', ')}` : 'How to read this source';
    return {
      via: Flags.string({
        summary,
        helpValue: '<strategy>',
        helpGroup: 'EXTRACTION',
        options: ways.length > 0 ? ways : undefined,
      }),
      strategy: Flags.string({
        summary: 'Alias for --via',
        helpGroup: 'EXTRACTION',
        options: ways.length > 0 ? ways : undefined,
        hidden: true,
      }),
    };
  }

  /**
   * Get all loader flags with proper grouping and context
   */
  static getAllLoaderFlags() {
    const flags: Record<string, any> = {};

    // Add the main loader selection flag
    flags.loader = this.loaderFlag();

    // Add generic output flag (prioritized over loader-specific ones)
    flags.output = Flags.string({
      char: 'o',
      helpGroup: 'LOADING',
      summary: 'Output file path (default: stdout)',
    });

    // Add generic headers flag (applies to csv, table loaders)
    flags.headers = Flags.boolean({
      allowNo: true,
      default: true,
      helpGroup: 'LOADING',
      summary: 'Show column headers in output (csv, table)',
    });

    // Collect all loader-specific flags, but prioritize ExtractCommand-defined ones.
    // `theme` and `quiet` are global flags; skip them so a loader schema can carry
    // them into config (StoreLoader) without redefining them as LOADING string flags.
    const prioritizedFlags = new Set([
      'output',
      'headers',
      'trace',
      'trace-format',
      'theme',
      'quiet',
      'fold-batch',
    ]);

    // Add flags for each loader type, but skip ones we've already defined
    for (const [loaderName, LoaderClass] of Object.entries(loaderRegistry)) {
      if (LoaderClass.schema) {
        for (const [flagName, zodType] of Object.entries(LoaderClass.schema.shape)) {
          if (prioritizedFlags.has(flagName)) {
            continue;
          }

          const description = (zodType as any)._def.description || '';
          const defaultValue = (zodType as any)._def.default;
          const helpGroup = `LOADING (--loader=${loaderName})`;

          flags[flagName] = Flags.string({
            helpGroup,
            summary: description,
            default: defaultValue,
          });
        }
      }
    }

    return flags;
  }

  /**
   * Get base extraction and transformation flags
   */
  static getBaseFlags(baseCommandFlags: any) {
    return {
      ...baseCommandFlags,
      delay: Flags.integer({
        helpGroup: 'TRANSFORMATION',
        hidden: true,
        summary: 'Delay the transformation of records by this many milliseconds',
      }),
      fields: Flags.string({
        helpGroup: 'TRANSFORMATION',
        helpValue: '<field.subfield>',
        multiple: true,
        summary: 'Pick only certain fields',
      }),
      flatten: Flags.boolean({
        helpGroup: 'TRANSFORMATION',
        summary: 'Flatten objects',
      }),
      sample: Flags.string({
        helpGroup: 'TRANSFORMATION',
        summary: 'Sample records at given rate (e.g., 0.5 for 50%)',
      }),
      'truncate-base64': Flags.boolean({
        helpGroup: 'TRANSFORMATION',
        summary: 'Truncate base64 encoded strings to 100 characters for readability',
        default: false,
      }),
      'download-attachments': Flags.boolean({
        helpGroup: 'TRANSFORMATION',
        summary: 'Download media referenced by url and embed the bytes inline for ingest',
        default: false,
      }),
      input: Flags.string({
        char: 'i',
        helpGroup: 'EXTRACTION',
        summary: 'Input file or directory path',
      }),
      limit: Flags.integer({
        char: 'l',
        default: DEFAULT_LIMIT,
        helpGroup: 'EXTRACTION',
        async parse(input: string) {
          return Number.parseInt(input, 10);
        },
        summary: 'Limit the number of records extracted. Use 0 for no limit.',
      }),
      raw: Flags.boolean({
        helpGroup: 'TRANSFORMATION',
        summary: "Don't transform extracted data into Chronicle schema.",
      }),
      validate: Flags.boolean({
        allowNo: true,
        default: true,
        helpGroup: 'TRANSFORMATION',
        summary: 'Validate transformed records against Chronicle schema',
      }),
      since: dateFlag({
        char: 's',
        helpGroup: 'EXTRACTION',
        summary: 'Extract records since this date',
      }),
      stream: Flags.boolean({
        default: false,
        description: 'Stream results instead of buffering until complete',
        helpGroup: 'EXTRACTION',
      }),
      until: dateFlag({
        char: 'u',
        helpGroup: 'EXTRACTION',
        summary: 'Extract records until this date',
      }),
      type: Flags.string({
        helpGroup: 'EXTRACTION',
        summary: 'Record kinds to pull, comma-separated (default: every kind)',
        helpValue: '<kind[,kind]>',
        char: 't',
      }),
      'list-types': Flags.boolean({
        helpGroup: 'EXTRACTION',
        summary: 'List the ways in and the record kinds each carries, then exit',
        char: 'L',
      }),
      ...this.getAllLoaderFlags(),
    };
  }

  /**
   * Convert a Zod schema to OCLIF flags
   */
  static schemaToFlags(extractors: any, helpGroup = 'EXTRACTION', baseFlags: any) {
    // If extractors is an array, combine flags from all extractors
    if (Array.isArray(extractors)) {
      return this.combineExtractorFlags(extractors, helpGroup);
    }

    // Single extractor
    const schema = extractors?.schema;
    if (!schema) {
      return {};
    }

    return this.convertSchemaToFlags(schema, helpGroup, baseFlags);
  }

  /**
   * Convert a single schema to flags
   */
  private static convertSchemaToFlags(schema: any, helpGroup: string, baseFlags: any) {
    return Object.fromEntries(
      Object.entries(schema.shape)
        .filter(([key]) => !(key in baseFlags))
        .filter(([key]) => !['filename', 'inputStream'].includes(key))
        .map(([key, value]) => {
          const zodType = (value as any)._def;

          if (this.isBooleanType(zodType)) {
            return [
              toKebabCase(key),
              Flags.boolean({
                default: this.getDefault(zodType),
                helpGroup,
                summary: zodType.description,
                allowNo: true,
              }),
            ];
          }

          // Required-ness is schema-driven: a source that needs `input` marks
          // it required in its Zod schema (e.g. twitter/email), while sources
          // that auto-detect it keep it optional (e.g. shell).
          const flagConfig: any = {
            char: key === 'input' ? 'i' : undefined,
            default: this.getDefault(zodType),
            helpGroup,
            summary: zodType.description,
            required: this.isRequired(zodType),
          };

          return [toKebabCase(key), Flags.string(flagConfig)];
        })
    );
  }

  /**
   * Combine flags from multiple extractors into a union
   */
  private static combineExtractorFlags(extractors: any[], helpGroup: string) {
    const combinedFlags: Record<string, any> = {};

    for (const extractorOption of extractors) {
      let schema: any;

      // Handle both simplified array format (raw classes) and normalized format
      if (typeof extractorOption === 'function' && extractorOption.schema) {
        // Simplified format - raw extractor class
        schema = extractorOption.schema;
      } else if (extractorOption.extractor?.schema) {
        // Normalized format - wrapped in object
        schema = extractorOption.extractor.schema;
      }

      if (!schema) continue;

      const extractorFlags = this.convertSchemaToFlags(schema, helpGroup, {});

      // Merge flags, with later extractors potentially overriding earlier ones
      Object.assign(combinedFlags, extractorFlags);
    }

    return combinedFlags;
  }

  /**
   * Build extractor configuration from flags
   */
  static buildExtractorConfig(flags: any) {
    const config: any = {};

    // Copy all flags to config, converting kebab-case back to camelCase
    for (const [key, value] of Object.entries(flags)) {
      if (value !== undefined) {
        // Convert kebab-case flag names back to camelCase for config
        const configKey = key.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        config[configKey] = value;
      }
    }

    return config;
  }

  /**
   * Build loader configuration from flags
   */
  static buildLoaderConfig(flags: any, selectedLoader: string) {
    const LoaderClass = loaderRegistry[selectedLoader as keyof typeof loaderRegistry];

    if (!LoaderClass?.schema) {
      return { loader: selectedLoader };
    }

    const loaderConfig: any = { loader: selectedLoader };
    const schemaKeys = Object.keys(LoaderClass.schema.shape);

    // Filter flags to only include those relevant to the selected loader
    for (const [key, value] of Object.entries(flags)) {
      if (value !== undefined && schemaKeys.includes(key)) {
        loaderConfig[key] = value;
      }
    }

    return loaderConfig;
  }
}
