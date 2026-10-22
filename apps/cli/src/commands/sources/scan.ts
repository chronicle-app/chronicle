import { Args, Flags } from '@oclif/core';
import { FULL_DISK_ACCESS } from '@chronicle.app/etl';
import { BaseCommand } from '../../baseCommand.js';
import { count, plural, stdoutWidth, table, tokens } from '../../output/index.js';
import { listSources } from '../../plugins/catalog.js';
import { scan, type ScanRow } from '../../plugins/scan.js';
import { PLATFORM_NAMES } from '../../utils/sourcesTable.js';

/** What stands in a row's way, as the table says it, or `ready`. */
export function statusText(row: ScanRow): string {
  if (row.status === 'blocked') return 'needs Full Disk Access';
  if (!row.installed) return 'plugin not installed';
  switch (row.status) {
    case 'ready':
      return 'ready';
    case 'signed-out':
      return 'needs sign-in';
    case 'empty':
      return 'empty';
    default:
      return "can't read";
  }
}

/**
 * How to extract what a table lists: the command for its one row, or for
 * `example`, named, and where the others' commands are.
 */
export function extractHint(rows: ScanRow[], example = rows[0]): string {
  if (rows.length === 1) return `Run \`${example.command}\` to extract it.`;
  const twin = rows.some(row => row !== example && row.source === example.source);
  const what = twin ? `${example.label} from ${example.source}` : example.source;
  return (
    `Run \`${example.command}\` to extract ${what}. ` +
    "Use `--format json` to see the others' commands."
  );
}

export default class SourcesScan extends BaseCommand<typeof SourcesScan> {
  static override description =
    'Find the sources on this computer and whether each is ready to extract';

  static override examples = [
    'chronicle sources scan',
    'chronicle sources scan chrome',
    'chronicle sources scan --format json',
  ];

  static override args = {
    source: Args.string({ description: 'Only this source, like chrome', required: false }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    format: Flags.string({
      summary: 'How to print what was found',
      options: ['table', 'json', 'csv'],
      default: 'table',
      helpGroup: 'OUTPUT',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SourcesScan);
    if (args.source) {
      const listing = (await listSources()).find(s => s.source === args.source);
      if (!listing) {
        this.fail(`No source named "${args.source}"`, {
          hint: "Run `chronicle sources --all` to see what's available.",
        });
      }
      if (!listing.supported) {
        const where = listing.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ');
        this.logger.info(`${args.source} only runs on ${where}`);
        if (this.flags.format === 'json') this.log('[]');
        return;
      }
    }

    const { rows, looked } = await scan({ source: args.source });

    switch (this.flags.format) {
      case 'json':
        this.log(JSON.stringify(rows, null, 2));
        return;
      case 'csv':
        this.log('source,strategy,label,status,installed,command');
        for (const row of rows) {
          this.log(
            [row.source, row.strategy, row.label, row.status, row.installed, row.command]
              .map(value => `"${String(value).replaceAll('"', '""')}"`)
              .join(',')
          );
        }
        return;
    }

    if (rows.length === 0) {
      if (!args.source) {
        this.logger.info('Nothing found on this computer');
        this.hint('Run `chronicle sources` to see every source.');
        return;
      }
      const places = looked.get(args.source) ?? [];
      if (places.length === 0) {
        this.logger.info(`Nothing to scan for ${args.source}`);
      } else {
        this.logger.info(`Nothing found for ${args.source}`);
      }
      this.hint(
        `${places.length > 0 ? `Looked in ${places.join(', ')}. ` : ''}` +
          `Run \`chronicle sources info ${args.source}\` to see how to run it.`
      );
      return;
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const { lines } = table(
      {
        headings: ['source', 'strategy', 'found', 'status'],
        cells: rows.map(row => [row.source, row.strategy, row.label, statusText(row)]),
        muted: [false, false, false, true],
      },
      t,
      stdoutWidth()
    );
    for (const line of lines) this.log(line);
    this.hints(rows, args.source);
  }

  /** The next steps under the table: one per kind of thing in the way. */
  private hints(rows: ScanRow[], source?: string): void {
    const ready = rows.filter(row => row.installed && row.status === 'ready');
    if (ready.length > 0) {
      this.hint(extractHint(ready));
    }
    const blocked = rows.filter(row => row.status === 'blocked');
    if (blocked.length > 0) {
      this.hint(
        `macOS blocked ${count(blocked.length)} ${plural('sources', blocked.length)}. ${FULL_DISK_ACCESS}`
      );
    }
    const missing = [
      ...new Set(rows.filter(row => !row.installed && row.status !== 'blocked').map(r => r.plugin)),
    ];
    if (missing.length === 1) {
      this.hint(`Run \`chronicle plugins install ${missing[0]}\` to add its plugin.`);
    } else if (missing.length > 1) {
      this.hint(
        `${count(missing.length)} plugins aren't installed. ` +
          `Run \`chronicle plugins install ${missing[0]}\` to add the first.`
      );
    }
    const remedies = new Set(
      rows.filter(row => row.installed && row.status !== 'ready' && row.remedy).map(r => r.remedy!)
    );
    for (const remedy of remedies) this.hint(remedy);
  }
}
