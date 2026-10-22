import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { DELIVERY } from '../../help/render.js';
import { card, definitions, heading, line, stdoutWidth, tokens } from '../../output/index.js';
import { listSources } from '../../plugins/catalog.js';
import { PLATFORM_NAMES } from '../../utils/sourcesTable.js';

export default class SourcesInfo extends BaseCommand<typeof SourcesInfo> {
  static override description = "Show a source's strategies and record types, and how to run it";

  static override examples = ['chronicle sources info shell', 'chronicle sources info things-todo'];

  static override args = {
    source: Args.string({ description: 'A source, like shell or imessage', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SourcesInfo);
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const width = stdoutWidth();

    const listing = (await listSources()).find(s => s.source === args.source);

    if (!listing) {
      this.fail(`No source named "${args.source}"`, {
        hint: "Run `chronicle sources --all` to see what's available.",
      });
    }

    const types = [...new Set(listing.strategies.flatMap(strategy => strategy.recordTypes))];
    const runsOn = listing.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ');
    // Full Disk Access is macOS's to grant; elsewhere it asks nothing.
    const needs = listing.requires.filter(
      need => need !== 'full-disk-access' || process.platform === 'darwin'
    );
    this.log(
      line([[args.source, t.strong], [listing.summary ? `  ${listing.summary}` : '']], width)
    );
    this.log('');
    for (const entry of card(
      undefined,
      [
        ['plugin', listing.installed ? listing.package : `${listing.package}, not installed`],
        ['tier', listing.tier ?? 'not in catalog'],
        ['types', types.join(', ')],
        ...(runsOn
          ? [
              ['runs on', listing.supported ? runsOn : `${runsOn}, not this computer`] as [
                string,
                string,
              ],
            ]
          : []),
        ...(needs.length > 0 ? [['needs', needs.join(', ')] as [string, string]] : []),
      ],
      t,
      width,
      { wrap: true }
    )) {
      this.log(entry);
    }
    this.log('');
    this.log(heading('Strategies', t, width));
    for (const entry of definitions(
      listing.strategies.map(strategy => ({
        term: [[strategy.name, t.command]],
        text: `${DELIVERY[strategy.delivery] ?? strategy.delivery}.${strategy.default ? ' The default.' : ''}`,
      })),
      t,
      width
    )) {
      this.log(entry);
    }

    if (!listing.installed) {
      this.hint(`Run \`chronicle plugins install ${listing.plugin}\` to install it.`);
      return;
    }
    // Point at a strategy a bare run would not take.
    const alternate = listing.strategies.find(strategy => !strategy.default);
    this.hint(
      listing.strategies.length > 1 && alternate
        ? `Run \`chronicle extract ${args.source}\` to extract it, or ` +
            `\`chronicle extract ${args.source} --strategy ${alternate.name}\` for ${alternate.name}.`
        : `Run \`chronicle extract ${args.source}\` to extract it.`
    );
  }
}
