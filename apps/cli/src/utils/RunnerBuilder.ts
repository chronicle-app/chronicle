import {
  Base64TruncateTransformer,
  CsvLoader,
  configForIo,
  DelayTransformer,
  DownloadAttachmentsTransformer,
  FilterFieldsTransformer,
  FlattenTransformer,
  JsonLoader,
  NullTransformer,
  Runner,
  SamplingTransformer,
  TableLoader,
  YamlLoader,
  toCamelCase,
} from '@chronicle.app/etl';
import { getTheme } from '../theme.js';

// Loader registry mapping loader names to classes
const loaderRegistry = {
  csv: CsvLoader,
  json: JsonLoader,
  table: TableLoader,
  yaml: YamlLoader,
};

/** The `--type` values a run asked for, or undefined for "every kind". */
export function requestedRecordTypes(type: unknown): string[] | undefined {
  if (typeof type !== 'string' || type.trim() === '') return undefined;
  const types = type
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  return types.length > 0 ? types : undefined;
}

export class RunnerBuilder {
  private flags: any;
  private flagSources: any;

  constructor(flags: any, flagSources?: any) {
    this.flags = flags;
    this.flagSources = flagSources;
  }

  /**
   * Whether the Runner has to filter this extractor's output: true only when it
   * emits kinds the run didn't ask for (an archive read with `--type`). When the
   * extractor emits nothing but what was asked for, `--type` selected it and
   * there is nothing left to filter.
   */
  private needsTypeFilter(selectedExtractor: any): boolean {
    const wanted = requestedRecordTypes(this.flags.type);
    if (!wanted) return false;
    const emitted: string[] = selectedExtractor.recordTypes || [];
    return emitted.some(rt => !wanted.includes(rt));
  }

  /**
   * Build extractor configuration from flags
   */
  buildExtractorConfig(selectedExtractor: any): any {
    if (!selectedExtractor) {
      throw new Error('No extractor selected');
    }

    const config = { ...this.flags };

    // With a type filter in play the Runner owns `--limit`, so the extractor
    // reads unbounded rather than stopping on records that get discarded.
    if (this.needsTypeFilter(selectedExtractor)) {
      config.limit = 0;
    }

    // Convert kebab-case flags back to camelCase for extractor schema
    const extractorConfig: Record<string, any> = {};

    // Get the schema shape from the selected extractor
    const schemaShape = selectedExtractor.schema?.shape || {};

    for (const [key, value] of Object.entries(config)) {
      const camelKey = toCamelCase(key);

      // Use camelCase key if it exists in schema, otherwise use original key
      if (schemaShape[camelKey]) {
        extractorConfig[camelKey] = value;
      } else {
        extractorConfig[key] = value;
      }
    }

    if (selectedExtractor.source === 'csv') Object.assign(extractorConfig, configForIo(this.flags));
    return extractorConfig;
  }

  /**
   * Build loader configuration from flags
   */
  buildLoaderConfig(): any {
    const loaderType = this.flags.loader as keyof typeof loaderRegistry;
    const LoaderClass = loaderRegistry[loaderType];

    if (!LoaderClass) {
      throw new Error(`Unknown loader type: ${this.flags.loader}`);
    }

    // Get the loader's schema to know which flags are relevant
    const loaderSchema = LoaderClass.schema;
    const loaderFields = Object.keys(loaderSchema.shape || {});

    // Filter flags to only include those relevant to the loader
    const config: any = {};
    for (const field of loaderFields) {
      if (field in this.flags && this.flags[field] !== undefined) {
        config[field] = this.flags[field];
      }
    }

    if (config.output === 'stdout') delete config.output;
    return config;
  }

  /**
   * Initialize extractor instance
   */
  async initializeExtractor(selectedExtractor: any): Promise<any> {
    if (!selectedExtractor) {
      throw new Error('No extractor selected');
    }

    const config = this.buildExtractorConfig(selectedExtractor);
    const extractor = new selectedExtractor(config);
    return extractor;
  }

  /**
   * Initialize loader instance
   */
  async initializeLoader(): Promise<any> {
    const loaderType = this.flags.loader as keyof typeof loaderRegistry;
    const LoaderClass = loaderRegistry[loaderType];

    if (!LoaderClass) {
      throw new Error(`Unknown loader type: ${this.flags.loader}`);
    }

    const config = this.buildLoaderConfig();

    // Special handling for JsonLoader to include theme and stdout mode
    if (LoaderClass === JsonLoader) {
      const currentTheme = getTheme(this.flags.theme);
      const isStdoutMode = this.determineStdoutMode();
      const loader = new LoaderClass(config, currentTheme.jsonChalk, isStdoutMode);
      return loader;
    }

    const loader = new LoaderClass(config);
    return loader;
  }

  /**
   * Initialize transformer based on flags and extractor
   */
  initializeTransformer(extractor: any): any {
    if (this.flags.raw) {
      return new NullTransformer();
    }
    if (extractor.constructor.defaultTransformer) {
      return extractor.instantiateDefaultTransformer();
    }
    return new NullTransformer();
  }

  /**
   * Build and configure the complete runner
   */
  async buildRunner(selectedExtractor: any): Promise<Runner> {
    const extractor = await this.initializeExtractor(selectedExtractor);
    const loader = await this.initializeLoader();
    const transformer = this.initializeTransformer(extractor);

    const filtering = this.needsTypeFilter(selectedExtractor);
    const runner = new Runner({
      streamExtraction: this.flags.stream,
      quiet: this.flags.quiet,
      verbose: this.flags.verbose,
      validateSchema: this.flags.validate,
      recordTypes: filtering ? requestedRecordTypes(this.flags.type) : undefined,
      limit: filtering ? this.flags.limit : undefined,
      // A typed --limit states the run's scope, so the frontier yields to it
      // (the Runner's own rule). The CLI's default cap is not a statement of
      // scope: underneath it the frontier stays the stopping rule.
    })
      .addExtractor(extractor)
      .addTransformer(transformer)
      .addLoader(loader);

    // Add optional transformers based on flags
    this.addOptionalTransformers(runner);

    return runner;
  }

  /**
   * Add optional transformers based on flags
   */
  private addOptionalTransformers(runner: Runner): void {
    // Runs first so it sees the clean Chronicle JSON-LD (media nodes intact),
    // before flatten/fields restructure it or truncate-base64 mangles the bytes.
    if (this.flags['download-attachments']) {
      runner.addTransformer(
        new DownloadAttachmentsTransformer({ quiet: this.flags.quiet, verbose: this.flags.verbose })
      );
    }

    if (this.flags.fields) {
      runner.addTransformer(new FilterFieldsTransformer({ fields: this.flags.fields }));
    }

    if (this.flags.flatten) {
      runner.addTransformer(new FlattenTransformer());
    }

    if (this.flags.sample) {
      const rate = Number.parseFloat(this.flags.sample);
      if (Number.isNaN(rate) || rate < 0 || rate > 1) {
        throw new Error('Sample rate must be a number between 0 and 1');
      }
      runner.addTransformer(new SamplingTransformer({ rate }));
    }

    if (this.flags.delay) {
      runner.addTransformer(new DelayTransformer({ delay: this.flags.delay }));
    }

    if (this.flags['truncate-base64']) {
      runner.addTransformer(
        new Base64TruncateTransformer({
          maxLength: 100,
          suffix: '...',
        })
      );
    }
  }

  /**
   * Check if progress screen should be shown - now always true for unified UI
   */
  shouldShowProgressBar(): boolean {
    // Always show the Ink progress screen for all extractions
    // The screen will adapt its behavior based on stdout mode
    return true;
  }

  /**
   * Determine if we're in stdout mode for data output
   */
  private determineStdoutMode(): boolean {
    // We're in stdout mode (should disable cursor controls) if:
    // 1. stdout is not a TTY (being piped or redirected)
    // 2. OR output is explicitly set to 'stdout'
    // 3. OR using json/csv/yaml loader with no output file (outputting to stdout)

    if (!process.stdout.isTTY) return true;
    if (this.flags.output === 'stdout') return true;

    // For data loaders (json, csv, yaml), if no output file specified, we're outputting to stdout
    const loaderType = this.flags.loader;
    if (['json', 'csv', 'yaml'].includes(loaderType) && !this.flags.output) {
      return true;
    }

    return false;
  }
}
