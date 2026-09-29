import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { listSources } from '../../plugins/catalog.js';
import { getTheme } from '../../theme.js';

/** What each delivery asks of the person running it. */
const NEEDS = {
  export: 'export, needs --input',
  api: 'live, needs auth',
  local: 'live, reads in place',
  direct: 'delivered by the app',
} as const;

export default class SourcesInfo extends BaseCommand<typeof SourcesInfo> {
  static override description = 'Show a source: its strategies, record types, and how to run it';

  static override examples = ['chronicle sources info shell', 'chronicle sources info things-todo'];

  static override args = {
    source: Args.string({ description: 'Source name (e.g. shell, imessage)', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SourcesInfo);
    const theme = getTheme(this.flags.theme);
    const label = (text: string) => theme.textDim(text.padEnd(11));

    const listing = (await listSources()).find(s => s.source === args.source);

    if (!listing) {
      this.error(
        `No source named "${args.source}". Run "chronicle sources --all" to see what's available.`
      );
    }

    this.log(theme.textBold(args.source) + (listing.summary ? `  ${listing.summary}` : ''));
    this.log('');
    this.log(`  ${label('plugin:')} ${listing.package}`);
    this.log(`  ${label('tier:')} ${listing.tier ?? 'not in catalog'}`);

    const types = [...new Set(listing.strategies.flatMap(strategy => strategy.recordTypes))];
    this.log(
      `  ${label('strategies:')} ` +
        listing.strategies
          .map(
            strategy =>
              `${theme.text(strategy.name)} ${theme.textDim(`(${NEEDS[strategy.delivery]})`)}`
          )
          .join(theme.textDim(' · '))
    );
    this.log(`  ${label('types:')} ${theme.textDim(types.join(', '))}`);
    if (listing.platforms.length > 0) {
      this.log(
        `  ${label('runs on:')} ${listing.platforms.join(', ')}` +
          (listing.supported ? '' : theme.warning(' (not this machine)'))
      );
    }
    if (listing.requires.length > 0) {
      this.log(`  ${label('needs:')} ${listing.requires.join(', ')}`);
    }

    this.log('');
    if (!listing.installed) {
      this.log(theme.textDim('Not installed. Install it with:'));
      this.log(`  ${theme.text(`chronicle plugins install ${listing.plugin}`)}`);
      return;
    }
    this.log(theme.textDim('Run it:'));
    this.log(`  ${theme.text(`chronicle extract ${args.source}`)}  ${theme.textDim('→ stdout')}`);
    // Point at a strategy a bare run would not take.
    const alternate = listing.strategies.find(strategy => !strategy.default);
    if (listing.strategies.length > 1 && alternate) {
      this.log(
        `  ${theme.text(`chronicle extract ${args.source} --strategy ${alternate.name}`)}  ` +
          theme.textDim('→ a different strategy')
      );
    }
  }
}
