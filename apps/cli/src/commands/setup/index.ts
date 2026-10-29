import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Args, Errors, Flags } from '@oclif/core';
import { CredentialManager } from '@chronicle.app/auth';
import { FULL_DISK_ACCESS } from '@chronicle.app/etl';
import { BaseCommand } from '../../baseCommand.js';
import { ConfigManager, type Config } from '../../config/index.js';
import {
  LiveRegion,
  canAsk,
  count,
  date,
  glyphs,
  line,
  SPLASH_STYLES,
  Splash,
  type Intro,
  type SplashStyleName,
  plural,
  stdoutWidth,
  table,
  tokens,
  truncatePath,
  type Tokens,
} from '../../output/index.js';
import type { SelectOption } from '../../output/prompts.js';
import { listSources, type ManifestStrategy, type SourceListing } from '../../plugins/catalog.js';
import { PluginScanner, type ExtractorMetadata } from '../../plugins/PluginScanner.js';
import { commandFor, fromHome, scan, scanPath, type ScanRow } from '../../plugins/scan.js';
import { splitArgs } from '../../setup/args.js';
import { finishedLines, foundLines, liveLines } from '../../setup/display.js';
import {
  JobRunner,
  finishedFile,
  targetFile,
  type ChildEvent,
  type Job,
} from '../../setup/jobs.js';
import { Counter } from '../../setup/counter.js';
import { Steps } from '../../setup/steps.js';
import {
  checkTarget,
  commandLine,
  kindsFor,
  providerFor,
  reads,
  stateText,
  targetArgs,
  targetFor,
  targetKey,
  targetLabel,
  targetName,
  type Checked,
  type Target,
} from '../../setup/targets.js';
import {
  SIGN_IN_PORT,
  action,
  exportSteps,
  gets,
  order,
  stepText,
  todosFor,
  type Need,
  type Todo,
  type Way,
} from '../../setup/todo.js';
import { INTRO, resumed } from '../../setup/intro.js';
import { allKinds } from '../../utils/recordKinds.js';
import { closest } from '../../utils/closest.js';
import { PLATFORM_NAMES } from '../../utils/sourcesTable.js';
import { blockerHints, statusText } from '../scan.js';
import { within } from '../survey.js';
import { terminal } from './full-disk-access.js';

/** Longest a survey may take before its count is left out. */
const SURVEY_TIMEOUT_MS = 30_000;

/** How often a question with something running above it is drawn again. */
const TICK_MS = 250;

/** Local midnight a year ago: where what setup extracts starts. */
function yearAgo(now = new Date()): Date {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - 1);
  since.setHours(0, 0, 0, 0);
  return since;
}

const unique = <T>(items: T[]) => [...new Set(items)];

const cancelled = () =>
  Object.assign(new Error('Setup cancelled'), { exitCode: 130, oclif: { exit: 130 } });

/** Something a picker offers: what a scan found, or an account, as a row. */
interface Offer {
  row: ScanRow;
  /** What it is, beside its source's name. */
  label: string;
  /** Its state, muted after it: drawn each time, so a count can fill in. */
  note: () => string;
  /** Ticked to start with: wanted before, or picked when the add step went back to it. */
  checked: boolean;
}

/** The add step as it was left: what was ticked, what folders turned up and where, and what the last said. */
interface Adding {
  initial: string[];
  found: Offer[];
  foundIn: Map<Offer, string>;
  searched: string;
}

/** A way a source named alone can come in: its strategy, and what's here of it, if anything. */
interface WayIn {
  strategy: ManifestStrategy & { name: string };
  row?: ScanRow;
  /** The folder its export was found in, to look in again next time. */
  folder?: string;
}

/** How each kind of strategy comes in, as a person would say it. */
const HOW: Record<string, string> = {
  api: 'sign in',
  export: 'export',
  local: 'on this mac',
  direct: 'on this mac',
};

/** How a way comes in, in words: `sign in`, or `export · takeout` when another is an export too. */
function how(way: WayIn, ways: WayIn[]): string {
  const words = HOW[way.strategy.delivery] ?? way.strategy.delivery;
  const alike = ways.filter(w => w.strategy.delivery === way.strategy.delivery).length > 1;
  return alike ? `${words} · ${way.strategy.name}` : words;
}

/** The scan statuses a picker offers: what's ready, or a step away. */
const OFFERED = new Set(['ready', 'blocked', 'signed-out']);

/** What a row reads, to tell whether a folder looked in twice found it again. */
const rowKey = (row: ScanRow) => targetKey(targetFor(row, []));

/** The value of a picker's row that looks in another folder. */
const ANOTHER = '';

/** Whether a source and strategy are the same as a way's. */
const same = (way: Way, source: string, strategy: unknown) =>
  way.source === source && way.strategy === strategy;

/**
 * `chronicle setup [folder…]`: scan this computer and the folders of
 * exports, pick what to extract, add services that need a sign-in or an
 * export, then extract the last year of each to a JSON Lines file while
 * the sign-ins and exports are offered one at a time, each to do now or
 * later. A checklist of the four steps stays above it all. Only the picks
 * are saved. Each run works out again what stands in each one's way, and a
 * pick with a finished file is skipped.
 *
 * `chronicle setup <source>` is that source alone, without the steps: how
 * it can come in, one way picked, then that way's steps, if any, until
 * it's ready for `chronicle extract`.
 */
export default class Setup extends BaseCommand<typeof Setup> {
  static override hidden = true;

  static override summary = 'Pick your sources and extract them';

  static override description =
    'Scans this computer and any folders you name, asks which to extract and which services ' +
    'to add, extracts each to a JSON Lines file, and meanwhile walks through what is left, ' +
    'like a sign-in or an export to ask for, now or later. Run it again to carry on. ' +
    'Name a source to get only that one ready to extract: how it can come in, then that way, ' +
    'by --strategy or asked, and the `chronicle extract` command for it.';

  static override examples = [
    'chronicle setup',
    'chronicle setup spotify',
    'chronicle setup gmail --strategy takeout',
    'chronicle setup ~/Downloads/takeout',
    'chronicle setup --yes',
  ];

  static override strict = false;

  static override args = {
    source: Args.string({
      description:
        'A source to set up alone, like spotify, or a folder or zip of exports to look in',
      required: false,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    yes: Flags.boolean({
      char: 'y',
      summary: 'Pick what is ready without asking, and skip anything that needs a step',
    }),
    output: Flags.string({
      char: 'o',
      summary: 'The folder for the files. The default is the extracts folder in the data folder.',
      helpValue: '<folder>',
    }),
    again: Flags.boolean({ summary: 'Extract each pick again, even one with a finished file' }),
    strategy: Flags.string({
      summary: 'How the source named comes in, when it can come in more than one way',
      helpValue: '<strategy>',
    }),
    jobs: Flags.integer({ hidden: true, default: 2, summary: 'How many to extract at once' }),
    splash: Flags.string({
      hidden: true,
      summary: 'How the splash looks',
      options: Object.keys(SPLASH_STYLES),
      default: 'ink',
    }),
  };

  private manager!: ConfigManager;
  /** The saved picks: `config` is oclif's. */
  private settings!: Config;
  private listings: SourceListing[] = [];
  private extractors = new Map<string, ExtractorMetadata[]>();
  /** What a scan found on this computer. */
  private rows: ScanRow[] = [];
  /** What the scan step offered: this computer's, the folders', and the accounts signed in to. */
  private offered: Offer[] = [];
  /** The source named, when setup is for it alone. */
  private alone?: string;
  /** The folders the scan step looked in, besides this computer. */
  private folders: string[] = [];
  /** The add step as ← left it, for coming back to. */
  private adding?: Adding;
  /** How many records each target's run would extract, by its key. */
  private counts = new Map<string, number | null>();
  /** How many records each row holds: undefined while it's counted, null when it can't say. */
  private held = new Map<ScanRow, number | null | undefined>();
  /** Draws the question or live lines again, while one is up. */
  private redraw?: () => void;
  /** Counts off the main thread, so a slow one never freezes the screen. */
  private readonly counter = new Counter();
  private readonly since = yearAgo();
  private readonly home = os.homedir();
  private t!: Tokens;
  /** The checklist above everything setup shows. */
  private readonly steps = new Steps();
  /** The spinner's frame, for a question drawn with the checklist. */
  private frame = 0;
  /** Where the files go. */
  private root = '';
  /** What's in each target's way, as last checked. */
  private states = new Map<Target, Checked>();
  /** This run's extractions: those started, and those that joined once a todo got them ready. */
  private readonly jobs: Job[] = [];
  private runner?: JobRunner;
  /** When the first extraction started. */
  private started = 0;
  /** What the extractions said meanwhile, kept until no question is up. */
  private readonly events: { job: Job; event: ChildEvent }[] = [];
  /** Full Disk Access, when it's wanted: offered last, as it means reopening the terminal. */
  private access?: Todo;
  /** How the todos went: done, waiting on an export, failed, and put off. */
  private readonly tally = { done: 0, waiting: 0, failed: 0, later: 0 };
  /** Whether Ctrl-C was pressed, outside a question, which takes its own. */
  private interrupted = false;
  /** Aborted by Ctrl-C: what's awaited, and any question up, give way. */
  private readonly halt = new AbortController();

  /**
   * Ctrl-C, outside a question: whatever setup's waiting on gives way, and
   * it ends, stopping the extractions. Pressed again, it ends at once.
   */
  private onInterrupt = () => {
    this.interrupted = true;
    this.halt.abort();
    process.removeListener('SIGINT', this.onInterrupt);
    process.once('SIGINT', this.onSecond);
  };

  /** Ctrl-C again: the extractions and counts are ended outright, and so is setup, as the signal ends it. */
  private onSecond = () => {
    this.runner?.kill();
    this.counter.close();
    process.kill(process.pid, 'SIGINT');
  };

  /** `work`, unless Ctrl-C comes first. */
  private stopped<T>(work: Promise<T>): Promise<T> {
    const { signal } = this.halt;
    if (signal.aborted) return Promise.reject(cancelled());
    return Promise.race([
      work,
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(cancelled()), { once: true });
      }),
    ]);
  }

  /** Whether to ask, or take what's ready. */
  private get asking(): boolean {
    return !this.flags.yes;
  }

  /** Whether a source is one this run is for: any, unless one was named. */
  private mine(source: string): boolean {
    return !this.alone || this.alone === source;
  }

  async run(): Promise<void> {
    const { argv } = await this.parse(Setup);
    this.t = tokens({ stream: 'stderr', theme: this.flags.theme });
    this.manager = new ConfigManager(this.config.configDir);
    this.settings = structuredClone(await this.manager.loadConfig());
    const folders = (await this.named(argv as string[])).map(folder => this.resolve(folder));
    if (!this.flags.yes && !canAsk()) {
      this.fail(
        this.alone
          ? `Setup asks how ${this.alone} comes in`
          : 'Setup asks which sources to extract',
        {
          hint: this.alone
            ? 'Run it at a terminal, or use `--yes` to take the way that is ready without asking.'
            : 'Run it at a terminal, or use `--yes` to extract what is ready without asking.',
        }
      );
    }
    this.root = this.flags.output
      ? this.resolve(this.flags.output)
      : path.join(this.config.dataDir, 'extracts');
    process.on('SIGINT', this.onInterrupt);
    try {
      if (this.alone) await this.setupAlone(this.alone, folders);
      else await this.setupAll(folders);
    } catch (error) {
      if (!this.interrupted) throw error;
    } finally {
      process.removeListener('SIGINT', this.onInterrupt);
      // Stopped partway, by Ctrl-C or a failure: no extraction keeps on. One
      // reading a database may take a moment to; Ctrl-C again doesn't wait.
      if (this.interrupted && this.jobs.some(job => job.state === 'running')) {
        this.print([this.t.muted('stopping the extraction; ctrl-c again to end it now')]);
      }
      await this.runner?.stop();
      this.counter.close();
      process.removeListener('SIGINT', this.onSecond);
    }
    if (this.interrupted) {
      this.logger.emit({
        level: 'info',
        kind: 'notice',
        message: 'Stopped',
        hint: { action: `Run \`${this.again()}\` to carry on. What you picked is kept.` },
      });
      this.logger.flush();
      // It ends the process, so a scan still going doesn't keep it open.
      throw new Errors.ExitError(130);
    }
  }

  /** Setup's steps, in turn, for every source. */
  private async setupAll(folders: string[]): Promise<void> {
    if (this.asking && !this.flags.quiet) await this.welcome();
    await this.scanHere(folders);
    await this.pickHere();
    if (this.asking) {
      // ← at the add step goes back to the scan step's picks, and → or Enter on again.
      while (!(await this.addMore())) await this.pickHere();
    } else {
      this.steps.set('add', 'done', 'skipped');
      this.steps.set('todo', 'done', 'skipped');
    }
    await this.prepare();
    this.startExtract();
    if (this.asking) await this.todo();
    await this.finishExtract();
  }

  /**
   * The source the arguments name, kept as what this run is for, and the
   * folders they name, to look in. A word that's neither fails, saying
   * what it might have meant, as do two sources: one's set up at a time.
   */
  private async named(words: string[]): Promise<string[]> {
    if (words.length === 0 && this.flags.strategy) {
      this.fail('`--strategy` picks how a source named comes in', {
        hint: `Name the source: \`chronicle setup gmail --strategy ${this.flags.strategy}\`.`,
      });
    }
    if (words.length === 0) return [];
    const listings = await listSources();
    const split = splitArgs(
      words,
      listings.map(listing => listing.source)
    );
    const [word] = split.unknown;
    if (word) {
      const guess = closest(
        word,
        listings.map(listing => listing.source)
      );
      this.fail(`No source named "${word}"`, {
        hint: guess
          ? `Did you mean \`chronicle setup ${guess}\`?`
          : existsSync(word)
            ? `Run \`chronicle setup ./${word}\` to look in the folder.`
            : "Run `chronicle sources --all` to see what's available.",
      });
    }
    for (const source of split.sources) {
      const listing = listings.find(l => l.source === source)!;
      if (listing.supported) continue;
      const where = listing.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ');
      this.fail(`${source} only runs on ${where}`);
    }
    if (split.sources.length > 1) {
      this.fail(`Name one source at a time, not ${split.sources.join(' and ')}`, {
        hint: `Run \`chronicle setup ${split.sources[0]}\`, then the next.`,
      });
    }
    [this.alone] = split.sources;
    return split.folders;
  }

  /**
   * The splash, with the steps ahead, while plugins load: on a later run,
   * saying it's carrying on, and where it left off. Enter starts.
   */
  private async welcome(): Promise<void> {
    // Plugins load while the logo plays and the steps are read, so the scan starts at once.
    const loading = Promise.all([
      listSources(),
      PluginScanner.scanAllPlugins(),
      PluginScanner.scanAllLocators(),
    ]);
    loading.catch(() => {});
    // Every run says what's ahead, and asks to start, as the logo comes on.
    const first = !this.settings.targets?.length && !this.settings.wanted?.length;
    const intro = first ? INTRO : resumed(this.whereLeftOff());
    const prompt = first ? 'Press Enter to start' : 'Press Enter to continue';
    const style = SPLASH_STYLES[this.flags.splash as SplashStyleName];
    if (Splash.fits()) {
      const splash = new Splash(this.t, { style, intro, prompt });
      splash.start();
      const { awaitEnter } = await import('../../output/prompts.js');
      let entered = false;
      try {
        entered = await awaitEnter();
      } finally {
        splash.end();
      }
      if (!entered) throw cancelled();
    } else {
      await this.introduce(intro, prompt);
    }
  }

  /** Where the last run left off: the picks, how many have a finished file, and the sources still to do. */
  private whereLeftOff(): { picked: number; extracted: number; left: string[] } {
    const targets = this.settings.targets ?? [];
    const extracted = targets.filter(target =>
      existsSync(finishedFile(this.root, targetName(target, targets)))
    ).length;
    const left = unique([
      ...(this.settings.wanted ?? []).map(way => way.source),
      ...(this.settings.requested ?? []).map(asked => asked.source),
    ]);
    return { picked: targets.length, extracted, left };
  }

  private resolve(file: string): string {
    return path.resolve(file.replace(/^~(?=$|\/)/, this.home));
  }

  private async save(): Promise<void> {
    await this.manager.saveConfig(this.settings);
  }

  /** Lines for a person, on stderr, above anything live. */
  private print(lines: string[]): void {
    if (!this.flags.quiet && lines.length > 0) process.stderr.write(`${lines.join('\n')}\n`);
  }

  private width(): number {
    return (process.stderr.columns || 80) - 1;
  }

  /** The checklist, when there's a person to read it. */
  private checklist(width = this.width(), frame = this.frame): string[] {
    // A source set up alone has no steps around it.
    return this.asking && !this.alone ? this.steps.lines(this.t, width, frame) : [];
  }

  /**
   * Lines redrawn in place under the checklist, at a terminal: none without
   * one, or when quiet.
   */
  private live(render: (width: number, frame: number) => string[]): LiveRegion | undefined {
    if (!process.stderr.isTTY || this.flags.quiet) return undefined;
    return new LiveRegion((width, frame) => {
      this.frame = frame;
      const head = this.checklist(width, frame);
      const body = render(width, frame);
      return head.length > 0 && body.length > 0 ? [...head, '', ...body] : [...head, ...body];
    });
  }

  /**
   * What a question setup asks takes: the checklist above it and any lines
   * of `extra` under that, drawn again while something's running, and
   * nothing left once it's answered, since the checklist says what was.
   */
  private around(extra: () => string[] = () => []) {
    return {
      header: () => {
        const more = extra();
        return [...this.checklist(), ...(more.length > 0 ? ['', ...more] : [])];
      },
      subscribe: (redraw: () => void) => {
        this.redraw = redraw;
        const timer = setInterval(() => {
          if (!this.steps.working()) return;
          this.frame++;
          redraw();
        }, TICK_MS);
        return () => {
          clearInterval(timer);
          this.redraw = undefined;
        };
      },
      clear: true,
      signal: this.halt.signal,
      // Esc at a step ends setup; it says so.
      esc: 'quit',
      theme: this.flags.theme,
    };
  }

  /** `work`, with a spinner and `text`, which may change, meanwhile at a terminal. */
  private async spin<T>(text: string | (() => string), work: () => Promise<T>): Promise<T> {
    const live = this.live((width, frame) => [
      line(
        [
          [glyphs.spinner[frame % glyphs.spinner.length], this.t.accent],
          [` ${typeof text === 'string' ? text : text()}`],
        ],
        width
      ),
    ]);
    live?.start();
    try {
      return await this.stopped(work());
    } finally {
      live?.stop();
    }
  }

  /** What setup does, step by step, and Enter to start, where the splash can't say it. */
  private async introduce(intro: Intro, prompt: string): Promise<void> {
    const { title, text, note, steps } = intro;
    this.logger.emit({
      level: 'info',
      kind: 'guide',
      message: title,
      guide: {
        text: [...(text ?? []), ...(note ? [note] : [])],
        steps: steps.map(({ name, description }) => `${name} - ${description}`),
      },
    });
    this.logger.flush();
    const { proceed } = await import('../../output/prompts.js');
    const { cancelled: stopped } = await proceed(prompt, {
      theme: this.flags.theme,
    });
    if (stopped) throw cancelled();
  }

  /** The command that carries on with this run: for the source named, or all of them. */
  private again(): string {
    return this.alone ? `chronicle setup ${this.alone}` : 'chronicle setup';
  }

  /**
   * `chronicle setup <source>`: that source alone, made ready to extract.
   * Each way it can come in, found here or not; one picked, by `--strategy`,
   * or asked for when there's more than one, each saying what it gets and
   * takes; then that way's steps, if any, as a todo, now or later. It ends
   * saying it's ready, and the `chronicle extract` command that extracts
   * it, or what's still in its way. What's picked is saved as setup's other
   * steps would save it.
   */
  private async setupAlone(source: string, folders: string[]): Promise<void> {
    const ways = await this.spin(`looking for ${source}`, () => this.waysIn(source, folders));
    if (ways.length === 0) {
      this.nowhere(source);
      return;
    }
    const way = await this.chooseWay(source, ways);
    const { name } = way.strategy;
    const requested = this.settings.requested?.find(
      r => r.source === source && r.flags.strategy === name
    );
    if (way.row) await this.takeRow(way);
    else if (!this.asking) {
      const rerun = this.flags.strategy ? `${source} --strategy ${name}` : source;
      this.hint(`${source} needs a step first. Run \`chronicle setup ${rerun}\` at a terminal.`);
    } else if (requested) {
      const [todo] = todosFor([
        { source, strategy: name, need: 'export', steps: [], requested: requested.at },
      ]);
      if (!(await this.askExport(todo, 0))) await this.putOff(todo);
    } else {
      const need = await this.need({ source, strategy: name });
      const [todo] = need ? todosFor([need]) : [];
      if (todo) {
        const result = (await this.offerTodo(todo)) ? await this.runTodo(todo) : 'later';
        if (result === 'later') {
          this.want(source, name);
          await this.putOff(todo);
        }
      }
    }
    await this.finishAlone(source);
  }

  /**
   * How setup for one source ends: Full Disk Access, if it's wanted; then
   * that it's ready, from where, and the commands that survey it, unless
   * it's an account, and extract it; or what's still in its way.
   */
  private async finishAlone(source: string): Promise<void> {
    const reopen = this.access && this.asking ? await this.allowAccess(this.access) : undefined;
    // Those checked this run, saved or not.
    const targets = [...this.states.keys()].filter(target => target.source === source);
    const ready = targets.filter(target => this.states.get(target)!.state === 'ready');
    for (const target of ready) {
      const { strategy, type: _type, ...options } = target.flags;
      const listing = this.listing(source)!;
      const command = commandFor(listing, String(strategy), options, this.home);
      this.summary(`${source} is ready: ${this.whence(target)}`);
      // A survey counts only what's on this computer, never an account online.
      if (this.strategy(source, strategy)?.delivery !== 'api') {
        // A survey takes the run as extract does.
        const survey = command.replace(/^chronicle extract/, 'chronicle survey');
        this.hint(`Run \`${survey}\` to see how much it holds.`);
      }
      this.hint(
        `Run \`${command}\` to extract it. Add \`--help\` to see its record types and options.`
      );
    }
    if (reopen) {
      this.hint(`Quit ${reopen} and open it again, then run \`${this.again()}\` to continue.`);
    } else if (ready.length === 0) {
      this.waiting(targets);
    }
  }

  /** Where a target reads from, as a person would say it: `it reads ~/…`, or the account. */
  private whence(target: Target): string {
    const row = this.rows.find(r => reads(target, r));
    if (this.strategy(target.source, target.flags.strategy)?.delivery === 'api') {
      return row
        ? `it signs in with ${row.label}`
        : `you're signed in to ${providerFor(target.source)}`;
    }
    const { input } = target.flags;
    const where = typeof input === 'string' ? fromHome(input, this.home) : row && this.labelOf(row);
    return where ? `it reads ${where}` : 'it reads what it found on this mac';
  }

  /**
   * A source with no way in setup can take: one that signs in some way setup
   * can't do for it, or isn't on this computer. Then what a scan says is in
   * its way, like gh signed out, or else where to see how it's read.
   */
  private nowhere(source: string): void {
    const online = this.listing(source)!.strategies.some(s => s.delivery === 'api');
    this.logger.info(
      online ? `Setup can't sign in to ${source} for you` : `Found no ${source} on this mac`
    );
    const hints = blockerHints(this.rows);
    if (hints.length === 0) {
      hints.push(`Run \`chronicle extract ${source} --help\` to see how it's read.`);
    }
    for (const hint of hints) this.hint(hint);
  }

  /** A todo put off: kept, with when, for the next run. */
  private async putOff(todo: Todo): Promise<void> {
    this.settings.later = { ...this.settings.later, [todo.key]: new Date().toISOString() };
    await this.save();
  }

  /**
   * Each way a source can come in that setup can do something with: its
   * export, picked before and still there, found in the folders saved or
   * named, or not; its account, signed in to or not, with a provider setup
   * can sign in to; and what it reads on this computer, when that's here.
   * Each with what's here of it.
   */
  private async waysIn(source: string, folders: string[]): Promise<WayIn[]> {
    [this.listings, this.extractors] = await Promise.all([
      listSources(),
      PluginScanner.scanAllPlugins(),
    ]);
    const listing = this.listing(source)!;
    const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
    const providers = new Set(await OAuthCommand.listProviders());
    this.rows = (await scan({ source })).rows;
    const found: { row: ScanRow; folder?: string }[] = this.rows
      .filter(row => OFFERED.has(row.status) && row.status !== 'signed-out')
      .map(row => ({ row }));
    // An export picked before, wherever it was found, while it's still there.
    for (const target of this.settings.targets ?? []) {
      const { input } = target.flags;
      if (target.source !== source || typeof input !== 'string' || !existsSync(input)) continue;
      const row = this.pathRow({ source, strategy: String(target.flags.strategy) }, input);
      if (row) found.push({ row });
    }
    for (const folder of unique([...(this.settings.folders ?? []), ...folders])) {
      const rows = await this.search(folder, () => {});
      for (const row of rows) {
        if (row.source === source && OFFERED.has(row.status)) found.push({ row, folder });
      }
    }
    const provider = providerFor(source);
    const signedIn = await CredentialManager.hasCredentials(provider);
    const ways: WayIn[] = [];
    for (const strategy of listing.strategies) {
      const here = found.find(f => f.row.strategy === strategy.name);
      if (strategy.delivery === 'api') {
        // Signed in some way a scan finds, like a token or another tool's login.
        if (here) ways.push({ strategy, row: here.row });
        else if (providers.has(provider)) {
          const account = signedIn ? this.accountRow(listing, strategy.name, true) : undefined;
          ways.push({ strategy, ...(account && { row: account }) });
        }
      } else if (strategy.delivery === 'export') {
        ways.push({ strategy, ...here });
      } else if (here) {
        ways.push({ strategy, row: here.row });
      }
    }
    return ways;
  }

  /**
   * The way a source comes in: `--strategy`'s, the only one, or asked for,
   * those ready first. Each says how it comes in and what it gets, and
   * under them, the highlighted one's state or steps, and the flag that
   * picks it. Without asking, the one that's ready.
   */
  private async chooseWay(source: string, ways: WayIn[]): Promise<WayIn> {
    const flag = this.flags.strategy;
    const names = ways.map(w => `\`--strategy ${w.strategy.name}\``).join(' or ');
    if (flag) {
      const way = ways.find(w => w.strategy.name === flag);
      if (way) return way;
      const known = this.listing(source)!.strategies.some(s => s.name === flag);
      this.fail(
        known ? `Found no ${source} ${flag} on this mac` : `${source} has no strategy "${flag}"`,
        { hint: `Use ${names}.` }
      );
    }
    if (ways.length === 1) return ways[0];
    const ready = ways.filter(w => w.row?.status === 'ready');
    if (!this.asking) {
      if (ready.length === 1) return ready[0];
      this.fail(`${source} can come in ${ways.length} ways`, { hint: `Pick one with ${names}.` });
    }
    const listed = [...ready, ...ways.filter(w => !ready.includes(w))];
    const hows = listed.map(w => how(w, listed));
    const width = Math.max(...hows.map(h => h.length));
    const details = await Promise.all(listed.map(w => this.wayLines(source, w)));
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      `how to bring in ${source}`,
      listed.map((w, i) => ({
        value: String(i),
        // Two spaces before what it gets, as every list lines them up.
        label: hows[i].padEnd(width + 1),
        description: gets(w.strategy),
      })),
      {
        body: [this.t.muted(`  ${listed.length} ways in, each getting something different.`)],
        detail: v => details[Number(v)],
        esc: 'quit',
        signal: this.halt.signal,
        theme: this.flags.theme,
      }
    );
    if (stopped) throw cancelled();
    return listed[Number(value)];
  }

  /**
   * What a way in comes to, under the question: ready, and from where; its
   * steps, as its todo will give them; or when its export was asked for.
   * Then the flag that picks it, to skip the question next time.
   */
  private async wayLines(source: string, way: WayIn): Promise<string[]> {
    const { strategy, row } = way;
    const provider = providerFor(source);
    const requested = this.settings.requested?.find(
      r => r.source === source && r.flags.strategy === strategy.name
    );
    let lines: string[];
    if (row?.status === 'blocked') {
      lines = [`  found at ${this.labelOf(row)}, but reading it needs full disk access.`];
    } else if (row && strategy.delivery === 'api') {
      lines = [`  you're signed in to ${provider}, so it's ready to extract.`];
    } else if (row) {
      lines = [`  found at ${this.labelOf(row)}, ready to extract.`];
    } else if (requested) {
      lines = [`  requested ${requested.at.slice(0, 10)}. once it's here, give its path.`];
    } else {
      const need = await this.need({ source, strategy: strategy.name });
      const steps = need ? todosFor([need])[0].steps : [];
      lines = steps.map((step, i) => `  ${i + 1}  ${stepText(step)}`);
      if (strategy.delivery === 'export') lines.push('  then give its path, or look later.');
    }
    return [
      ...lines,
      '',
      this.t.muted(`  next time: chronicle setup ${source} --strategy ${strategy.name}`),
    ];
  }

  /**
   * A way in that's here: a target, saved, and checked for what's in its
   * way. One whose records would have to be picked isn't saved, since
   * nothing's extracted here to pick them for: it's checked with them all.
   * Full Disk Access is asked for after, as setup always asks it; a sign-in
   * that's lapsed, now or later.
   */
  private async takeRow(way: WayIn): Promise<void> {
    const { row } = way;
    if (!row) return;
    // The folder it was found in is looked in again, as a pick in it would be.
    if (way.folder) this.settings.folders = unique([...(this.settings.folders ?? []), way.folder]);
    const saved = () => (this.settings.targets ?? []).find(t => reads(t, row));
    if (!saved() && (this.rowKinds(row).length > 0 || !row.installed)) {
      const offer = this.offer(row);
      await this.adopt([offer], [offer]);
    }
    const pool = (this.extractors.get(row.source) ?? []).filter(e => e.strategy === row.strategy);
    const target = saved() ?? (pool.length > 0 ? targetFor(row, allKinds(pool)) : undefined);
    if (!target) return;
    const checked = await this.check(target);
    this.states.set(target, checked);
    const { source } = target;
    const strategy = String(target.flags.strategy);
    if (checked.state === 'full-disk-access') {
      [this.access] = todosFor([{ source, strategy, need: 'full-disk-access' }]);
    } else if (checked.state === 'sign-in' && this.asking) {
      const need = await this.need({ source, strategy });
      const [todo] = need ? todosFor([need]) : [];
      if (todo && !((await this.offerTodo(todo)) && (await this.runTodo(todo)) !== 'later')) {
        await this.putOff(todo);
      }
    }
    // What else is in its way, the end says.
  }

  /**
   * The scan step: this computer, then the folders saved or named, never
   * others unasked, then the accounts already signed in to, each found
   * shown as it's found, for `pickHere` to offer.
   */
  private async scanHere(given: string[]): Promise<void> {
    const folders = unique([...(this.settings.folders ?? []), ...given]);
    this.folders = folders;
    const found: ScanRow[] = [];
    const { steps } = this;
    steps.set('scan', 'working', '');
    const live = this.live(width =>
      foundLines(
        found.map(row => ({ source: row.source, label: this.labelOf(row), note: this.note(row) })),
        this.t,
        width,
        Math.max(3, (process.stderr.rows || 24) - 8)
      )
    );
    this.redraw = () => live?.redraw();
    this.print(['']);
    live?.start();
    try {
      [this.listings, this.extractors] = await this.stopped(
        Promise.all([listSources(), PluginScanner.scanAllPlugins()])
      );
      const { rows } = await this.stopped(
        scan({
          onSource({ rows: more, done, total }) {
            found.push(...more.filter(row => OFFERED.has(row.status)));
            steps.note('scan', `${count(done)}/${count(total)}`);
            live?.redraw();
          },
        })
      );
      this.rows = rows;
      for (const folder of folders) {
        const known = new Set(found.map(row => rowKey(row)));
        const more = await this.stopped(
          this.search(folder, note => {
            steps.note('scan', note);
            live?.redraw();
          })
        );
        found.push(...more.filter(row => !known.has(rowKey(row))));
      }
      const here = new Set(found.map(row => row.source));
      found.push(...(await this.stopped(this.accounts(here))));
    } finally {
      live?.stop();
      this.redraw = undefined;
    }
    this.settings.folders = unique([...(this.settings.folders ?? []), ...given]);
    this.offered = found.map(row => this.offer(row));
  }

  /**
   * The scan step's question: which of what it found to extract, how much
   * each holds counted while it's up. Asked again when the add step goes
   * back to it, with what was picked still ticked.
   */
  private async pickHere(): Promise<void> {
    const { steps, offered: offers } = this;
    if (offers.length === 0) {
      steps.set('scan', 'done', 'none found');
      return;
    }
    steps.set('scan', 'asking', `${count(offers.length)} found`);
    this.countRows(offers.map(o => o.row));
    const where = this.folders.map(folder => fromHome(folder, this.home));
    const picked = await this.pick('pick what to extract', offers, [
      this.t.muted(`  found on this mac${where.length > 0 ? ` and in ${where.join(', ')}` : ''}.`),
      this.t.muted(
        offers.some(o => o.checked)
          ? '  ticked: what you picked before.'
          : '  tick what to extract, or a for all.'
      ),
    ]);
    await this.adopt(offers, picked);
    for (const offer of offers) offer.checked = picked.includes(offer);
    steps.set('scan', 'done', `${count(picked.length)} of ${count(offers.length)}`);
  }

  /**
   * The exports and databases a scan finds in a folder, one export's sources
   * together, saying how far it's got through `progress`. Nothing, said why,
   * when it can't be looked in.
   */
  private async search(folder: string, progress: (note: string) => void): Promise<ScanRow[]> {
    const where = fromHome(folder, this.home);
    progress(where);
    let rows: ScanRow[];
    try {
      ({ rows } = await scanPath(folder, {
        onFolder(n) {
          progress(`${where}  ${count(n)} ${plural('dirs', n)}`);
        },
      }));
    } catch (error) {
      this.logError(`Couldn't look in ${where}`, error);
      return [];
    }
    const found = rows.filter(row => row.status !== 'unsupported');
    const roots = unique(found.map(row => row.root));
    return found.sort((a, b) => roots.indexOf(a.root) - roots.indexOf(b.root));
  }

  /** A row for an account, as if a scan found it. */
  private accountRow(listing: SourceListing, strategy: string, signedIn: boolean): ScanRow {
    return {
      source: listing.source,
      strategy,
      // `spotify  account`, but `gmail  google account`.
      label:
        providerFor(listing.source) === listing.source
          ? 'account'
          : `${providerFor(listing.source)} account`,
      status: signedIn ? 'ready' : 'signed-out',
      installed: listing.installed,
      plugin: listing.plugin,
      config: {},
      command: '',
      evidence: { credential: providerFor(listing.source) },
    };
  }

  /** The accounts already signed in to, of sources not found here otherwise. */
  private async accounts(here: Set<string>): Promise<ScanRow[]> {
    const rows: ScanRow[] = [];
    for (const listing of this.listings) {
      const strategy = listing.strategies.find(s => s.delivery === 'api');
      if (!strategy || !listing.supported || listing.tier === 'legacy') continue;
      if (here.has(listing.source)) continue;
      if (!(await CredentialManager.hasCredentials(providerFor(listing.source)))) continue;
      rows.push(this.accountRow(listing, strategy.name, true));
    }
    return rows;
  }

  /** After a plugin is installed: its sources, extractors, and what they find. */
  private async refresh(): Promise<void> {
    this.counter.refresh();
    this.listings = await listSources();
    this.extractors = await PluginScanner.scanAllPlugins();
    this.rows = (await scan()).rows;
  }

  private listing(source: string): SourceListing | undefined {
    return this.listings.find(listing => listing.source === source);
  }

  private strategy(source: string, name: unknown): ManifestStrategy | undefined {
    return this.listing(source)?.strategies.find(s => s.name === name);
  }

  private check(target: Target): Promise<Checked> {
    return checkTarget(
      target,
      this.listing(target.source),
      this.extractors.get(target.source) ?? [],
      this.rows
    );
  }

  private exported(target: Target): boolean {
    return this.strategy(target.source, target.flags.strategy)?.delivery === 'export';
  }

  /** What a target extracted last time, from the file beside its records. */
  private extracted(name: string): number | undefined {
    try {
      return JSON.parse(readFileSync(targetFile(this.root, name), 'utf8')).records;
    } catch {
      return undefined;
    }
  }

  /**
   * How many records a target's run would extract, by its survey, counted
   * once a run. Null when it can't say, or doesn't answer in time.
   */
  private countTarget(target: Target): Promise<number | null> {
    const key = targetKey(target);
    if (this.counts.has(key)) return Promise.resolve(this.counts.get(key)!);
    return within(this.counter.target(target, this.since), SURVEY_TIMEOUT_MS).then(
      n => {
        this.counts.set(key, n);
        return n;
      },
      error => {
        this.logger.debug(`Couldn't count ${target.source}`, { error: String(error) });
        this.counts.set(key, null);
        return null;
      }
    );
  }

  /** A row's kinds, when it has them without asking: its plugin's defaults, or those it holds. */
  private rowKinds(row: ScanRow): string[] {
    return kindsFor(row, this.extractors.get(row.source) ?? []);
  }

  /** Where a row was found, from the home folder. */
  private labelOf(row: ScanRow): string {
    return row.root ? fromHome(row.root, this.home) : row.label;
  }

  /**
   * What a scan found, as a picker offers it: checked only when it was
   * wanted before, so picked, or asked for as an export, or added. The rest
   * start unchecked, for the person to pick.
   */
  private offer(row: ScanRow): Offer {
    const targeted = (this.settings.targets ?? []).some(target => reads(target, row));
    const awaited = [
      ...(this.settings.wanted ?? []),
      ...(this.settings.requested ?? []).map(r => ({
        source: r.source,
        strategy: r.flags.strategy,
      })),
    ].some(way => same(way, row.source, row.strategy));
    return {
      row,
      label: this.labelOf(row),
      note: () => this.note(row),
      checked: targeted || awaited,
    };
  }

  /** What's in a row's way, or how much it holds: `2,113 commands`. */
  private note(row: ScanRow): string {
    if (row.status === 'blocked') return 'no access';
    if (row.status === 'signed-out') return 'signed out';
    if (row.status !== 'ready') return statusText(row);
    if (!row.installed) return 'no plugin';
    if (row.evidence.credential) return 'signed in';
    if (!this.held.has(row)) return 'ready';
    const n = this.held.get(row);
    if (n === undefined) return `counting${glyphs.ellipsis}`;
    if (n === null) return 'ready';
    const kinds = this.rowKinds(row);
    const unit = kinds.length === 1 ? kinds[0].replaceAll('-', ' ') : 'records';
    return n === 0 ? 'empty' : `${count(n)} ${plural(unit, n)}`;
  }

  /**
   * Count what each ready row holds, every record of the kinds it would
   * extract, each filling in as its survey answers. An export isn't counted
   * here, since that means reading all of it; a database is.
   */
  private countRows(rows: ScanRow[]): void {
    // Only a person at a terminal sees them.
    if (!this.asking || this.flags.quiet) return;
    for (const row of rows) {
      const pool = (this.extractors.get(row.source) ?? []).filter(e => e.strategy === row.strategy);
      const local = pool.length > 0 && pool.every(e => e.delivery !== 'api');
      const exported = row.root && !row.database;
      if (this.held.has(row) || exported || row.status !== 'ready' || !local) continue;
      this.held.set(row, undefined);
      within(this.counter.row(row), SURVEY_TIMEOUT_MS).then(
        answer => {
          const kinds = this.rowKinds(row);
          const parts = Object.entries(answer ?? {}).filter(
            ([kind]) => kinds.length === 0 || kinds.includes(kind)
          );
          this.held.set(row, answer ? parts.reduce((n, [, part]) => n + part.count, 0) : null);
          this.redraw?.();
        },
        error => {
          this.logger.debug(`Couldn't count ${row.source}`, { error: String(error) });
          this.held.set(row, null);
          this.redraw?.();
        }
      );
    }
  }

  /** Offers as a picker's options, their sources and labels lined up. */
  private options(offers: Offer[]): SelectOption[] {
    const sources = Math.max(0, ...offers.map(o => o.row.source.length));
    const labels = Math.min(48, Math.max(0, ...offers.map(o => o.label.length)));
    return offers.map((o, i) => ({
      value: String(i),
      label: `${o.row.source.padEnd(sources)}  ${truncatePath(o.label, labels).padEnd(labels)}`,
      get description() {
        return o.note();
      },
    }));
  }

  /**
   * Ask which offers to take, with `body` under the question saying what
   * they are. Without asking, those that need no step, ready with their
   * plugin installed: picked before, or on this computer and not left
   * unpicked before.
   */
  private async pick(message: string, offers: Offer[], body: string[] = []): Promise<Offer[]> {
    if (!this.asking) {
      const skipped = (row: ScanRow) =>
        (this.settings.skipped ?? []).some(target => reads(target, row));
      return offers.filter(
        o =>
          o.row.installed &&
          o.row.status === 'ready' &&
          (o.checked || (!o.row.root && !skipped(o.row)))
      );
    }
    const { multiSelect } = await import('../../output/prompts.js');
    const result = await multiSelect(message, this.options(offers), {
      initial: offers.flatMap((o, i) => (o.checked ? [String(i)] : [])),
      // Unpicking them all picks none of them.
      none: true,
      enter: 'next',
      skip: 'skip',
      body,
      onward: true,
      ...this.around(),
    });
    if (result.cancelled) throw cancelled();
    return result.values.map(value => offers[Number(value)]);
  }

  /** Install a plugin, as `chronicle plugins install` does. */
  private async install(plugin: string): Promise<void> {
    const { installPlugin, resolveInstallTarget } = await import('../../plugins/install.js');
    try {
      await this.spin(`installing ${plugin}`, async () =>
        installPlugin(await resolveInstallTarget(plugin, this.config.version))
      );
    } catch (error) {
      this.logError(`Couldn't install ${plugin}`, error);
    }
  }

  /** Which kinds to extract of a source with no defaults, as `extract` asks. Undefined without asking. */
  private async askKinds(source: string, strategy: string): Promise<string[] | undefined> {
    const pool = (this.extractors.get(source) ?? []).filter(e => e.strategy === strategy);
    if (!this.asking || pool.length === 0) return undefined;
    const { multiSelect } = await import('../../output/prompts.js');
    const result = await multiSelect(
      `which ${source} records?`,
      allKinds(pool).map(kind => ({
        label: kind,
        value: kind,
        description: pool.find(e => e.recordType.includes(kind))?.description,
      })),
      { enter: 'next', ...this.around() }
    );
    if (result.cancelled) throw cancelled();
    return result.values;
  }

  /** Forget that a source and strategy were wanted or asked for: it's a target now, or not wanted. */
  private settle(source: string, strategy: unknown): void {
    this.settings.wanted = (this.settings.wanted ?? []).filter(w => !same(w, source, strategy));
    this.settings.requested = (this.settings.requested ?? []).filter(
      r => !(r.source === source && r.flags.strategy === strategy)
    );
  }

  /**
   * Make the picks targets, and the rest skipped, and save them: a pick's
   * plugin installed first, since its kinds come from it. A target picked
   * before keeps its kinds. A pick that was wanted, or asked for, is settled.
   */
  private async adopt(offers: Offer[], picked: Offer[]): Promise<void> {
    const plugins = unique(picked.filter(o => !o.row.installed).map(o => o.row.plugin));
    for (const plugin of plugins) await this.install(plugin);
    if (plugins.length > 0) await this.refresh();
    let targets = this.settings.targets ?? [];
    let skipped = this.settings.skipped ?? [];
    for (const offer of offers) {
      const before = targets.find(target => reads(target, offer.row));
      targets = targets.filter(target => !reads(target, offer.row));
      skipped = skipped.filter(target => !reads(target, offer.row));
      if (!picked.includes(offer)) {
        const { type: _type, ...flags } = targetFor(offer.row, []).flags;
        skipped.push({ source: offer.row.source, flags });
        continue;
      }
      this.settle(offer.row.source, offer.row.strategy);
      if (before) {
        targets.push(before);
        continue;
      }
      const kinds = this.rowKinds(offer.row);
      const chosen =
        kinds.length > 0 ? kinds : await this.askKinds(offer.row.source, offer.row.strategy);
      if (chosen?.length) targets.push(targetFor(offer.row, chosen));
    }
    this.settings.targets = targets;
    this.settings.skipped = skipped;
    await this.save();
  }

  /** A folder to look in, asked for: none when the question is cancelled, which goes back. */
  private async askFolder(): Promise<string | undefined> {
    const { input } = await import('../../output/prompts.js');
    const other = await input('path', {
      validate: value => existsSync(this.resolve(value)) || 'no such file or directory',
      body: [this.t.muted('  a folder or zip of exports, to look in.')],
      ...this.around(),
      esc: 'back',
    });
    return other.cancelled ? undefined : this.resolve(other.value);
  }

  /**
   * The strategies setup can get ready for a source that isn't here: a
   * sign-in with a provider it knows, or an export, with its plugin's steps
   * or plain ones.
   */
  private ways(listing: SourceListing, providers: Set<string>): SourceListing['strategies'] {
    return listing.strategies.filter(
      s =>
        (s.delivery === 'api' && providers.has(providerFor(listing.source))) ||
        s.delivery === 'export'
    );
  }

  /**
   * The add step: services not found here, each saying what it takes, a
   * sign-in or an export, and nothing done yet; and `f` to look in another
   * folder. Enter or → goes on, with or without any. What's picked is
   * wanted, for the todo step; what a folder turns up is picked like what
   * the scan found. False when ← goes back to the scan step instead, what's
   * ticked kept for when it's back.
   */
  private async addMore(): Promise<boolean> {
    this.steps.set('add', 'asking', 'optional');
    const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
    const providers = new Set(await OAuthCommand.listProviders());
    const here = this.here();
    const requested = this.settings.requested ?? [];
    const wanted = this.settings.wanted ?? [];
    const services = this.listings
      .filter(l => l.supported && l.tier !== 'legacy')
      .map(listing => ({
        listing,
        ways: this.ways(listing, providers).filter(w => !here.has(`${listing.source}:${w.name}`)),
      }))
      .filter(({ ways }) => ways.length > 0);
    const asked = (source: string) => requested.find(r => r.source === source);
    const names = Math.max(0, ...services.map(s => s.listing.source.length));
    const options: SelectOption[] = services.map(({ listing, ways }) => {
      const request = asked(listing.source);
      const takes = unique(ways.map(w => (w.delivery === 'api' ? 'sign in' : 'export')));
      return {
        value: listing.source,
        label: listing.source.padEnd(names),
        description: request ? `requested ${request.at.slice(0, 10)}` : takes.join(' + '),
      };
    });
    const kept = this.adding;
    this.adding = undefined;
    let initial =
      kept?.initial ??
      services
        .map(s => s.listing.source)
        .filter(source => asked(source) || wanted.some(w => w.source === source));
    // What another folder turns up, to pick like what the scan found, and the folder each was in.
    const found: Offer[] = kept?.found ?? [];
    const foundIn = kept?.foundIn ?? new Map<Offer, string>();
    // What the last folder looked in turned up, said under the question.
    let searched = kept?.searched ?? '';
    const { multiSelect } = await import('../../output/prompts.js');
    let values: string[];
    for (;;) {
      const rows = this.options(found).map(o => ({ ...o, value: `found:${o.value}` }));
      // A service whose export a folder turned up is offered as that export instead.
      const turnedUp = new Set(found.map(o => o.row.source));
      const offered = options.filter(option => !turnedUp.has(option.value));
      initial = initial.filter(value => !turnedUp.has(value));
      const result = await multiSelect('add services', [...rows, ...offered], {
        initial,
        none: true,
        enter: 'next',
        skip: 'skip',
        body: [
          ...(offered.length > 0 || rows.length > 0
            ? [
                this.t.muted('  not found on this mac. tick any you use.'),
                this.t.muted('  sign-ins and exports come later, in todo. f looks in a folder,'),
                this.t.muted('  like ~/Downloads, for exports you have.'),
              ]
            : [this.t.muted('  nothing to add: every service setup knows is here or signed in.')]),
          ...(searched ? [this.t.muted(`  ${searched}`)] : []),
        ],
        actions: [{ key: 'f', label: 'add folder', value: ANOTHER }],
        // Back to the scan step's question, when it asked one.
        ...(this.offered.length > 0 && { back: 'scan' }),
        onward: true,
        ...this.around(),
      });
      if (result.cancelled) throw cancelled();
      values = result.values.filter(value => value !== ANOTHER);
      if (result.back) {
        this.adding = { initial: values, found, foundIn, searched };
        this.steps.set('add', 'waiting', '');
        return false;
      }
      if (!result.values.includes(ANOTHER)) break;
      initial = values;
      const folder = await this.askFolder();
      if (!folder) continue;
      // All a folder holds, though the scan listed some of it: that step's over, and this is how to pick it now.
      const known = new Set(found.map(o => rowKey(o.row)));
      let looked = fromHome(folder, this.home);
      const more = await this.spin(
        () => looked,
        () =>
          this.search(folder, note => {
            looked = note;
          })
      );
      const fresh = more.filter(row => !known.has(rowKey(row)));
      for (const row of fresh) {
        const offer = this.offer(row);
        if (offer.checked) initial.push(`found:${found.length}`);
        found.push(offer);
        foundIn.set(offer, folder);
      }
      searched = `${fromHome(folder, this.home)}: ${fresh.length > 0 ? `${count(fresh.length)} found` : 'nothing found'}`;
    }
    const picks = new Set(values);
    // What's no longer picked is no longer waited for.
    for (const { listing, ways } of services) {
      for (const way of ways) {
        if (picks.has(listing.source)) this.want(listing.source, way.name);
        else this.settle(listing.source, way.name);
      }
    }
    const chosen = found.filter((_, i) => picks.has(`found:${i}`));
    // A folder is looked in again next run only when something in it was picked.
    this.settings.folders = unique([
      ...(this.settings.folders ?? []),
      ...chosen.map(offer => foundIn.get(offer)!),
    ]);
    if (found.length > 0) await this.adopt(found, chosen);
    await this.save();
    const added = services.filter(s => picks.has(s.listing.source)).length + chosen.length;
    this.steps.set('add', 'done', added > 0 ? `${count(added)} more` : 'none');
    return true;
  }

  /**
   * Each way a source is read that's here already, found or picked, as
   * `source:strategy`: a source signed in to can still add its export, for
   * what the API won't say.
   */
  private here(): Set<string> {
    return new Set([
      ...this.offered.map(o => `${o.row.source}:${o.row.strategy}`),
      ...(this.settings.targets ?? []).map(target => `${target.source}:${target.flags.strategy}`),
    ]);
  }

  /** Want a way in, for the todo step, unless it's wanted already or its export asked for. */
  private want(source: string, strategy: string): void {
    const known =
      (this.settings.wanted ?? []).some(w => same(w, source, strategy)) ||
      (this.settings.requested ?? []).some(
        r => r.source === source && r.flags.strategy === strategy
      );
    if (!known) this.settings.wanted = [...(this.settings.wanted ?? []), { source, strategy }];
  }

  /**
   * Each target's state, with a plugin it lacks installed. An export no
   * longer where it was is asked for again.
   */
  private async prepare(): Promise<void> {
    // A fix may take a target out of the list, which this loop's copy keeps.
    for (const target of this.settings.targets ?? []) {
      let checked = await this.check(target);
      if (checked.state === 'plugin' && this.asking) {
        await this.install(this.listing(target.source)!.plugin);
        await this.refresh();
        checked = await this.check(target);
      }
      if (checked.state === 'missing' && this.exported(target)) {
        // Moved or deleted: waited for again, like an export asked for.
        this.settings.targets = (this.settings.targets ?? []).filter(t => t !== target);
        const { type: _type, ...flags } = target.flags;
        this.settings.requested = [
          ...(this.settings.requested ?? []),
          { source: target.source, flags, at: new Date().toISOString() },
        ];
        await this.save();
      }
      this.states.set(target, checked);
    }
  }

  /**
   * A job for a target that's ready, without a finished file, and not
   * already running: added to the run, counted meanwhile.
   */
  private queue(target: Target, again = this.flags.again): void {
    const targets = this.settings.targets ?? [];
    const name = targetName(target, targets);
    if (existsSync(finishedFile(this.root, name)) && !again) return;
    if (this.jobs.some(job => targetKey(job.target) === targetKey(target))) return;
    const label = targetLabel(target, targets);
    const job: Job = { target, name, label, total: null, state: 'waiting', processed: 0 };
    this.started ||= Date.now();
    this.runner!.add(job);
    this.countTarget(target).then(total => {
      job.total = total;
    });
    this.noteExtract();
  }

  /** The extract step's note: how far it's got, or what it extracted. */
  private noteExtract(): void {
    const { jobs } = this;
    if (jobs.length === 0) {
      if (this.steps.state('extract') !== 'done') this.steps.set('extract', 'waiting', '');
      return;
    }
    const going = jobs.some(job => job.state === 'running' || job.state === 'waiting');
    const processed = jobs.reduce((n, job) => n + job.processed, 0);
    const counted = jobs.every(job => job.total !== null);
    const total = jobs.reduce((n, job) => n + (job.total ?? 0), 0);
    const failed = jobs.filter(job => job.state === 'failed').length;
    const amount =
      going && counted && total > 0
        ? `${count(Math.min(processed, total))}/${count(total)}`
        : `${count(processed)} ${plural('records', processed)}`;
    this.steps.set(
      'extract',
      going ? 'working' : 'done',
      failed > 0 ? `${amount} ${glyphs.bullet} ${count(failed)} failed` : amount
    );
  }

  /** Start extracting each target that's ready, in the background, while the todo is up. */
  private startExtract(): void {
    mkdirSync(this.root, { recursive: true });
    this.runner = new JobRunner(this.jobs, {
      root: this.root,
      bin: path.join(this.config.root, 'bin', 'run.js'),
      since: this.since.toISOString(),
      concurrency: Math.max(1, this.flags.jobs),
      onEvent: (job, event) => this.events.push({ job, event }),
      onChange: () => {
        this.noteExtract();
        this.redraw?.();
      },
    });
    this.runner.run().catch(() => {});
    for (const target of this.settings.targets ?? []) {
      if (this.states.get(target)?.state === 'ready') this.queue(target);
    }
    this.noteExtract();
  }

  /**
   * What's needed before the targets and wanted sources not ready yet can
   * be extracted, as todos.
   */
  private async todos(): Promise<Todo[]> {
    const needs: Need[] = [];
    for (const target of this.settings.targets ?? []) {
      const state = this.states.get(target)?.state;
      const way = { source: target.source, strategy: String(target.flags.strategy) };
      if (state === 'full-disk-access') needs.push({ ...way, need: 'full-disk-access' });
      if (state === 'sign-in') {
        const provider = providerFor(target.source);
        const steps = this.strategy(target.source, target.flags.strategy)?.setup;
        needs.push({
          ...way,
          need: 'sign-in',
          provider,
          steps,
          client: await this.client(provider),
        });
      }
    }
    for (const way of this.settings.wanted ?? []) {
      const need = await this.need(way);
      if (need) needs.push(need);
    }
    // An export asked for before: its steps are done, and it waits for where it is.
    for (const asked of this.settings.requested ?? []) {
      const way = { source: asked.source, strategy: String(asked.flags.strategy) };
      needs.push({ ...way, need: 'export', steps: [], requested: asked.at });
    }
    return todosFor(needs);
  }

  /** Whether a provider signs in without the person making an app first. */
  private async client(provider: string): Promise<boolean> {
    const { OAuthProviderRegistry } = await import('../../auth/ProviderRegistry.js');
    return (
      Boolean(OAuthProviderRegistry.get(provider)?.setup) ||
      Boolean((await CredentialManager.getCredentials(provider))?.clientId)
    );
  }

  /**
   * What a way in that's wanted needs before it can be extracted: a sign-in,
   * with its plugin's steps, or an export, with its plugin's or plain ones.
   * Nothing once its provider is signed in to.
   */
  private async need(way: Way): Promise<Need | undefined> {
    const strategy = this.strategy(way.source, way.strategy);
    if (strategy?.delivery === 'api') {
      const provider = providerFor(way.source);
      if (await CredentialManager.hasCredentials(provider)) return undefined;
      const client = await this.client(provider);
      return { ...way, need: 'sign-in', provider, steps: strategy.setup, client };
    }
    if (strategy?.delivery === 'export') {
      const steps = strategy.setup?.length ? strategy.setup : exportSteps(way.source);
      return { ...way, need: 'export', steps };
    }
    return undefined;
  }

  /**
   * The todo step: each sign-in and export, the least work first, to do now
   * or later. Later puts it at the back. Once all that's left was put off,
   * it's done, and they're kept for the next run. Full Disk Access is left
   * for last, once the extractions finish.
   */
  private async todo(): Promise<void> {
    const todos = order(await this.todos(), this.settings.later);
    const queue = todos.filter(todo => todo.kind !== 'access');
    this.access = todos.find(todo => todo.kind === 'access');
    const total = todos.length;
    if (total === 0) {
      this.steps.set('todo', 'done', 'none');
      return;
    }
    const { tally } = this;
    let turn = 0;
    let putOff = 0;
    while (queue.length > 0 && putOff < queue.length) {
      const todo = queue.shift()!;
      turn++;
      this.steps.set('todo', 'asking', `${count(Math.min(turn, total))} of ${count(total)}`);
      const result = todo.requested
        ? (await this.askExport(todo, 0))
          ? 'done'
          : 'later'
        : (await this.offerTodo(todo))
          ? await this.runTodo(todo)
          : 'later';
      if (result === 'later') {
        this.settings.later = { ...this.settings.later, [todo.key]: new Date().toISOString() };
        await this.save();
        queue.push(todo);
        putOff++;
        continue;
      }
      putOff = 0;
      tally[result]++;
      if (this.settings.later?.[todo.key]) {
        const { [todo.key]: _done, ...rest } = this.settings.later;
        this.settings.later = rest;
        await this.save();
      }
    }
    tally.later = queue.length;
    if (this.access) this.steps.set('todo', 'asking', 'full disk access left');
    else this.noteTodo();
  }

  /** The todo step's note, once it's through: what was done, and what's left. */
  private noteTodo(): void {
    const { done, waiting, failed, later } = this.tally;
    const parts = [
      done > 0 ? `${count(done)} done` : '',
      waiting > 0 ? `${count(waiting)} waiting` : '',
      failed > 0 ? `${count(failed)} failed` : '',
      later > 0 ? `${count(later)} later` : '',
    ].filter(Boolean);
    this.steps.set('todo', 'done', parts.join(` ${glyphs.bullet} `) || 'none');
  }

  /** A todo's title and its steps, numbered, the one at `at` picked out. */
  private todoLines(todo: Todo, at: number): string[] {
    const title = `${this.t.strong(todo.name)}${todo.what ? this.t.muted(`  ${todo.what}`) : ''}`;
    const steps = todo.steps.map((step, i) => {
      const text = `  ${i + 1}  ${stepText(step)}`;
      return i < at ? this.t.muted(text) : i === at ? this.t.accent(text) : text;
    });
    return [title, ...steps];
  }

  /** Offer a todo, or its step at `at`: true to go on, false for later. */
  private async offerTodo(todo: Todo, at = 0, button = action(todo)): Promise<boolean> {
    const [title, ...steps] = this.todoLines(todo, at);
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      title,
      [
        { label: button, value: 'go' },
        { label: 'later', value: 'later' },
      ],
      { inline: true, body: steps, ...this.around() }
    );
    if (stopped) throw cancelled();
    return value === 'go';
  }

  /**
   * Do a todo's steps in turn: open its pages, ask for what to paste, and
   * sign in; an export's end asking where it is. What it gets ready joins
   * the extractions. `waiting` once an export is asked for and not here
   * yet; `later` when it's put off partway.
   */
  private async runTodo(todo: Todo): Promise<'done' | 'waiting' | 'failed' | 'later'> {
    const answers: { 'client-id'?: string; 'client-secret'?: string } = {};
    const { input } = await import('../../output/prompts.js');
    for (const [i, step] of todo.steps.entries()) {
      if ('open' in step) {
        // The first page opens with the todo's own button; a later one, with its own.
        if (i > 0 && !(await this.offerTodo(todo, i, 'open'))) return 'later';
        await this.openPage(step.open);
      } else if ('ask' in step) {
        const { value, cancelled: stopped } = await input(step.ask.replace('-', ' '), {
          validate: answer => answer.trim().length > 0 || `paste the ${step.ask.replace('-', ' ')}`,
          ...this.around(() => this.todoLines(todo, i)),
        });
        if (stopped) throw cancelled();
        answers[step.ask] = value.trim();
      } else if ('sign-in' in step) {
        if (!(await this.signIn(step['sign-in'], answers))) return 'failed';
        await this.signedIn(todo);
      }
      // What to do there, and how long to wait, are said, not run.
    }
    if (todo.kind !== 'export') return 'done';
    if (await this.askExport(todo, todo.steps.length)) return 'done';
    await this.request(todo);
    return 'waiting';
  }

  /** Open a page in the browser, or say it, when there's none to open it in. */
  private async openPage(url: string): Promise<void> {
    const { BrowserLauncher } = await import('../../auth/BrowserLauncher.js');
    try {
      await BrowserLauncher.openUrl(url);
    } catch {
      this.hint(`Open ${url} in your browser.`);
    }
  }

  /** Sign in to a provider in the browser, with the client pasted, if any: whether it worked. */
  private async signIn(
    provider: string,
    client: { 'client-id'?: string; 'client-secret'?: string }
  ): Promise<boolean> {
    const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
    try {
      await new OAuthCommand(provider, {
        port: SIGN_IN_PORT,
        timeout: 300,
        openAtOnce: true,
        clientId: client['client-id'],
        clientSecret: client['client-secret'],
      }).execute();
    } catch (error) {
      if ((error as { exitCode?: number }).exitCode === 130) throw cancelled();
      this.logError(`Couldn't sign in to ${provider}`, error);
      return false;
    }
    return true;
  }

  /**
   * After a sign-in: each target it was in the way of, and each source
   * wanted through it, a target now, joins the extractions.
   */
  private async signedIn(todo: Todo): Promise<void> {
    for (const way of todo.ways) {
      const target = (this.settings.targets ?? []).find(t => same(way, t.source, t.flags.strategy));
      if (target) {
        await this.ready(target);
        continue;
      }
      const listing = this.listing(way.source);
      if (!listing) continue;
      if (!listing.installed) {
        await this.install(listing.plugin);
        await this.refresh();
      }
      const row = this.accountRow(this.listing(way.source) ?? listing, way.strategy, true);
      const kinds = this.rowKinds(row);
      const chosen = kinds.length > 0 ? kinds : await this.askKinds(way.source, way.strategy);
      this.settle(way.source, way.strategy);
      if (chosen?.length) {
        const made = targetFor(row, chosen);
        this.settings.targets = [...(this.settings.targets ?? []), made];
        await this.ready(made);
      }
      await this.save();
    }
  }

  /**
   * Check a target again, and extract it once it's ready. A source set up
   * alone is left for `chronicle extract`.
   */
  private async ready(target: Target): Promise<void> {
    const checked = await this.check(target);
    this.states.set(target, checked);
    if (checked.state === 'ready' && !this.alone) this.queue(target);
  }

  /** Each export a todo asked for, waited for from now, and no longer just wanted. */
  private async request(todo: Todo): Promise<void> {
    const at = new Date().toISOString();
    for (const way of todo.ways) {
      // Asked for again, it's waited for from now.
      this.settle(way.source, way.strategy);
      this.settings.requested = [
        ...(this.settings.requested ?? []),
        { source: way.source, flags: { strategy: way.strategy }, at },
      ];
    }
    await this.save();
  }

  /**
   * Ask where a todo's export is: a path, looked in for what the todo's
   * strategy reads, or later. Nowhere is looked in unasked. A strategy that
   * can't tell its export from the inside, like an iPhone backup, takes the
   * path as it is. True once it's found, a target, and joins the extractions.
   */
  private async askExport(todo: Todo, at: number): Promise<boolean> {
    const { select, input } = await import('../../output/prompts.js');
    let said = "  once it's here, give its path: a folder, zip, or file.";
    for (;;) {
      const [title, ...steps] = this.todoLines(todo, at);
      const { value, cancelled: stopped } = await select(
        title,
        [
          { label: 'give path', value: 'path' },
          { label: 'later', value: 'later' },
        ],
        {
          inline: true,
          body: [...steps, ...(steps.length > 0 ? [''] : []), this.t.muted(said)],
          ...this.around(),
        }
      );
      if (stopped) throw cancelled();
      if (value !== 'path') return false;
      const answer = await input('path', {
        validate: typed => existsSync(this.resolve(typed)) || 'no such file or directory',
        body: [this.t.muted(`  where the ${todo.name} export is: a folder, zip, or file.`)],
        ...this.around(),
        esc: 'back',
      });
      if (answer.cancelled) continue;
      const where = this.resolve(answer.value);
      const shown = fromHome(where, this.home);
      const rows = await this.spin(`looking in ${shown}`, () => this.search(where, () => {}));
      const [way] = todo.ways;
      const strategy = this.strategy(way.source, way.strategy);
      const blind =
        !strategy?.layouts?.length && !strategy?.files?.length && !strategy?.databases?.length;
      const row =
        rows.find(r => todo.ways.some(w => same(w, r.source, r.strategy))) ??
        (blind ? this.pathRow(way, where) : undefined);
      if (!row) {
        said = `  no ${todo.name} export in ${shown}. give another path, or look later.`;
        continue;
      }
      const offer = this.offer(row);
      await this.adopt([offer], [offer]);
      const target = (this.settings.targets ?? []).find(t => reads(t, row));
      if (target) await this.ready(target);
      return true;
    }
  }

  /** A row for an export at a path, taken as it is, for a strategy that can't tell it from the inside. */
  private pathRow(way: Way, where: string): ScanRow | undefined {
    const listing = this.listing(way.source);
    if (!listing) return undefined;
    return {
      source: way.source,
      strategy: way.strategy,
      label: fromHome(where, this.home),
      status: 'ready',
      installed: listing.installed,
      plugin: listing.plugin,
      config: { input: where },
      command: '',
      root: where,
      evidence: {},
    };
  }

  /**
   * Once the extractions are through, said live under the checklist: Ctrl-C
   * stops them, and setup. Then what was extracted, and Full Disk Access, if
   * it's wanted.
   */
  private async finishExtract(): Promise<void> {
    const runner = this.runner!;
    if (this.jobs.some(job => job.state === 'running' || job.state === 'waiting')) {
      const live = this.live((width, frame) =>
        liveLines(this.jobs, this.started, this.t, width, frame)
      );
      this.redraw = () => live?.redraw();
      live?.start();
      try {
        // Ctrl-C stops them, as the run ends.
        await this.stopped(runner.drained());
      } finally {
        live?.stop();
        this.redraw = undefined;
      }
    }
    this.noteExtract();
    if (this.jobs.length === 0) this.steps.set('extract', 'done', 'nothing new');
    // Asked before the report, which ends with what to do next.
    const reopen = this.access ? await this.allowAccess(this.access) : undefined;
    this.report();
    if (reopen)
      this.hint(`Quit ${reopen} and open it again, then run \`${this.again()}\` to continue.`);
    if (this.jobs.some(job => job.state === 'failed')) throw new Errors.ExitError(1);
  }

  /**
   * Full Disk Access, last, since turning it on means reopening the
   * terminal: now, by System Settings, or later. The terminal to reopen,
   * when it's now.
   */
  private async allowAccess(todo: Todo): Promise<string | undefined> {
    if (process.platform !== 'darwin') return undefined;
    const { app } = await terminal();
    const sources = unique(todo.ways.map(way => way.source));
    const steps = [
      `  1  open system settings`,
      `  2  turn on ${app} under full disk access`,
      `  3  quit ${app} and open it again`,
      `  4  run chronicle setup`,
    ];
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      `${this.t.strong('full disk access')}${this.t.muted(`  for ${sources.join(', ')}`)}`,
      [
        { label: action(todo), value: 'go' },
        { label: 'later', value: 'later' },
      ],
      { inline: true, body: [this.t.accent(steps[0]), ...steps.slice(1)], ...this.around() }
    );
    if (stopped) throw cancelled();
    if (value !== 'go') {
      this.settings.later = { ...this.settings.later, [todo.key]: new Date().toISOString() };
      await this.save();
      this.tally.later++;
      this.noteTodo();
      return undefined;
    }
    this.tally.done++;
    this.noteTodo();
    await this.config.runCommand('setup:full-disk-access', ['--open']);
    return app;
  }

  /**
   * The checklist as it ends, then what was extracted, this run and before,
   * with each file; where the files are; then what's still waiting, and why.
   */
  private report(): void {
    const targets = this.settings.targets ?? [];
    const checklist = this.checklist(this.width(), 0);
    this.print(checklist.length > 0 ? [...checklist, ''] : []);
    for (const { job, event } of this.events) {
      this.logger.emit({
        level: event.level === 'error' ? 'error' : 'warn',
        kind: 'notice',
        message: `${job.label}: ${event.message}`,
        ...(event.hint && { hint: event.hint }),
      });
    }
    const names = Math.max(0, ...this.jobs.map(job => job.label.length));
    for (const job of this.jobs.filter(job => job.state === 'failed')) {
      const command = commandLine(
        ['extract', ...targetArgs(job.target), '--since', this.since.toISOString(), '--limit', '0'],
        this.home
      );
      this.print(finishedLines(job, names, command, this.t, this.width()));
    }
    const ran = new Set(this.jobs.map(job => targetKey(job.target)));
    const before = targets
      .map(target => ({ target, name: targetName(target, targets) }))
      .filter(
        ({ target, name }) =>
          !ran.has(targetKey(target)) && existsSync(finishedFile(this.root, name))
      );
    const done = [
      ...before.map(({ target, name }) => ({ target, name, records: this.extracted(name) })),
      ...this.jobs
        .filter(job => job.state === 'done')
        .map(job => ({ target: job.target, name: job.name, records: job.processed })),
    ];
    if (done.length > 0) {
      const { lines } = table(
        {
          headings: ['source', 'records', 'file'],
          cells: done.map(({ target, name, records }) => [
            targetLabel(target, targets),
            records === undefined ? '' : count(records),
            `${name}.jsonl`,
          ]),
          numeric: [false, true, false],
          muted: [false, false, true],
        },
        tokens({ stream: 'stdout', theme: this.flags.theme }),
        stdoutWidth()
      );
      for (const text of lines) this.log(text);
    }
    const { jobs } = this;
    const records = jobs.reduce((n, job) => n + (job.state === 'done' ? job.processed : 0), 0);
    const extracted = jobs.filter(job => job.state === 'done').length;
    const failed = jobs.filter(job => job.state === 'failed').length;
    if (jobs.length > 0) {
      const title = `Extracted ${count(extracted)} ${plural('sources', extracted)}`;
      this.logger.emit({
        level: 'info',
        kind: 'summary',
        message: `${title}: ${count(records)} ${plural('records', records)}`,
        fields: {
          title,
          counts: records > 0 ? { records } : {},
          records,
          ...(failed > 0 && { failed }),
          durationMs: Date.now() - this.started,
          output: fromHome(this.root, this.home),
        },
      });
    } else if (done.length > 0) {
      this.logger.info('Nothing new to extract');
    } else {
      this.logger.info('Nothing to extract yet');
    }
    if (done.length > 0) {
      // The summary says where the files went; without one, this does.
      const where = jobs.length > 0 ? '' : `The files are in ${fromHome(this.root, this.home)}. `;
      this.hint(`${where}Delete a file, or use \`--again\`, to extract it again.`);
    }
    this.waiting(
      targets.filter(
        target =>
          this.states.get(target) &&
          this.states.get(target)!.state !== 'ready' &&
          !done.some(d => d.target === target)
      )
    );
  }

  /**
   * What's still in each target's way, and each export asked for: at a
   * terminal, the todos left, by name, to finish with another run; without
   * one, a hint for each kind of thing.
   */
  private waiting(targets: Target[]): void {
    const { states } = this;
    const by = (state: Checked['state']) =>
      targets.filter(target => states.get(target)!.state === state).map(t => t.source);
    if (this.asking) {
      const left = unique([
        ...by('sign-in'),
        ...(this.access ? by('full-disk-access') : []),
        ...(this.settings.wanted ?? []).map(way => way.source),
        ...(this.settings.requested ?? []).map(asked => asked.source),
      ]).filter(source => this.mine(source));
      if (left.length === 1) this.hint(`Run \`chronicle setup ${left[0]}\` to finish it.`);
      else if (left.length > 1) {
        this.hint(`Run \`chronicle setup\` to finish ${left.join(', ')}.`);
      }
    } else {
      const access = by('full-disk-access');
      if (access.length > 0) {
        this.hint(
          `${unique(access).join(', ')} ${access.length === 1 ? 'needs' : 'need'} Full Disk Access. ${FULL_DISK_ACCESS}`
        );
      }
      for (const source of unique(by('sign-in'))) {
        this.hint(
          `${source} needs sign-in. Run \`chronicle auth login ${providerFor(source)}\` to sign in.`
        );
      }
    }
    const plugins = unique(by('plugin'));
    if (plugins.length > 0) {
      const plugin = this.listing(plugins[0])?.plugin ?? plugins[0];
      this.hint(
        `${plugins.join(', ')} ${plugins.length === 1 ? 'needs its plugin' : 'need their plugins'}. Run \`chronicle plugins install ${plugin}\` to add it.`
      );
    }
    for (const target of targets) {
      const checked = states.get(target)!;
      if (['full-disk-access', 'sign-in', 'plugin'].includes(checked.state)) continue;
      const what = stateText(checked, this.exported(target));
      this.hint(
        checked.state === 'flags'
          ? `${target.source}: ${what}. Run \`chronicle setup\` and pick it again.`
          : `${target.source}: ${what}.`
      );
    }
    if (this.asking) return;
    for (const asked of (this.settings.requested ?? []).filter(r => this.mine(r.source))) {
      this.hint(
        `Waiting for ${asked.source}'s export, asked for ${date(new Date(asked.at)).slice(0, 10)}.`
      );
    }
  }
}
