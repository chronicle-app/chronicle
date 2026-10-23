import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Args, Flags } from '@oclif/core';
import { FULL_DISK_ACCESS } from '@chronicle.app/etl';
import { BaseCommand } from '../baseCommand.js';
import { LiveRegion, count, glyphs, plural, stdoutWidth, table, tokens } from '../output/index.js';
import { listSources } from '../plugins/catalog.js';
import {
  fromHome,
  isPathArgument,
  scan,
  scanPath,
  shellWord,
  type PathScanResult,
  type ScanRow,
} from '../plugins/scan.js';
import { PLATFORM_NAMES } from '../utils/sourcesTable.js';

/** What stands in a row's way, as the table says it, or `ready`. */
export function statusText(row: ScanRow): string {
  if (row.status === 'blocked') return 'needs Full Disk Access';
  // Installing its plugin wouldn't help.
  if (row.status === 'unsupported') return 'layout not supported';
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

/** Up to five names in a sentence, and how many more: `a/, b.zip, and 3 more`. */
function named(names: string[]): string {
  const shown = names.slice(0, names.length > 5 ? 4 : 5);
  const more = names.length - shown.length;
  const all = more > 0 ? [...shown, `${count(more)} more`] : shown;
  if (all.length <= 2) return all.join(' and ');
  return `${all.slice(0, -1).join(', ')}, and ${all.at(-1)}`;
}

/** Folders and zips, counted the way a sentence says them: `2 folders and 1 zip`. */
function foldersAndZips(names: string[]): string {
  const zips = names.filter(name => name.toLowerCase().endsWith('.zip')).length;
  const folders = names.length - zips;
  return [
    folders > 0 && `${count(folders)} ${plural('folders', folders)}`,
    zips > 0 && `${count(zips)} ${plural('zips', zips)}`,
  ]
    .filter(Boolean)
    .join(' and ');
}

export default class Scan extends BaseCommand<typeof Scan> {
  static override summary = 'Find the sources on this computer, or the exports in a folder or zip';

  static override description =
    'With no argument, looks where each source keeps its files on this computer. ' +
    'With a source, looks only for that one. With a folder or zip, looks through it ' +
    "for each export inside, by what each source's exports look like, and reads none of them. " +
    'With a file or folder in an export, finds that export.';

  static override examples = [
    'chronicle scan',
    'chronicle scan chrome',
    'chronicle scan ~/Downloads/takeout-20250101T000000Z-001.zip',
    'chronicle scan ~/EXPORT_FILES --format json',
    'chronicle scan ~/Downloads/apple_health_export/export.xml',
  ];

  static override args = {
    target: Args.string({
      description: 'A source, like chrome, or a folder or zip to look in',
      required: false,
    }),
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
    const { args } = await this.parse(Scan);
    const source = args.target;
    if (source && isPathArgument(source)) return this.scanPath(source);
    if (source) {
      const listing = (await listSources()).find(s => s.source === source);
      if (!listing) {
        this.fail(`No source named "${source}"`, {
          hint: existsSync(source)
            ? `Run \`chronicle scan ./${source}\` to look in the folder.`
            : "Run `chronicle sources --all` to see what's available.",
        });
      }
      if (!listing.supported) {
        const where = listing.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ');
        this.logger.info(`${source} only runs on ${where}`);
        if (this.flags.format === 'json') this.log('[]');
        return;
      }
    }

    const { rows, looked } = await scan({ source });
    if (this.printed(rows)) return;

    if (rows.length === 0) {
      if (!source) {
        this.logger.info('Nothing found on this computer');
        this.hint('Run `chronicle sources` to see every source.');
        return;
      }
      const places = looked.get(source) ?? [];
      const listing = (await listSources()).find(s => s.source === source)!;
      if (places.length === 0 && listing.strategies.some(s => s.delivery === 'export')) {
        this.logger.info(`${source} reads an export`);
        this.hint('Run `chronicle scan <path>` to find one in a folder or zip.');
        return;
      }
      if (places.length === 0) {
        this.logger.info(`Nothing to scan for ${source}`);
      } else {
        this.logger.info(`Nothing found for ${source}`);
      }
      this.hint(
        `${places.length > 0 ? `Looked in ${places.join(', ')}. ` : ''}` +
          `Run \`chronicle sources info ${source}\` to see how to run it.`
      );
      return;
    }

    this.table(rows);
    this.hints(rows, ['chronicle survey', source].filter(Boolean).join(' '));
  }

  /**
   * The exports in a folder or zip. At a terminal, a count of the folders
   * looked in shows meanwhile on stderr.
   */
  private async scanPath(target: string): Promise<void> {
    let looked = 0;
    const live =
      this.flags.format === 'table' && process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((_width, frame) => {
            const t = tokens({ stream: 'stderr', theme: this.flags.theme });
            const spinner = glyphs.spinner[frame % glyphs.spinner.length];
            return [`${t.accent(spinner)} Looked in ${count(looked)} ${plural('folders', looked)}`];
          })
        : undefined;
    live?.start();
    let found: PathScanResult;
    try {
      found = await scanPath(target, {
        onFolder(n) {
          looked = n;
        },
      });
    } catch (error) {
      live?.stop();
      this.failFrom(error);
    }
    live?.stop();

    const { rows, scanned, folder, unrecognized } = found;
    if (this.printed(rows)) return;
    const home = os.homedir();
    if (rows.length === 0) {
      this.logger.info(
        `Didn't recognize ${folder ? 'anything in ' : ''}${fromHome(scanned, home)}`
      );
      this.hint('Run `chronicle sources --all` to see what Chronicle reads.');
    } else {
      this.table(rows);
      if (unrecognized.length > 0) {
        const names = [...unrecognized].sort((a, b) => a.localeCompare(b));
        this.hint(`Didn't recognize ${foldersAndZips(names)}: ${named(names)}.`);
      }
    }
    this.refusals(found);
    if (rows.length === 0) return;
    // A file or folder in an export is surveyed as the export.
    const whole = rows.find(row => scanned.startsWith(`${row.root}${path.sep}`))?.root;
    this.hints(rows, `chronicle survey ${shellWord(whole ?? scanned, home)}`);
    const unsupported = rows.filter(row => row.status === 'unsupported').length;
    if (unsupported > 0) {
      this.hint(
        `${count(unsupported)} ${plural('exports', unsupported)} ${unsupported === 1 ? 'is' : 'are'} ` +
          "in a layout Chronicle recognizes but can't read yet."
      );
    }
  }

  /** The rows as JSON or CSV, when the format asks for one: whether it did. */
  private printed(rows: ScanRow[]): boolean {
    switch (this.flags.format) {
      case 'json':
        this.log(JSON.stringify(rows, null, 2));
        return true;
      case 'csv':
        this.log('source,strategy,label,status,installed,command');
        for (const row of rows) {
          this.log(
            [row.source, row.strategy, row.label, row.status, row.installed, row.command]
              .map(value => `"${String(value).replaceAll('"', '""')}"`)
              .join(',')
          );
        }
        return true;
      default:
        return false;
    }
  }

  private table(rows: ScanRow[]): void {
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
  }

  /** The folders and zips a path scan couldn't look in, by why. */
  private refusals({ refused, scanned }: PathScanResult): void {
    const names = (codes: string[]) =>
      named(
        refused
          .filter(r => codes.includes(r.code))
          .map(r => path.relative(scanned, r.path) || path.basename(r.path))
      );
    const blocked = process.platform === 'darwin' ? refused.filter(r => r.code === 'EPERM') : [];
    if (blocked.length > 0) {
      this.hint(
        `macOS blocked ${count(blocked.length)} ${plural('folders', blocked.length)}: ` +
          `${names(['EPERM'])}. ${FULL_DISK_ACCESS}`
      );
    }
    const closed = refused.filter(r => r.code !== 'EZIP' && !blocked.includes(r));
    if (closed.length > 0) {
      const codes = [...new Set(closed.map(r => r.code))];
      this.hint(
        `Couldn't look in ${count(closed.length)} ${plural('folders', closed.length)}: ${names(codes)}.`
      );
    }
    const zips = refused.filter(r => r.code === 'EZIP');
    if (zips.length > 0) {
      this.hint(
        `Couldn't open ${count(zips.length)} ${plural('zips', zips.length)}: ${names(['EZIP'])}. ` +
          'Check that each download finished.'
      );
    }
  }

  /** The next steps under the table: one per kind of thing in the way. */
  private hints(rows: ScanRow[], survey: string): void {
    const ready = rows.filter(row => row.installed && row.status === 'ready');
    if (ready.length > 0) {
      this.hint(`Run \`${survey}\` to see how much ${ready.length === 1 ? 'it' : 'each'} holds.`);
      this.hint(extractHint(ready));
    }
    const blocked = rows.filter(row => row.status === 'blocked');
    if (blocked.length > 0) {
      this.hint(
        `macOS blocked ${count(blocked.length)} ${plural('sources', blocked.length)}. ${FULL_DISK_ACCESS}`
      );
    }
    const missing = [
      ...new Set(
        rows
          .filter(row => !row.installed && row.status !== 'blocked' && row.status !== 'unsupported')
          .map(r => r.plugin)
      ),
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
