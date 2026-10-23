import type { KindSurvey, Measure, Survey } from '@chronicle.app/etl';
import { BaseCommand } from '../baseCommand.js';
import { existsSync } from 'node:fs';
import os from 'node:os';
import {
  LiveRegion,
  bytes,
  card,
  count,
  date,
  glyphs,
  line,
  plural,
  stdoutWidth,
  table,
  tokens,
  type Tokens,
} from '../output/index.js';
import { listSources } from '../plugins/catalog.js';
import type { ExtractorMetadata } from '../plugins/PluginScanner.js';
import {
  fromHome,
  isPathArgument,
  scan,
  scanPath,
  shellWord,
  type PathScanResult,
  type ScanRow,
} from '../plugins/scan.js';
import { rowFor, surveyRow, surveyWith, surveyable } from '../plugins/survey.js';
import { SourceDispatchCommand } from '../utils/SourceDispatchCommand.js';
import { FlagManager } from '../utils/FlagManager.js';
import { ALL_KINDS } from '../utils/recordKinds.js';
import { PLATFORM_NAMES } from '../utils/sourcesTable.js';
import { SURVEY_FLAGS } from '../utils/surveyFlags.js';
import { extractHint } from './scan.js';

/** Longest a survey may take before its source gives up on it. */
const SURVEY_TIMEOUT_MS = 30_000;

/** Where a source's survey is: under way, answered (null when it can't say), or failed. */
type Surveyed =
  | { state: 'pending' }
  | { state: 'done'; survey: Survey | null }
  | { state: 'failed'; error: string };

const years = (dates: (Date | undefined)[]) =>
  dates.filter((d): d is Date => d !== undefined).map(d => d.getFullYear());

/** The years a kind covers, like `2008–2026`, or the year a snapshot is as of. */
export function yearsText(kind: KindSurvey): string {
  const [from] = years([kind.earliest]);
  const [to] = years([kind.latest]);
  if (from !== undefined && to !== undefined) return from === to ? String(from) : `${from}–${to}`;
  const [asOf] = years([kind.asOf]);
  return asOf === undefined ? '' : `as of ${asOf}`;
}

/** A time spent, in the largest whole unit: 45 seconds, 12 minutes, 1,204 hours. */
function spent(seconds: number): string {
  if (seconds >= 3600) return `${count(Math.round(seconds / 3600))} hours`;
  if (seconds >= 60) return `${count(Math.round(seconds / 60))} minutes`;
  return `${count(Math.round(seconds))} seconds`;
}

/** A measure's amount in its unit: `1,514`, `107 GB`, `18 hours`. */
export function measureValue(measure: Measure): string {
  if (measure.unit === 'bytes') return bytes(measure.value);
  if (measure.unit === 'seconds') return spent(measure.value);
  return count(measure.value);
}

/** A measure as a person reads it: `1,514 conversations`, `107 GB of attachments`. */
export function measureText(measure: Measure): string {
  const amount = measureValue(measure);
  return measure.unit ? `${amount} of ${measure.label}` : `${amount} ${measure.label}`;
}

/** Longest a year's bar is: the busiest year's. */
const BAR_WIDTH = 30;

/**
 * A kind's years, a row each from its first to its last: the year, a bar as
 * long against the busiest year's as the records it holds, to an eighth of a
 * character, and its count. A year with none has no bar.
 */
export function yearBars(byMonth: { [month: string]: number }, t: Tokens, width: number): string[] {
  const years = new Map<number, number>();
  for (const [month, n] of Object.entries(byMonth)) {
    const year = Number(month.slice(0, 4));
    years.set(year, (years.get(year) ?? 0) + n);
  }
  if (years.size === 0) return [];
  const rows: [number, number][] = [];
  for (let year = Math.min(...years.keys()); year <= Math.max(...years.keys()); year++) {
    rows.push([year, years.get(year) ?? 0]);
  }
  const top = Math.max(...rows.map(([, n]) => n));
  const digits = Math.max(...rows.map(([, n]) => count(n).length));
  const room = Math.max(1, Math.min(BAR_WIDTH, width - 4 - 2 - 2 - digits));
  const eighths = [...glyphs.eighths];
  return rows.map(([year, n]) => {
    const length = n === 0 ? 0 : Math.max(1, Math.round((n / top) * room * 8));
    const bar = eighths[7].repeat(Math.floor(length / 8)) + (eighths[(length % 8) - 1] ?? '');
    return line(
      [[String(year), t.muted], [`  ${bar.padEnd(room)}  `], [count(n).padStart(digits)]],
      width
    );
  });
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer in ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A list in a sentence: `a`, `a and b`, `a, b, and c`. */
function listed(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/** Flags that say how to print a survey, not what to count. */
const OUTPUT_FLAGS = new Set([...Object.keys(BaseCommand.baseFlags), 'format']);

/**
 * `chronicle survey [source]`: how much a source holds, and over when, read
 * the way a run of it would be but counted rather than extracted. It takes a
 * source's options as `extract` does, through {@link SourceDispatchCommand}.
 */
export default class SurveyCommand extends SourceDispatchCommand<typeof SurveyCommand> {
  static override summary = 'Count what a source holds, and over which years';

  static override description =
    'With no source, counts each source `chronicle scan` finds on this computer. ' +
    'With a source and its options, like the export `--input` it reads, counts that run. ' +
    'With a folder or zip, counts each export `chronicle scan` finds in it. ' +
    "Run `chronicle survey moves-app --help` to see a source's options.";

  static override usage = 'survey [source|path] [type...] [flags]';

  static override examples = [
    'chronicle survey',
    'chronicle survey imessage',
    'chronicle survey moves-app --input ~/moves_export --since 2015-01-01',
    'chronicle survey timing-app calls',
    'chronicle survey ~/Downloads/export.zip',
    'chronicle survey --format json',
  ];

  static override flags = { ...BaseCommand.baseFlags, ...SURVEY_FLAGS };

  // A survey counts everything a run would read, so it takes no limit, and
  // every kind when it names none.
  protected override readonly unoffered = ['limit'];
  protected override readonly defaultKinds = [ALL_KINDS];
  protected override readonly announcesKinds = false;

  // An unknown source only gets "no source named …" or the install offer. A path gets its flags.
  protected override parsesFlagsForNonSource(positional: string): boolean {
    return isPathArgument(positional);
  }

  protected override commonFlags(): Record<string, any> {
    return { ...BaseCommand.baseFlags, ...SURVEY_FLAGS };
  }

  /**
   * No source: everything a scan finds. A path: each export a scan finds in
   * it. A source that isn't installed: the offer to install it.
   */
  protected async handleNonSource(positional: string | undefined): Promise<void> {
    if (positional && isPathArgument(positional)) return this.surveyPath(positional);
    // A folder named bare, which isn't a source, is the folder.
    const folder =
      positional &&
      existsSync(positional) &&
      !(await listSources()).some(s => s.source === positional);
    if (folder) {
      this.fail(`No source named "${positional}"`, {
        hint: `Run \`chronicle survey ./${positional}\` to count what's in the folder.`,
      });
    }
    if (positional) return this.installPrompt(positional);
    const { rows, extractors } = await scan();
    await this.report(rows, extractors, row => surveyRow(row, extractors));
  }

  /**
   * Each export a scan of a folder or zip finds, counted with no time limit:
   * an export has no index to count from, so its survey reads it.
   */
  private async surveyPath(target: string): Promise<void> {
    let found: PathScanResult;
    try {
      found = await scanPath(target);
    } catch (error) {
      this.failFrom(error);
    }
    const { rows, extractors, scanned, folder } = found;
    const where = shellWord(scanned, os.homedir());
    if (rows.length === 0) {
      this.logger.info(
        `Didn't recognize ${folder ? 'anything in ' : ''}${fromHome(scanned, os.homedir())}`
      );
      this.hint(
        folder
          ? `Run \`chronicle scan ${where}\` to see what it holds.`
          : 'Run `chronicle sources --all` to see what Chronicle reads.'
      );
      if (this.flags.format === 'json') this.log('[]');
      return;
    }
    await this.report(rows, extractors, row => surveyRow(row, extractors), undefined, where);
  }

  /**
   * A source: the run its options describe, when it has any, or else what a
   * scan finds of it.
   */
  protected override async runSelected(): Promise<void> {
    const source = this.dispatchedSource!;
    const listing = (await listSources()).find(s => s.source === source)!;
    if (!listing.supported) {
      const where = listing.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ');
      this.logger.info(`${source} only runs on ${where}`);
      if (this.flags.format === 'json') this.log('[]');
      return;
    }

    const options = this.options();
    if (options || this.namedKinds) {
      const { candidates } = this;
      const strategy = this.selectedExtractor.strategy as string;
      const row = await rowFor(listing, strategy, options ?? {}, candidates, this.namedKinds);
      if (!row) {
        this.fail(`Nothing at ${String(options?.input)}`, {
          hint: `Run \`chronicle survey ${source} --help\` to see what it reads.`,
        });
      }
      const extractors = new Map([[source, candidates]]);
      const detailed = () => surveyWith(this.selectedExtractor, row.config, { byMonth: true });
      await this.report([row], extractors, detailed, source);
      return;
    }

    const { rows, extractors } = await scan({ source });
    const exported = listing.strategies.some(strategy => strategy.delivery === 'export');
    if (rows.length === 0 && exported) {
      this.logger.info(`Nothing found for ${source}`);
      this.hint(
        `${source} reads an export you point it at. ` +
          `Run \`chronicle survey ${source} --input <path>\` to count one.`
      );
      if (this.flags.format === 'json') this.log('[]');
      return;
    }
    await this.report(
      rows,
      extractors,
      row => surveyRow(row, extractors, { byMonth: true }),
      source
    );
  }

  /**
   * The source's options given, from the command line or a preset, as the
   * run's config: none when only output flags were, or kinds alone. A
   * strategy alone still names a run.
   */
  private options(): { [option: string]: unknown } | undefined {
    const given = Object.entries(this.flagSources ?? {})
      .filter(([, { source }]) => source === 'explicit' || source === 'preset')
      .map(([name]) => name)
      .filter(name => !OUTPUT_FLAGS.has(name) && name !== 'type');
    if (given.length === 0) return undefined;
    const config = FlagManager.buildExtractorConfig(
      Object.fromEntries(
        given.filter(name => name !== 'strategy').map(name => [name, (this.flags as any)[name]])
      )
    );
    return config;
  }

  /** An export source run without `--input`: what to point it at. */
  protected override missingFlag(flag: string, source: string, verb: string): never {
    const exported = this.candidates.some(c => c.delivery === 'export');
    if (flag !== 'input' || !exported) return super.missingFlag(flag, source, verb);
    this.fail(`${source} reads an export you point it at`, {
      hint: `Run \`chronicle survey ${source} --input <path>\` to count one.`,
    });
  }

  /**
   * Survey the rows that can be, and print what they hold, as a table, JSON
   * or CSV. Rows from a scan of a path, named by `path`, have no time limit.
   */
  private async report(
    rows: ScanRow[],
    extractors: Map<string, ExtractorMetadata[]>,
    survey: (row: ScanRow) => Promise<Survey | null>,
    source?: string,
    path?: string
  ): Promise<void> {
    const targets = rows.filter(row => surveyable(row, extractors));
    // Ready, but read over the network: listed, not counted.
    const online = rows.filter(
      row => row.installed && row.status === 'ready' && !targets.includes(row)
    );
    const surveys = await this.surveyAll(
      targets,
      online,
      survey,
      path ? undefined : SURVEY_TIMEOUT_MS
    );
    const answer = (i: number) => {
      const state = surveys[i];
      return state.state === 'done' ? state.survey : null;
    };
    switch (this.flags.format) {
      case 'json':
        this.log(
          JSON.stringify(
            [
              ...targets.map((row, i) => {
                const state = surveys[i];
                return {
                  ...this.described(row),
                  survey: answer(i),
                  ...(state.state === 'failed' && { error: state.error }),
                };
              }),
              ...online.map(row => ({ ...this.described(row), survey: null, online: true })),
            ],
            null,
            2
          )
        );
        return;
      case 'csv':
        this.log('source,strategy,label,kind,count,earliest,latest');
        for (const [i, row] of targets.entries()) {
          for (const [kind, part] of Object.entries(answer(i) ?? {})) {
            this.log(
              [
                row.source,
                row.strategy,
                row.label,
                kind,
                part.count,
                part.earliest?.toISOString() ?? '',
                part.latest?.toISOString() ?? '',
              ]
                .map(value => `"${String(value).replaceAll('"', '""')}"`)
                .join(',')
            );
          }
        }
        return;
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    // One source gets its details; every source, a row each.
    const summary = source && (await listSources()).find(s => s.source === source)?.summary;
    const lines = source
      ? this.details(targets, surveys, online, t, stdoutWidth(), summary)
      : this.table(targets, surveys, online, t, stdoutWidth());
    if (lines.length > 0) {
      for (const line of lines) this.log(line);
      // A source's details end apart from the hints under them.
      if (source) this.log('');
    } else if (targets.length === 0) {
      this.logger.info(
        source ? `Nothing of ${source}'s to survey` : 'Nothing to survey on this computer'
      );
    } else {
      this.logger.info(`Couldn't count ${source ?? 'any source'}`);
    }
    this.hints(rows, targets, surveys, path ? `chronicle scan ${path}` : undefined, source);
  }

  /**
   * Each place a source was found, and what it holds. A title (the source,
   * and what it is, or which place when there are several), where it was
   * read from, then each record type: its count, its first and last and
   * measures, and its years when it spans more than one.
   */
  private details(
    targets: ScanRow[],
    states: Surveyed[],
    online: ScanRow[],
    t: Tokens,
    width: number,
    summary?: string
  ): string[] {
    const home = os.homedir();
    const places = targets.length + online.length;
    const lines: string[] = [];
    const block = (row: ScanRow, sections: string[][]) => {
      if (lines.length > 0) lines.push('');
      const what = places === 1 ? summary : row.label;
      lines.push(line([[row.source, t.strong], [what ? `  ${what}` : '']], width));
      const { path: file, bytes: size, modifiedAt } = row.evidence;
      const facts = [
        size !== undefined && bytes(size),
        modifiedAt && `changed ${date(new Date(modifiedAt))}`,
      ].filter(Boolean);
      if (file || facts.length > 0) {
        lines.push(
          line(
            [
              [file ? t.code(fromHome(file, home)) : ''],
              [facts.length > 0 ? `${file ? '  ' : ''}${facts.join(' · ')}` : '', t.muted],
            ],
            width
          )
        );
      }
      for (const section of sections) lines.push('', ...section);
    };
    const note = (text: string) => [line([[text, t.muted]], width)];
    for (const [i, row] of targets.entries()) {
      const state = states[i];
      if (state.state === 'failed') block(row, [note(`Couldn't count it: ${state.error}`)]);
      if (state.state !== 'done') continue;
      if (!state.survey) {
        block(row, [note("Can't say how much it holds")]);
        continue;
      }
      const sections = Object.entries(state.survey).map(([kind, part]) => {
        const facts: [string, string][] = [];
        if (part.earliest && part.latest) {
          facts.push(['first', date(part.earliest)], ['last', date(part.latest)]);
        } else if (part.asOf) {
          facts.push(['as of', date(part.asOf)]);
        }
        // A duration is the time the records take; any other measure is named for what it counts.
        for (const measure of part.measures ?? []) {
          facts.push([
            measure.unit === 'seconds' ? 'duration' : measure.label,
            measureValue(measure),
          ]);
        }
        const section = [
          line(
            [[`${count(part.count)} ${plural(part.label ?? kind, part.count)}`, t.strong]],
            width
          ),
          ...card(undefined, facts, t, width - 2).map(fact => `  ${fact}`),
        ];
        const years = yearBars(part.byMonth ?? {}, t, width - 2);
        if (years.length > 1) section.push('', ...years.map(year => `  ${year}`));
        return section;
      });
      block(row, sections);
    }
    for (const row of online) block(row, [note('Online, not counted')]);
    return lines;
  }

  /** A row as JSON names it: where it is, and the command that extracts it. */
  private described(row: ScanRow) {
    const { source, strategy, label, config, command } = row;
    return { source, strategy, label, config, command };
  }

  /**
   * Every target's survey, all started at once, each given up on after
   * `timeout` when there is one. At a terminal the table shows meanwhile on
   * stderr, each source filling in as its survey answers; the finished table
   * then prints on stdout.
   */
  private async surveyAll(
    targets: ScanRow[],
    online: ScanRow[],
    survey: (row: ScanRow) => Promise<Survey | null>,
    timeout?: number
  ): Promise<Surveyed[]> {
    const states: Surveyed[] = targets.map(() => ({ state: 'pending' }));
    const live =
      this.flags.format === 'table' && process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((width, frame) => this.live(targets, states, online, width, frame))
        : undefined;
    live?.start();
    try {
      await Promise.all(
        targets.map(async (row, i) => {
          try {
            const answer = timeout === undefined ? survey(row) : within(survey(row), timeout);
            states[i] = { state: 'done', survey: await answer };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            states[i] = { state: 'failed', error: message };
            this.logger.debug(`Couldn't count ${row.source} (${row.label})`, { error: message });
          }
          live?.redraw();
        })
      );
    } finally {
      live?.stop();
    }
    return states;
  }

  /** The table while surveys run, or a line counting them when it's taller than the terminal. */
  private live(
    targets: ScanRow[],
    states: Surveyed[],
    online: ScanRow[],
    width: number,
    frame: number
  ): string[] {
    const t = tokens({ stream: 'stderr', theme: this.flags.theme });
    const lines = this.table(targets, states, online, t, width, frame);
    if (lines.length < (process.stderr.rows || 24)) return lines;
    const answered = states.filter(state => state.state !== 'pending').length;
    const spinner = glyphs.spinner[frame % glyphs.spinner.length];
    return [`${t.accent(spinner)} Counting ${count(answered)}/${count(states.length)} sources`];
  }

  /**
   * A row per record type of each source surveyed, the source named on its
   * first; one with a spinner for a survey under way; then those online.
   * Sources that can't say are left out, for the hints to name.
   */
  private table(
    targets: ScanRow[],
    states: Surveyed[],
    online: ScanRow[],
    t: Tokens,
    width: number,
    frame = 0
  ): string[] {
    const spinner = glyphs.spinner[frame % glyphs.spinner.length];
    const cells: string[][] = [];
    for (const [i, row] of targets.entries()) {
      const state = states[i];
      if (state.state === 'pending') {
        cells.push([row.source, row.label, spinner, '', '']);
        continue;
      }
      if (state.state !== 'done' || !state.survey) continue;
      for (const [k, [kind, part]] of Object.entries(state.survey).entries()) {
        cells.push([
          k === 0 ? row.source : '',
          k === 0 ? row.label : '',
          `${count(part.count)} ${plural(part.label ?? kind, part.count)}`,
          yearsText(part),
          (part.measures ?? []).map(measure => measureText(measure)).join(' · '),
        ]);
      }
    }
    for (const row of online) cells.push([row.source, row.label, '', '', 'online, not counted']);
    if (cells.length === 0) return [];
    return table(
      {
        headings: ['source', 'found', 'records', 'years', 'more'],
        cells,
        numeric: [false, false, true, false, false],
        muted: [false, false, false, true, true],
      },
      t,
      width
    ).lines;
  }

  /**
   * What to do next, and which sources the table leaves out and why:
   * `found` is the command that found the rows, when it wasn't a scan of the
   * computer.
   */
  private hints(
    rows: ScanRow[],
    targets: ScanRow[],
    states: Surveyed[],
    found?: string,
    source?: string
  ): void {
    const counted = targets.filter((_, i) => {
      const state = states[i];
      return state.state === 'done' && state.survey;
    });
    if (counted.length > 0) {
      // The example is the source with the most to extract.
      const records = (row: ScanRow) => {
        const state = states[targets.indexOf(row)];
        const survey = state.state === 'done' ? state.survey : null;
        return Object.values(survey ?? {}).reduce((n, kind) => n + kind.count, 0);
      };
      const most = counted.reduce((a, b) => (records(b) > records(a) ? b : a));
      this.hint(extractHint(counted, most));
    }
    const silent = [
      ...new Set(
        targets
          .filter((row, i) => states[i].state === 'done' && !counted.includes(row))
          .map(row => row.source)
      ),
    ];
    if (silent.length > 0) {
      this.hint(
        `${listed(silent)} can't say how much ${silent.length === 1 ? 'it holds' : 'they hold'}.`
      );
    }
    const failed = states.filter(state => state.state === 'failed').length;
    if (failed > 0) {
      this.hint(
        `Couldn't count ${count(failed)} ${plural('sources', failed)}. Use \`--verbose\` to see why.`
      );
    }
    const waiting = rows.filter(row => !row.installed || row.status !== 'ready').length;
    if (waiting > 0) {
      const why = found ?? ['chronicle scan', source].filter(Boolean).join(' ');
      this.hint(
        `${count(waiting)} ${plural('sources', waiting)} found ${waiting === 1 ? "isn't" : "aren't"} ready. ` +
          `Run \`${why}\` to see why.`
      );
    }
  }
}
