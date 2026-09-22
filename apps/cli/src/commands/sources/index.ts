import { Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { PluginScanner } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';
import { renderExtractorsScreen } from '../../screens/index.js';

export default class Sources extends BaseCommand<typeof Sources> {
  static override description = 'List installed sources and the records they can pull';

  static override aliases = ['list'];

  static override examples = [
    'chronicle sources',
    'chronicle sources --source shell',
    'chronicle sources --delivery local',
    'chronicle sources --record-type messages',
    'chronicle sources info imessage',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    source: Flags.string({
      summary: 'Filter by source (e.g., shell, imessage)',
      helpGroup: 'FILTER',
    }),
    delivery: Flags.string({
      summary: 'Filter by delivery — how the source is read',
      options: ['export', 'api', 'local', 'direct'],
      helpGroup: 'FILTER',
    }),
    'record-type': Flags.string({
      summary: 'Filter by record type (e.g., messages, tasks)',
      helpGroup: 'FILTER',
    }),
    format: Flags.string({
      summary: 'Output format',
      options: ['table', 'json', 'csv'],
      default: 'table',
      helpGroup: 'OUTPUT',
    }),
  };

  async run(): Promise<void> {
    const theme = getTheme(this.flags.theme);

    try {
      // Scan all plugins for extractors
      this.logToStderr(theme.textDim('Scanning installed plugins for extractors...'));
      const extractorsBySource = await PluginScanner.scanAllPlugins();

      // Flatten to array and apply filters
      const allExtractors = [...extractorsBySource.values()].flat();
      const filteredExtractors = this.applyFilters(allExtractors);

      if (filteredExtractors.length === 0 && this.flags.format === 'table') {
        this.log(theme.warning('No extractors found matching the specified criteria.'));
        return;
      }

      // Display in requested format
      switch (this.flags.format) {
        case 'json':
          this.displayAsJson(filteredExtractors);
          break;
        case 'csv':
          this.displayAsCsv(filteredExtractors);
          break;
        case 'table':
        default:
          await this.displayAsTable(filteredExtractors);
          break;
      }
    } catch (error) {
      this.logError('Failed to list sources:', error);
      throw error;
    }
  }

  private applyFilters(extractors: any[]) {
    let filtered = extractors;

    if (this.flags.source) {
      filtered = filtered.filter(ext => ext.source === this.flags.source);
    }

    if (this.flags.delivery) {
      filtered = filtered.filter(ext => ext.delivery === this.flags.delivery);
    }

    if (this.flags['record-type']) {
      filtered = filtered.filter(ext => ext.recordType.includes(this.flags['record-type']));
    }

    return filtered;
  }

  private displayAsTable(extractors: any[]): Promise<void> {
    // Sort by source, then by strategy
    const sortedExtractors = extractors.sort((a, b) => {
      if (a.source !== b.source) {
        return a.source.localeCompare(b.source);
      }
      return a.strategy.localeCompare(b.strategy);
    });

    // Use organized screen component; resolves once the Ink screen unmounts so
    // anything printed after it lands below, not interleaved.
    return renderExtractorsScreen(sortedExtractors, {
      theme: this.flags.theme || 'default',
    });
  }

  private displayAsJson(extractors: any[]) {
    const output = extractors.map(ext => ({
      source: ext.source,
      strategy: ext.strategy,
      delivery: ext.delivery,
      recordTypes: ext.recordType,
      description: ext.description,
      packageName: ext.packageName,
    }));

    this.log(JSON.stringify(output, null, 2));
  }

  private displayAsCsv(extractors: any[]) {
    // CSV header
    this.log('source,strategy,delivery,record_types,description,package');

    // CSV rows
    for (const ext of extractors) {
      const recordTypes = Array.isArray(ext.recordType)
        ? ext.recordType.join(';')
        : ext.recordType || '';

      const csvRow = [
        ext.source,
        ext.strategy,
        ext.delivery,
        recordTypes,
        ext.description || '',
        ext.packageName,
      ]
        .map(value => `"${String(value ?? '').replaceAll('"', '""')}"`)
        .join(',');

      this.log(csvRow);
    }
  }

  private logError(message: string, error: any) {
    if (!this.flags.quiet) {
      console.error(`[0m[ERROR] ${message}`, error instanceof Error ? error.message : error);
      if (this.flags.verbose && error instanceof Error && error.stack) {
        console.error(`[0m[TRACE] Stack:`, error.stack);
      }
    }
  }
}
