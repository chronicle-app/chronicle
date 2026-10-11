import { Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { stdoutWidth, tokens } from '../../output/index.js';
import { listSources, type SourceListing } from '../../plugins/catalog.js';
import { sourcesTable } from '../../utils/sourcesTable.js';

const legacyNote = (count: number) =>
  `Not showing ${count} legacy ${count === 1 ? 'source' : 'sources'} for services that no ` +
  'longer exist. Run `chronicle sources --all` to include them.';

export default class Sources extends BaseCommand<typeof Sources> {
  static override description = 'List the sources and the record types each has';

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
      summary: 'Only this source',
      helpValue: '<name>',
      helpGroup: 'FILTER',
    }),
    delivery: Flags.string({
      summary: 'Only sources that arrive this way',
      options: ['export', 'api', 'local', 'direct'],
      helpGroup: 'FILTER',
    }),
    'record-type': Flags.string({
      summary: 'Only sources with this record type, like messages',
      helpValue: '<type>',
      helpGroup: 'FILTER',
    }),
    format: Flags.string({
      summary: 'How to print the list',
      options: ['table', 'json', 'csv'],
      default: 'table',
      helpGroup: 'OUTPUT',
    }),
  };

  async run(): Promise<void> {
    try {
      const matching = this.applyFilters(await listSources());
      // Legacy sources are for services that no longer exist: listed on request.
      const showLegacy = this.flags.all || Boolean(this.flags.source);
      const sources = showLegacy ? matching : matching.filter(s => s.tier !== 'legacy');
      const hiddenLegacy = matching.length - sources.length;

      if (sources.length === 0 && this.flags.format === 'table') {
        this.logger.info('No sources match');
        if (hiddenLegacy > 0) this.hint(legacyNote(hiddenLegacy));
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
          this.displayAsTable(sources);
          if (hiddenLegacy > 0) this.hint(legacyNote(hiddenLegacy));
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

  private displayAsTable(sources: SourceListing[]) {
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    for (const line of sourcesTable(sources, t, stdoutWidth())) this.log(line);
    // A source that runs here, for an example that works as printed: shell when it's listed.
    const runs = sources.filter(s => s.installed && s.supported);
    const example = runs.find(s => s.source === 'shell') ?? runs[0] ?? sources[0];
    this.hint(
      `Run \`chronicle sources info ${example.source}\` to see a source, or ` +
        `\`chronicle extract ${example.source}\` to extract it.`
    );
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
