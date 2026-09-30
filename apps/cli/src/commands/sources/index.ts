import { Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { listSources, type SourceListing } from '../../plugins/catalog.js';
import { getTheme } from '../../theme.js';
import { renderSourcesScreen } from '../../screens/index.js';

const legacyNote = (count: number) =>
  `Not showing ${count} legacy ${count === 1 ? 'source' : 'sources'} for services that no ` +
  'longer exist. Run chronicle sources --all to include them.';

export default class Sources extends BaseCommand<typeof Sources> {
  static override description = 'List catalog and installed sources and the records they can pull';

  static override aliases = ['list'];

  static override examples = [
    'chronicle sources',
    'chronicle sources --all',
    'chronicle sources --source shell',
    'chronicle sources --delivery local',
    'chronicle sources --record-type messages',
    'chronicle sources info imessage',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    all: Flags.boolean({
      summary: 'Include legacy sources for services that no longer exist',
      helpGroup: 'FILTER',
    }),
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
      const matching = this.applyFilters(await listSources());
      // Legacy sources are for services that no longer exist: listed on request.
      const showLegacy = this.flags.all || Boolean(this.flags.source);
      const sources = showLegacy ? matching : matching.filter(s => s.tier !== 'legacy');
      const hiddenLegacy = matching.length - sources.length;

      if (sources.length === 0 && this.flags.format === 'table') {
        this.log(theme.warning('No sources found matching the specified criteria.'));
        if (hiddenLegacy > 0) this.log(theme.textDim(legacyNote(hiddenLegacy)));
        return;
      }

      // Display in requested format
      switch (this.flags.format) {
        case 'json':
          this.log(JSON.stringify(sources, null, 2));
          break;
        case 'csv':
          this.displayAsCsv(sources);
          break;
        case 'table':
        default:
          await this.displayAsTable(sources);
          if (hiddenLegacy > 0) this.log(theme.textDim(` ${legacyNote(hiddenLegacy)}`));
          break;
      }
    } catch (error) {
      this.logError('Failed to list sources', error);
      throw error;
    }
  }

  private applyFilters(sources: SourceListing[]) {
    let filtered = sources;

    if (this.flags.source) {
      filtered = filtered.filter(s => s.source === this.flags.source);
    }

    if (this.flags.delivery) {
      filtered = filtered.filter(s =>
        s.strategies.some(strategy => strategy.delivery === this.flags.delivery)
      );
    }

    if (this.flags['record-type']) {
      const type = this.flags['record-type'];
      filtered = filtered.filter(s =>
        s.strategies.some(strategy => strategy.recordTypes.includes(type))
      );
    }

    return filtered;
  }

  private displayAsTable(sources: SourceListing[]): Promise<void> {
    // Resolves once the Ink screen unmounts so anything printed after it
    // lands below, not interleaved.
    return renderSourcesScreen(sources, {
      theme: this.flags.theme || 'default',
    });
  }

  private displayAsCsv(sources: SourceListing[]) {
    this.log('source,plugin,package,tier,installed,supported,strategies,record_types,summary');

    for (const s of sources) {
      const csvRow = [
        s.source,
        s.plugin,
        s.package,
        s.tier ?? '',
        s.installed,
        s.supported,
        s.strategies.map(strategy => `${strategy.name}:${strategy.delivery}`).join(';'),
        [...new Set(s.strategies.flatMap(strategy => strategy.recordTypes))].join(';'),
        s.summary,
      ]
        .map(value => `"${String(value ?? '').replaceAll('"', '""')}"`)
        .join(',');

      this.log(csvRow);
    }
  }
}
