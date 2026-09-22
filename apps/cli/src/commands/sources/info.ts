import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { PluginScanner, strategiesOf } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';

/** What each delivery asks of the person running it. */
const NEEDS = {
  export: 'export, needs --input',
  api: 'live, needs auth',
  local: 'live, reads in place',
  direct: 'delivered by the app',
} as const;

export default class SourcesInfo extends BaseCommand<typeof SourcesInfo> {
  static override description = 'Show a source: its extractors, record types, and how to run it';

  static override examples = ['chronicle sources info shell', 'chronicle sources info things-todo'];

  static override args = {
    source: Args.string({ description: 'Source name (e.g. shell, imessage)', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SourcesInfo);
    const theme = getTheme(this.flags.theme);

    const bySource = await PluginScanner.scanAllPlugins();
    const extractors = bySource.get(args.source) || [];

    if (extractors.length === 0) {
      this.error(
        `No source named "${args.source}". Run "chronicle sources" to see what's available.`
      );
    }

    const strategies = strategiesOf(extractors);
    const types = [...new Set(extractors.flatMap(e => e.recordType))];

    this.log(theme.textBold(args.source));
    this.log('');
    this.log(
      `  ${theme.textDim('ways in:')} ` +
        strategies
          .map(s => `${theme.text(s.name)} ${theme.textDim(`(${NEEDS[s.delivery]})`)}`)
          .join(theme.textDim(' · '))
    );
    this.log(`  ${theme.textDim('types:  ')} ${theme.textDim(types.join(', '))}`);

    this.log('');
    this.log(theme.textDim('Run it:'));
    this.log(`  ${theme.text(`chronicle extract ${args.source}`)}  ${theme.textDim('→ stdout')}`);
    // Point at a way in a bare run would not take.
    const alternate = strategies.find(s => !s.extractors.some(e => e.default));
    if (strategies.length > 1 && alternate) {
      this.log(
        `  ${theme.text(`chronicle extract ${args.source} --via ${alternate.name}`)}  ` +
          theme.textDim('→ a different way in')
      );
    }
  }
}
