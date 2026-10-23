import type { KindSurvey, Measure, Survey } from '@chronicle.app/etl';
import { Args } from '@oclif/core';
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
import { blockerHints, extractHint, statusText } from './scan.js';

/** Longest a survey may take before its source gives up on it. */
const SURVEY_TIMEOUT_MS = 30_000;

/** Where a source's survey is: under way, answered (null when it can't say), or failed. */
type Surveyed =
  | { state: 'pending' }
  | { state: 'done'; survey: Survey | null }
  | { state: 'failed'; error: string };

/** The rows a scan found, by what a survey does with each. */
interface Found {
  /** Counted. */
  targets: ScanRow[];
  /** Ready, but read over the network: listed, not counted. */
  online: ScanRow[];
  /** Not ready: listed with what's in the way. */
  waiting: ScanRow[];
}

/** A status as a sentence starts it: `Needs Full Disk Access`. */
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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

/**
 * A measure as a person reads it beside its records: `1,514 conversations`,
 * `107 GB of attachments`, or for the time they take, just `18 hours`.
 */
export function measureText(measure: Measure): string {
  const amount = measureValue(measure);
  if (measure.unit === 'seconds') return amount;
  return measure.unit ? `${amount} of ${measure.label}` : `${amount} ${measure.label}`;
}

/** What a kind's records are, as extract's summary says them: `app activities`. */
const recordsText = (kind: string, part: KindSurvey) =>
  `${count(part.count)} ${plural(part.label ?? kind.replaceAll('-', ' '), part.count)}`;

/** How many records a survey counted, of every kind. */
const total = (survey: Survey | null) =>
  Object.values(survey ?? {}).reduce((n, kind) => n + kind.count, 0);

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

/** Flags that say how to print a survey, not what to count. */
const OUTPUT_FLAGS = new Set([...Object.keys(BaseCommand.baseFlags), 'format']);

/**
 * `chronicle survey [source]`: how much a source holds, and over when, read
 * the way a run of it would be but counted rather than extracted. It takes a
 * source's options as `extract` does, through {@link SourceDispatchCommand}.
 */
export default class SurveyCommand extends SourceDispatchCommand<typeof SurveyCommand> {
  static override summary = 'Count what each source holds and when, before you extract it';

  static override description =
    'With no source, counts each source `chronicle scan` finds on this computer. ' +
    'With a source and its options, like the export `--input` it reads, counts that run. ' +
    'With a folder or zip, counts each export `chronicle scan` finds in it. ' +
    "Run `chronicle survey moves-app --help` to see a source's options.";

  static override usage = 'survey [source|path] [type...] [flags]';

  // For help only: the dispatcher parses its own.
  static override args = {
    source: Args.string({
      description: 'A source, like shell, or a folder or zip of exports',
      required: false,
    }),
    type: Args.string({ description: 'Record types to count, like calls', required: false }),
  };

  /** How help names each argument. */
  static argTerms = { source: '<source|path>', type: '[type...]' };

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
    // Not ready: listed with what's in the way.
    const waiting = rows.filter(row => !targets.includes(row) && !online.includes(row));
    const started = Date.now();
    const surveys = await this.surveyAll(
      { targets, online, waiting },
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
              ...waiting.map(row => ({ ...this.described(row), survey: null })),
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
    const found = { targets, online, waiting };
    const lines = source
      ? this.details(found, surveys, t, stdoutWidth(), summary)
      : this.table(found, surveys, t, stdoutWidth());
    if (lines.length > 0) {
      for (const line of lines) this.log(line);
      // A source's details end apart from the hints under them.
      if (source) this.log('');
      else this.counted(targets, surveys, Date.now() - started, path !== undefined);
    } else {
      this.logger.info(
        source ? `Nothing of ${source}'s to survey` : 'Nothing to survey on this computer'
      );
    }
    this.hints(rows, { targets, online, waiting }, surveys);
  }

  /** The table's outcome: how many sources, or exports, were counted, and their records. */
  private counted(targets: ScanRow[], states: Surveyed[], durationMs: number, exports: boolean) {
    const answered = targets.filter((_, i) => {
      const state = states[i];
      return state.state === 'done' && state.survey;
    });
    if (answered.length === 0) return;
    const n = exports ? answered.length : new Set(answered.map(row => row.source)).size;
    const title = `Counted ${count(n)} ${plural(exports ? 'exports' : 'sources', n)}`;
    const records = answered.reduce(
      (sum, row) => sum + total(this.surveyOf(row, targets, states)),
      0
    );
    this.logger.emit({
      level: 'info',
      kind: 'summary',
      message: `${title}: ${count(records)} ${plural('records', records)}`,
      fields: { title, counts: records > 0 ? { records } : {}, records, durationMs },
    });
  }

  /** A target's survey, once it answered. */
  private surveyOf(row: ScanRow, targets: ScanRow[], states: Surveyed[]): Survey | null {
    const state = states[targets.indexOf(row)];
    return state?.state === 'done' ? state.survey : null;
  }

  /**
   * Each place a source was found, and what it holds. A title (the source,
   * and what it is, or which place when there are several), where it was
   * read from, then each record type: its count, its first and last and
   * measures, and its years when it spans more than one. A place that isn't
   * ready says what's in its way.
   */
  private details(
    { targets, online, waiting }: Found,
    states: Surveyed[],
    t: Tokens,
    width: number,
    summary?: string
  ): string[] {
    const home = os.homedir();
    const places = targets.length + online.length + waiting.length;
    const lines: string[] = [];
    const block = (row: ScanRow, sections: string[][]) => {
      if (lines.length > 0) lines.push('');
      const what = places === 1 ? summary : row.label;
      const { path: file, bytes: size, modifiedAt } = row.evidence;
      const facts = [
        size !== undefined && bytes(size),
        modifiedAt && `changed ${date(new Date(modifiedAt))}`,
      ]
        .filter(Boolean)
        .join(' · ');
      // A title that names the file takes its facts. Otherwise the file, or
      // the place when the title doesn't say it (an account), goes under it.
      const where = file && fromHome(file, home);
      const titled = Boolean(where) && what === where;
      lines.push(
        line(
          [
            [row.source, t.strong],
            [what ? `  ${what}` : ''],
            [titled && facts ? `  ${facts}` : '', t.muted],
          ],
          width
        )
      );
      const place = where ? t.code(where) : what === row.label ? '' : row.label;
      if (!titled && (place || facts)) {
        lines.push(line([[place], [facts ? `${place ? '  ' : ''}${facts}` : '', t.muted]], width));
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
          line([[recordsText(kind, part), t.strong]], width),
          ...card(undefined, facts, t, width - 2).map(fact => `  ${fact}`),
        ];
        const years = yearBars(part.byMonth ?? {}, t, width - 2);
        if (years.length > 1) section.push('', ...years.map(year => `  ${year}`));
        return section;
      });
      block(row, sections);
    }
    for (const row of online) {
      block(row, [
        note(
          `Not counted, since ${row.source} is read online and counting it means downloading it.`
        ),
      ]);
    }
    for (const row of waiting) block(row, [note(capitalized(statusText(row)))]);
    return lines;
  }

  /** A row as JSON names it: where it is, the command that extracts it, and its status in a scan. */
  private described(row: ScanRow) {
    const { source, strategy, label, config, command, status } = row;
    return { source, strategy, label, config, command, status };
  }

  /**
   * Every target's survey, all started at once, each given up on after
   * `timeout` when there is one. At a terminal the table shows meanwhile on
   * stderr, each source filling in as its survey answers; the finished table
   * then prints on stdout.
   */
  private async surveyAll(
    found: Found,
    survey: (row: ScanRow) => Promise<Survey | null>,
    timeout?: number
  ): Promise<Surveyed[]> {
    const { targets } = found;
    const states: Surveyed[] = targets.map(() => ({ state: 'pending' }));
    const live =
      this.flags.format === 'table' && process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((width, frame) => this.live(found, states, width, frame))
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
  private live(found: Found, states: Surveyed[], width: number, frame: number): string[] {
    const t = tokens({ stream: 'stderr', theme: this.flags.theme });
    const lines = this.table(found, states, t, width, frame);
    if (lines.length < (process.stderr.rows || 24)) return lines;
    const answered = states.filter(state => state.state !== 'pending').length;
    const spinner = glyphs.spinner[frame % glyphs.spinner.length];
    return [`${t.accent(spinner)} Counting ${count(answered)}/${count(states.length)} sources`];
  }

  /**
   * A row per record type of each source surveyed, the source and where its
   * records come from on its first; one with a spinner for a survey under
   * way, and one that says `empty` for a place with no records. Then those
   * online, and those not ready, with what's in their way. A source that
   * can't say how much it holds is left out.
   */
  private table(
    { targets, online, waiting }: Found,
    states: Surveyed[],
    t: Tokens,
    width: number,
    frame = 0
  ): string[] {
    const spinner = glyphs.spinner[frame % glyphs.spinner.length];
    const cells: string[][] = [];
    const say = (row: ScanRow, text: string) => {
      cells.push([row.source, text, '', '', row.label]);
    };
    for (const [i, row] of targets.entries()) {
      const state = states[i];
      if (state.state === 'pending') say(row, spinner);
      else if (state.state === 'failed') say(row, "couldn't count");
      else if (state.survey) {
        // The kinds it has none of are left out, and a place with none at all says so.
        const kinds = Object.entries(state.survey).filter(([, part]) => part.count > 0);
        if (kinds.length === 0) say(row, 'empty');
        for (const [k, [kind, part]] of kinds.entries()) {
          cells.push([
            k === 0 ? row.source : '',
            recordsText(kind, part),
            yearsText(part),
            (part.measures ?? []).map(measure => measureText(measure)).join(' · '),
            k === 0 ? row.label : '',
          ]);
        }
      }
    }
    for (const row of online) say(row, 'online, not counted');
    for (const row of waiting) say(row, statusText(row));
    if (cells.length === 0) return [];
    return table(
      {
        headings: ['source', 'records', 'years', 'details', 'from'],
        cells,
        numeric: [false, true, false, false, false],
        muted: [false, false, true, true, true],
        paths: [false, false, false, false, true],
      },
      t,
      width
    ).lines;
  }

  /**
   * What to do next: extract what has records, or is online, see why one
   * failed, or clear what's in the way.
   */
  private hints(rows: ScanRow[], { targets, online }: Found, states: Surveyed[]): void {
    const records = (row: ScanRow) => total(this.surveyOf(row, targets, states));
    const counted = targets.filter(row => records(row) > 0);
    if (counted.length > 0 || online.length > 0) {
      // The example is the source with the most to extract.
      const most =
        counted.length > 0 && counted.reduce((a, b) => (records(b) > records(a) ? b : a));
      this.hint(extractHint([...counted, ...online], most || online[0]));
    }
    const failed = states.filter(state => state.state === 'failed').length;
    if (failed > 0) {
      this.hint(
        `Couldn't count ${count(failed)} ${plural('sources', failed)}. Use \`--verbose\` to see why.`
      );
    }
    for (const hint of blockerHints(rows)) this.hint(hint);
  }
}
