import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
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
import {
  listSources,
  type Answer,
  type ManifestStrategy,
  type SourceListing,
} from '../../plugins/catalog.js';
import { PluginScanner, type ExtractorMetadata } from '../../plugins/PluginScanner.js';
import { commandFor, fromHome, scan, scanPath, type ScanRow } from '../../plugins/scan.js';
import { splitArgs } from '../../setup/args.js';
import { finishedLines, foundLines, liveLines } from '../../setup/display.js';
import { JobRunner, imported, type ChildEvent, type Imported, type Job } from '../../setup/jobs.js';
import { Counter } from '../../setup/counter.js';
import { Steps } from '../../setup/steps.js';
import {
  checkTarget,
  commandLine,
  kindsFor,
  providerFor,
  accessFor,
  reads,
  signedInTo,
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
  accountless,
  action,
  asked,
  exportSteps,
  gets,
  order,
  stepText,
  todosFor,
  type Need,
  type Todo,
  type Way,
} from '../../setup/todo.js';
import { INTRO, resumed, type Standing } from '../../setup/intro.js';
import { allKinds } from '../../utils/recordKinds.js';
import { STORE_FLAGS } from '../../utils/importFlags.js';
import { chronicleDataDir } from '../../config/dataDir.js';
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
  local: 'on this computer',
  direct: 'on this computer',
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

/** Offers by source, then where they are. */
const bySource = (a: Offer, b: Offer) =>
  a.row.source.localeCompare(b.row.source) || a.label.localeCompare(b.label);

/** A service gather offers to add: one way it comes in, what that takes, and what it gets. */
interface Service {
  source: string;
  way: ManifestStrategy & { name: string };
  takes: string;
  gets: string;
}

/** The values of gather's rows: what was found, by what it reads, and each service's way in. */
const foundKey = (offer: Offer) => `found:${rowKey(offer.row)}`;
const serviceKey = (service: Service) => `service:${service.source}:${service.way.name}`;

/** What a run is: one that starts, or one carrying on from the last, with something left. */
type Kind = 'start' | 'resume';

/** Names as a person lists them: `a`, `a and b`, `a, b, and c`. */
function inWords(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/** Each pick's mark, where the splash can't show it. */
const MARKS: Record<Standing['state'], string> = {
  done: glyphs.success,
  waiting: glyphs.ellipsis,
  left: glyphs.bullet,
};

/** Whether a source and strategy are the same as a way's. */
const same = (way: Way, source: string, strategy: unknown) =>
  way.source === source && way.strategy === strategy;

/**
 * `chronicle setup [folder…]`: setup, in three steps. Gather finds
 * what this computer and the folders of exports hold, and asks what to
 * import, with the services that need a sign-in or an export. Prepare
 * offers those sign-ins and exports one at a time, each to do now or later,
 * and Full Disk Access first, when a pick needs it. Import puts the last
 * year of each pick in the store. A checklist of the steps stays above it
 * all. Only the picks are saved, and a record of each import. A run that
 * carries on starts at what's left, works out again what stands in each
 * pick's way, and skips a pick imported already.
 *
 * `chronicle setup <source>` is that source alone, without the steps: how
 * it can come in, one way picked, then that way's steps, if any, until
 * it's ready for `chronicle extract`.
 */
export default class Setup extends BaseCommand<typeof Setup> {
  static override hidden = true;

  static override summary = 'Pick your sources and import them';

  static override description =
    'Sets up Chronicle in three steps: gathers what this computer and any folders you name hold, and asks ' +
    'which to import and which services to add; prepares what is left, like a sign-in or an ' +
    'export to ask for, now or later; then imports each into the store. Run it again ' +
    'to carry on where it left off. ' +
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
    ...STORE_FLAGS,
    again: Flags.boolean({ summary: 'Import each pick again, even one imported already' }),
    strategy: Flags.string({
      summary: 'How the source named comes in, when it can come in more than one way',
      helpValue: '<strategy>',
    }),
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
  /** What gather found to offer: this computer's, the folders', and the accounts signed in to. */
  private offered: Offer[] = [];
  /** The rows of accounts gather offers, rather than what's on this computer. */
  private readonly accounted = new Set<ScanRow>();
  /** The source named, when setup is for it alone. */
  private alone?: string;
  /** The folders gather looked in, besides this computer. */
  private folders: string[] = [];
  /** The folder gather found each row in, of those it found in one. */
  private readonly folderOf = new Map<ScanRow, string>();
  /** How many records each target's run would extract, by its key. */
  private counts = new Map<string, number | null>();
  /** The counts still being made, by the target's key. */
  private readonly counting = new Map<string, Promise<number | null>>();
  /** Whether the import was left for later, at the plan. */
  private later = false;
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
  /** Where a record of each import goes. */
  private root = '';
  /** The store the picks go into. */
  private db = '';
  /** What's in each target's way, as last checked. */
  private states = new Map<Target, Checked>();
  /** The providers setup can sign in to, once they're loaded. */
  private signIns?: Set<string>;
  /** This run's imports: each pick that's ready once prepare is through. */
  private readonly jobs: Job[] = [];
  private runner?: JobRunner;
  /** When the first of the imports started. */
  private started = 0;
  /** What the imports said meanwhile, kept for the report. */
  private readonly events: { job: Job; event: ChildEvent }[] = [];
  /** Full Disk Access, when it's wanted: offered first, as turning it on means reopening the terminal. */
  private access?: Todo;
  /** The terminal to reopen, once Full Disk Access is being turned on: the run ends for it. */
  private reopening?: string;
  /** How the todos went: done, waiting on an export, failed, and put off. */
  private readonly tally = { done: 0, waiting: 0, failed: 0, later: 0 };
  /** Whether Ctrl-C was pressed, outside a question, which takes its own. */
  private interrupted = false;
  /** Aborted by Ctrl-C: what's awaited, and any question up, give way. */
  private readonly halt = new AbortController();

  /**
   * Ctrl-C, outside a question: whatever setup's waiting on gives way, and
   * it ends, stopping the imports. Pressed again, it ends at once.
   */
  private onInterrupt = () => {
    this.interrupted = true;
    this.halt.abort();
    process.removeListener('SIGINT', this.onInterrupt);
    process.once('SIGINT', this.onSecond);
  };

  /** Ctrl-C again: the imports and counts are ended outright, and so is setup, as the signal ends it. */
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
        this.alone ? `Setup asks how ${this.alone} comes in` : 'Setup asks which sources to import',
        {
          hint: this.alone
            ? 'Run it at a terminal, or use `--yes` to take the way that is ready without asking.'
            : 'Run it at a terminal, or use `--yes` to import what is ready without asking.',
        }
      );
    }
    this.root = path.join(chronicleDataDir(), 'setup');
    const { resolveDbPath } = await import('../../persistence/store.js');
    this.db = resolveDbPath(this.flags.db && this.resolve(this.flags.db));
    process.on('SIGINT', this.onInterrupt);
    try {
      if (this.alone) await this.setupAlone(this.alone, folders);
      else await this.setupAll(folders);
    } catch (error) {
      if (!this.interrupted) throw error;
    } finally {
      process.removeListener('SIGINT', this.onInterrupt);
      // Stopped partway, by Ctrl-C or a failure: no import keeps on. One
      // reading a database may take a moment to; Ctrl-C again doesn't wait.
      if (this.interrupted && this.jobs.some(job => job.state === 'running')) {
        this.print([this.t.muted('stopping the import; ctrl-c again to end it now')]);
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

  /**
   * Setup's steps, in turn, for every source. A run that carries on starts
   * at what's left, with the picks kept, unless it's asked to change them
   * or given folders to look in, or it's aborted. Turning on Full Disk
   * Access ends it before the import, for the next run to carry on.
   */
  private async setupAll(folders: string[]): Promise<void> {
    const kind = this.kind();
    let gathering = kind !== 'resume' || folders.length > 0 || !this.asking;
    if (this.asking && !this.flags.quiet) {
      const answer = await this.welcome(kind);
      if (answer === 'abort') {
        await this.abort();
        return;
      }
      if (answer === 'gather') gathering = true;
    }
    if (gathering) {
      await this.scanHere(folders);
      await this.gather();
    } else {
      await this.keepPicks();
    }
    await this.checkPicks();
    if (!this.asking) this.steps.set('prepare', 'done', 'skipped');
    else if (!(await this.prepare())) {
      this.reopen();
      return;
    }
    this.later = this.asking && !(await this.confirm());
    await this.importAll();
  }

  /** The picks the import takes: each that's ready, and not imported already unless `--again`. */
  private importing(): Target[] {
    return (this.settings.targets ?? []).filter(
      target =>
        this.states.get(target)?.state === 'ready' && (this.flags.again || !this.imported(target))
    );
  }

  /**
   * Before the import, its plan, to import now or leave for later: what's
   * imported, the last year of each pick that's ready, counted while it's
   * up; what's left for later, and why; and what's imported already. True
   * to import. With nothing to import, there's nothing to ask.
   */
  private async confirm(): Promise<boolean> {
    const now = this.importing();
    if (now.length === 0) return true;
    for (const target of now) this.countTarget(target).then(() => this.redraw?.());
    this.steps.set('import', 'asking', `${count(now.length)} ready`);
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      `Begin importing ${count(now.length)} ${plural('sources', now.length)}?`,
      [
        { label: 'import', value: 'go' },
        { label: 'later', value: 'later' },
      ],
      { inline: true, ...this.around(() => this.plan(now)) }
    );
    if (stopped) throw cancelled();
    return value === 'go';
  }

  /**
   * The import's plan, under the checklist: each pick that's ready, where
   * it reads from, and how many records it holds, as its count comes in;
   * each not ready yet, as the next run's splash would say; and those
   * imported already.
   */
  private plan(now: Target[]): string[] {
    const { t } = this;
    const targets = this.settings.targets ?? [];
    const labels = now.map(target => targetLabel(target, targets));
    const picks = this.standing().filter(pick => this.mine(pick.source));
    const later = picks.filter(pick => pick.state !== 'done' && !labels.includes(pick.name));
    const done = picks.filter(pick => pick.state === 'done' && !labels.includes(pick.name));
    const names = Math.max(...labels.map(l => l.length), ...later.map(pick => pick.name.length));
    const wheres = now.map(target => truncatePath(this.from(target), 48));
    const wide = Math.max(...wheres.map(where => where.length));
    const held = (target: Target) => {
      const key = targetKey(target);
      if (!this.counts.has(key)) return `counting${glyphs.ellipsis}`;
      const n = this.counts.get(key);
      return n === null || n === undefined ? '' : `${count(n)} ${plural('records', n)}`;
    };
    return [
      t.strong('ready to import'),
      ...now.map(
        (target, i) =>
          `  ${t.accent(glyphs.arrow)} ${labels[i].padEnd(names)}  ${wheres[i].padEnd(wide)}  ${t.muted(held(target))}`
      ),
      ...(later.length > 0
        ? [
            '',
            t.strong('not ready yet'),
            ...later.map(
              pick =>
                `  ${t.muted(MARKS[pick.state])} ${pick.name.padEnd(names)}  ${t.muted(pick.text)}`
            ),
          ]
        : []),
      ...(done.length > 0
        ? ['', t.muted(`already imported: ${inWords(done.map(pick => pick.name))}`)]
        : []),
    ];
  }

  /**
   * Where a target reads from, in a few words: its account, or what it was
   * given for one with none, like a username; its file; or what the scan found.
   */
  private from(target: Target): string {
    const strategy = this.strategy(target.source, target.flags.strategy);
    if (accountless(strategy)) {
      const { strategy: _strategy, type: _type, ...given } = target.flags;
      return Object.values(given).map(String).join(' ');
    }
    if (strategy?.delivery === 'api') return `${providerFor(target.source)} account`;
    const { input } = target.flags;
    if (typeof input === 'string') return fromHome(input, this.home);
    const row = this.rows.find(r => reads(target, r));
    return row ? this.labelOf(row) : '';
  }

  /**
   * What this run is: one that carries on, with a pick not yet imported,
   * or a service or export still to get ready; or else one that starts, as
   * the first does, whatever's imported already.
   */
  private kind(): Kind {
    return this.standing().some(pick => pick.state !== 'done') ? 'resume' : 'start';
  }

  /**
   * Where each pick stands, as the last run left it: imported, with how
   * many records; waiting on an export asked for; or left to do, like a
   * sign-in, an export to ask for, or the import itself.
   */
  private standing(): Standing[] {
    const { targets = [], wanted = [], requested = [], later = {} } = this.settings;
    const ways = [
      ...targets.map(t => ({ source: t.source, strategy: String(t.flags.strategy) })),
      ...wanted,
      ...requested.map(r => ({ source: r.source, strategy: String(r.flags.strategy) })),
    ];
    // A source picked more than one way says which.
    const name = (source: string, strategy: string) =>
      ways.filter(way => way.source === source).length > 1 ? `${source} ${strategy}` : source;
    const picks: Standing[] = targets.map(target => {
      const { source } = target;
      const record = this.imported(target);
      if (!record) {
        // Checked this run, it says what's in its way.
        const state = this.states.get(target)?.state;
        const text =
          state === 'full-disk-access'
            ? 'needs full disk access'
            : state === 'sign-in'
              ? 'sign-in to do'
              : 'to import';
        return { source, name: targetLabel(target, targets), state: 'left', text };
      }
      const { records } = record;
      return {
        source,
        name: targetLabel(target, targets),
        state: 'done',
        text: `imported, ${count(records)} ${plural('records', records)}`,
      };
    });
    for (const asked of requested) {
      picks.push({
        source: asked.source,
        name: name(asked.source, String(asked.flags.strategy)),
        state: 'waiting',
        text: `export requested ${asked.at.slice(0, 10)}`,
      });
    }
    for (const way of wanted) {
      // Before the listings load, as when working out what kind of run this is, it's an export.
      const strategy = this.strategy(way.source, way.strategy);
      const given = accountless(strategy);
      const online = strategy?.delivery === 'api' && !given;
      const key = online
        ? `sign-in:${providerFor(way.source)}`
        : `setup:${way.source}:${way.strategy}`;
      const what = given ? asked(strategy!.setup) : online ? 'sign-in' : 'export';
      picks.push({
        source: way.source,
        name: name(way.source, way.strategy),
        state: 'left',
        text: later[key]
          ? `${what} put off`
          : given
            ? `${what} to give`
            : online
              ? 'sign-in to do'
              : 'export to request',
      });
    }
    return picks;
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
   * The splash, while plugins load. A run that starts says the steps ahead.
   * One that carries on says it's resuming, and where each pick stands; `g`
   * goes back to gather, to change the picks, and `x` aborts it, once it's
   * sure. Enter starts, or continues.
   */
  private async welcome(kind: Kind): Promise<'start' | 'gather' | 'abort'> {
    // Plugins load while the logo plays and the steps are read, so the scan starts at once.
    const loading = Promise.all([
      listSources(),
      PluginScanner.scanAllPlugins(),
      PluginScanner.scanAllLocators(),
    ]);
    loading.catch(() => {});
    if (kind === 'resume') this.listings = await listSources();
    const resuming = kind === 'resume';
    const intro = resuming ? resumed(this.standing()) : INTRO;
    const prompt = resuming ? 'Press Enter to continue setup' : 'Press Enter to start';
    const enter = resuming ? 'continue' : 'start';
    const actions = resuming
      ? [
          { key: 'g', label: 'change picks' },
          { key: 'x', label: 'abort' },
        ]
      : [];
    const { awaitKey, proceed } = await import('../../output/prompts.js');
    let answer: string | undefined;
    if (Splash.fits()) {
      const style = SPLASH_STYLES[this.flags.splash as SplashStyleName];
      const keys = [`enter ${enter}`, ...actions.map(a => `${a.key} ${a.label}`), 'esc cancel'];
      const splash = new Splash(this.t, { style, intro, prompt, keys });
      splash.start();
      try {
        answer = await awaitKey(actions.map(action => action.key));
      } finally {
        splash.end();
      }
    } else {
      answer = await this.introduce(intro, prompt, enter, actions);
    }
    // Not sure, it's asked again, under what's said already.
    while (answer === 'x' && !(await this.sure())) {
      const asked = await proceed(prompt, { enter, actions, theme: this.flags.theme });
      answer = asked.cancelled ? undefined : (asked.key ?? 'enter');
    }
    if (!answer) throw cancelled();
    return answer === 'x' ? 'abort' : answer === 'g' ? 'gather' : 'start';
  }

  /**
   * Whether to abort setup, said with what that drops, and
   * what stays imported.
   */
  private async sure(): Promise<boolean> {
    const picks = this.standing();
    const dropped = inWords(picks.filter(pick => pick.state !== 'done').map(pick => pick.name));
    const kept = picks.filter(pick => pick.state === 'done').map(pick => pick.name);
    const stays = kept.length === 1 ? 'stays' : 'stay';
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      'abort setup?',
      [
        { label: 'yes, abort', value: 'yes' },
        { label: 'no', value: 'no' },
      ],
      {
        inline: true,
        body: [
          this.t.muted(
            `  drops ${dropped}.${kept.length > 0 ? ` ${inWords(kept)} ${stays} imported.` : ''}`
          ),
        ],
        theme: this.flags.theme,
      }
    );
    if (stopped) throw cancelled();
    return value === 'yes';
  }

  /**
   * Abort setup: what's left of it is dropped, and what's
   * imported stays. Picks not imported are skipped, so `--yes` leaves them
   * too, and no export or todo is waited for, so the next run starts as the first did.
   */
  private async abort(): Promise<void> {
    const targets = this.settings.targets ?? [];
    const kept = targets.filter(target => this.imported(target));
    this.settings.targets = kept;
    this.settings.skipped = [
      ...(this.settings.skipped ?? []),
      ...targets
        .filter(target => !this.imported(target))
        .map(({ source, flags: { type: _type, ...flags } }) => ({ source, flags })),
    ];
    delete this.settings.wanted;
    delete this.settings.requested;
    delete this.settings.later;
    await this.save();
    this.logger.info('Setup aborted');
    const sources = unique(kept.map(target => target.source));
    this.hint(
      sources.length > 0
        ? `${inWords(sources)} ${sources.length === 1 ? 'stays' : 'stay'} imported. Run \`chronicle setup\` to start again.`
        : 'Run `chronicle setup` to start again.'
    );
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
      // The body first: drawing it can change what the checklist says, as the import's count does.
      const body = render(width, frame);
      const head = this.checklist(width, frame);
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

  /**
   * What the splash says, step by step or pick by pick, and Enter to start,
   * where the splash can't say it: `enter`, or the key of one of `actions`.
   */
  private async introduce(
    intro: Intro,
    prompt: string,
    enter: string,
    actions: { key: string; label: string }[]
  ): Promise<string> {
    const { title, text, note, steps } = intro;
    this.logger.emit({
      level: 'info',
      kind: 'guide',
      message: title,
      guide: {
        text: [...(text ?? []), ...(note ? [note] : [])],
        steps: steps.map(({ name, description, mark }) =>
          mark ? `${MARKS[mark]} ${name}  ${description}` : `${name} - ${description}`
        ),
      },
    });
    this.logger.flush();
    const { proceed } = await import('../../output/prompts.js');
    const { cancelled: stopped, key } = await proceed(prompt, {
      enter,
      actions,
      theme: this.flags.theme,
    });
    if (stopped) throw cancelled();
    return key ?? 'enter';
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
    // Full Disk Access is only a Mac's.
    const access = this.access && this.asking && process.platform === 'darwin';
    if (access && (await this.allowAccess(this.access!)) === 'later') {
      await this.putOff(this.access!);
    }
    const reopen = this.reopening;
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
      await this.waiting(targets);
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
    return where ? `it reads ${where}` : 'it reads what it found on this computer';
  }

  /**
   * A source with no way in setup can take: one that signs in some way setup
   * can't do for it, or isn't on this computer. Then what a scan says is in
   * its way, like gh signed out, or else where to see how it's read.
   */
  private nowhere(source: string): void {
    const online = this.listing(source)!.strategies.some(s => s.delivery === 'api');
    this.logger.info(
      online ? `Setup can't sign in to ${source} for you` : `Found no ${source} on this computer`
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
   * named, or not; its account, signed in to, or not yet with a provider
   * setup can sign in to; and what it reads on this computer, when that's here.
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
    // Only a source a folder could hold is looked for in one: by its export's layout or files, or its database.
    const findable = listing.strategies.some(
      s => s.layouts?.length || s.files?.length || s.databases?.length
    );
    const searched = findable ? unique([...(this.settings.folders ?? []), ...folders]) : [];
    for (const folder of searched) {
      const rows = await this.search(folder, () => {});
      for (const row of rows) {
        if (row.source === source && OFFERED.has(row.status)) found.push({ row, folder });
      }
    }
    const signedIn = await signedInTo(source);
    const ways: WayIn[] = [];
    for (const strategy of listing.strategies) {
      const here = found.find(f => f.row.strategy === strategy.name);
      if (strategy.delivery === 'api') {
        // Signed in some way a scan finds, like a token or another tool's login.
        if (here) ways.push({ strategy, row: here.row });
        // Signed in, by `chronicle auth login` or `auth set`.
        else if (signedIn)
          ways.push({ strategy, row: this.accountRow(listing, strategy.name, true) });
        else if (this.signsIn(source, strategy, providers) || accountless(strategy)) {
          ways.push({ strategy });
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
        known
          ? `Found no ${source} ${flag} on this computer`
          : `${source} has no strategy "${flag}"`,
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
   * Gather's looking: this computer, then the folders saved or named, never
   * others unasked, then the accounts already signed in to, each found
   * shown as it's found, for `gather` to offer.
   */
  private async scanHere(given: string[]): Promise<void> {
    const folders = unique([...(this.settings.folders ?? []), ...given]);
    this.folders = folders;
    const found: ScanRow[] = [];
    const { steps } = this;
    steps.set('gather', 'working', '');
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
            steps.note('gather', `${count(done)}/${count(total)}`);
            live?.redraw();
          },
        })
      );
      this.rows = rows;
      for (const folder of folders) {
        const known = new Set(found.map(row => rowKey(row)));
        const more = await this.stopped(
          this.search(folder, note => {
            steps.note('gather', note);
            live?.redraw();
          })
        );
        // What's ready, or a step away, as on this computer.
        for (const row of more.filter(r => OFFERED.has(r.status) && !known.has(rowKey(r)))) {
          found.push(row);
          this.folderOf.set(row, folder);
        }
      }
      const here = new Set(found.map(row => `${row.source}:${row.strategy}`));
      const accounts = await this.stopped(this.accounts(here));
      for (const row of accounts) this.accounted.add(row);
      found.push(...accounts);
    } finally {
      live?.stop();
      this.redraw = undefined;
    }
    this.offered = found.map(row => this.offer(row)).sort(bySource);
  }

  /**
   * The gather step: one list of what to import. First what was found,
   * here, in the folders, and the accounts signed in to, how much each
   * holds counted while it's up; then the services not found here, each
   * saying what it takes, a sign-in or an export, for prepare. `f` looks in
   * another folder, and what it turns up joins what was found. What's
   * found and picked is a target; a service picked is wanted. Without
   * asking, what's ready, and no services.
   */
  private async gather(): Promise<void> {
    const { steps } = this;
    if (!this.asking) {
      const picked = this.unasked(this.offered);
      await this.adopt(this.offered, picked);
      steps.set('gather', 'done', `${count(picked.length)} picked`);
      return;
    }
    const { multiSelect } = await import('../../output/prompts.js');
    let services = await this.services();
    const wanted = this.settings.wanted ?? [];
    const requested = this.settings.requested ?? [];
    const asked = (s: Service) =>
      requested.find(r => r.source === s.source && r.flags.strategy === s.way.name);
    let initial = [
      ...this.offered.filter(o => o.checked).map(o => foundKey(o)),
      ...services
        .filter(s => asked(s) || wanted.some(w => same(w, s.source, s.way.name)))
        .map(service => serviceKey(service)),
    ];
    const before = initial.length > 0;
    // What the last folder looked in turned up, said under the question.
    let searched = '';
    let values: string[];
    for (;;) {
      const offers = this.offered;
      steps.set('gather', 'asking', `${count(offers.length)} found`);
      this.countRows(offers.map(o => o.row));
      // What was found, a section for this computer and the accounts, then one for each folder looked in.
      const sections = new Map<string, Offer[]>([['', []]]);
      for (const folder of this.folders) sections.set(folder, []);
      for (const offer of offers) {
        const folder = this.folderOf.get(offer.row) ?? '';
        sections.set(folder, [...(sections.get(folder) ?? []), offer]);
      }
      const found: SelectOption[] = [];
      // Sections with nothing in them are said in a line each, above the next with something.
      let empty: string[] = [];
      for (const [folder, group] of sections) {
        const heading = folder
          ? `found in ${fromHome(folder, this.home)}`
          : [
              'found on this computer',
              // An account isn't on this computer, though it's here to pick.
              ...(group.some(o => this.accounted.has(o.row)) ? ['and your accounts'] : []),
            ].join(', ');
        if (group.length === 0) {
          empty.push(`${heading}: nothing`, '');
          continue;
        }
        found.push(
          ...this.options(group, {
            key: offer => foundKey(offer),
            heading: [...empty, heading].join('\n'),
            // In a folder's section, where in it.
            ...(folder && {
              label: (offer: Offer) =>
                offer.row.root
                  ? path.relative(folder, offer.row.root) || path.basename(offer.row.root)
                  : offer.label,
            }),
          })
        );
        empty = [];
      }
      // Scanning a folder is a section of its own, between what was found and the rest.
      found.push({
        label: '+ choose a folder to scan',
        value: ANOTHER,
        action: true,
        ...(searched && { description: searched }),
        heading: [
          ...empty,
          'scan a folder for exports',
          'point setup at a folder, like ~/Downloads, and it finds the exports it knows how to read.',
        ].join('\n'),
      });
      // A table: each service, what getting it ready takes, and what it gets, under headings that line up.
      const takes = (s: Service) => {
        const request = asked(s);
        return request ? `export requested ${request.at.slice(0, 10)}` : s.takes;
      };
      const names = Math.max(0, ...services.map(s => s.source.length));
      const widths = Math.max(0, ...services.map(s => takes(s).length));
      const add: SelectOption[] = services.map((service, i) => ({
        value: serviceKey(service),
        label: `${service.source.padEnd(names)}  ${takes(service).padEnd(widths)} `,
        description: service.gets,
        ...(i === 0 && {
          heading: [
            'everything else Chronicle can import',
            'select any you use, and setup helps you get each one in the next step.',
            '',
            `  ${'source'.padEnd(names + 2)}${'how to get it'.padEnd(widths + 2)}what you get`,
          ].join('\n'),
        }),
      }));
      const result = await multiSelect('pick what to import', [...found, ...add], {
        initial,
        none: true,
        enter: 'next',
        body: [
          this.t.muted(before ? '  selected: what you picked before.' : '  select what to import.'),
        ],
        actions: [{ key: 'f', label: 'scan a folder', value: ANOTHER }],
        onward: true,
        ...this.around(),
      });
      if (result.cancelled) throw cancelled();
      values = result.values.filter(value => value !== ANOTHER);
      if (!result.values.includes(ANOTHER)) break;
      initial = values;
      const folder = await this.askFolder();
      if (!folder) continue;
      const known = new Set(offers.map(o => rowKey(o.row)));
      let looked = fromHome(folder, this.home);
      const more = await this.spin(
        () => looked,
        () =>
          this.search(folder, note => {
            looked = note;
          })
      );
      const fresh = more.filter(row => OFFERED.has(row.status) && !known.has(rowKey(row)));
      for (const row of fresh) {
        const offer = this.offer(row);
        // Selected when it was picked before, or it's the export asked for.
        if (offer.checked) initial.push(foundKey(offer));
        offers.push(offer);
        this.folderOf.set(row, folder);
      }
      offers.sort(bySource);
      // What it found is a section of its own, above.
      searched = `${fromHome(folder, this.home)}: ${fresh.length > 0 ? `${count(fresh.length)} found, above` : 'nothing found'}`;
      services = await this.services();
    }
    const picks = new Set(values);
    const picked = this.offered.filter(o => picks.has(foundKey(o)));
    // A folder is looked in again next run only when something in it was picked.
    this.settings.folders = unique([
      ...(this.settings.folders ?? []),
      ...picked.flatMap(o => this.folderOf.get(o.row) ?? []),
    ]);
    await this.adopt(this.offered, picked);
    for (const offer of this.offered) offer.checked = picked.includes(offer);
    // What's no longer picked is no longer waited for.
    for (const service of services) {
      const { source, way } = service;
      if (picks.has(serviceKey(service))) this.want(source, way.name);
      else this.settle(source, way.name);
    }
    await this.save();
    const added = services.filter(service => picks.has(serviceKey(service))).length;
    steps.set('gather', 'done', `${count(picked.length + added)} picked`);
  }

  /**
   * A run that carries on, without gathering again: the picks as they
   * were, and what's here of just them looked for again, for what's in
   * each one's way. The folders saved are looked in again too, and an
   * export asked for that's come to one since is taken, as gather takes it.
   */
  private async keepPicks(): Promise<void> {
    const { targets = [], wanted = [], requested = [] } = this.settings;
    const picks = targets.length + wanted.length + requested.length;
    const sources = unique([...targets, ...wanted, ...requested].map(pick => pick.source));
    this.steps.set('gather', 'working', '');
    this.rows = await this.spin('checking your picks', async () => {
      [this.listings, this.extractors] = await Promise.all([
        listSources(),
        PluginScanner.scanAllPlugins(),
      ]);
      return (await scan({ sources })).rows;
    });
    const come: Offer[] = [];
    for (const folder of requested.length > 0 ? (this.settings.folders ?? []) : []) {
      let looked = fromHome(folder, this.home);
      const rows = await this.spin(
        () => `looking in ${looked}`,
        () =>
          this.search(folder, note => {
            looked = note;
          })
      );
      for (const row of rows) {
        const known = come.some(offer => rowKey(offer.row) === rowKey(row));
        if (row.status !== 'ready' || known) continue;
        if (this.arrived(row)) come.push(this.offer(row));
      }
    }
    if (come.length > 0) await this.adopt(come, come);
    const found = unique(come.map(offer => offer.row.source));
    this.steps.set(
      'gather',
      'done',
      `${count(picks)} ${plural('picks', picks)} kept` +
        (found.length > 0 ? ` ${glyphs.bullet} ${inWords(found)} found` : '')
    );
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

  /**
   * The accounts already signed in to, unless a scan found them, as
   * `source:strategy` in `here`, and the picks of a way in with no account.
   * A source found here another way, like its export, can still be read
   * from its account.
   */
  private async accounts(here: Set<string>): Promise<ScanRow[]> {
    const rows: ScanRow[] = [];
    for (const listing of this.listings) {
      const strategy = listing.strategies.find(s => s.delivery === 'api');
      if (!strategy || !listing.supported || listing.tier === 'legacy') continue;
      if (here.has(`${listing.source}:${strategy.name}`)) continue;
      if (accountless(strategy)) {
        rows.push(...this.given(listing, strategy.name));
        continue;
      }
      if (!(await signedInTo(listing.source))) continue;
      rows.push(this.accountRow(listing, strategy.name, true));
    }
    return rows;
  }

  /**
   * The picks of a way in with no account, as rows, as if a scan found
   * them: each by what it was given, like a username, so gather offers it
   * again, picked.
   */
  private given(listing: SourceListing, strategy: string): ScanRow[] {
    return (this.settings.targets ?? [])
      .filter(target => target.source === listing.source && target.flags.strategy === strategy)
      .map(target => {
        const { strategy: _strategy, type: _type, ...config } = target.flags;
        return {
          ...this.accountRow(listing, strategy, true),
          label: Object.values(config).map(String).join(' '),
          config,
          evidence: {},
        };
      });
  }

  /** After a plugin is installed: its sources, extractors, and what they find. */
  private async refresh(): Promise<void> {
    this.counter.refresh();
    this.signIns = undefined;
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

  /** A target's import into this store, as its record says, if it was imported. */
  private imported(target: Target): Imported | undefined {
    return imported(this.root, targetName(target, this.settings.targets ?? []), this.db);
  }

  /**
   * How many records a target's run would extract, by its survey, counted
   * once a run. Null when it can't say, or doesn't answer in time.
   */
  private countTarget(target: Target): Promise<number | null> {
    const key = targetKey(target);
    if (this.counts.has(key)) return Promise.resolve(this.counts.get(key)!);
    // Asked for twice while it's counted, as the plan and the import do, it's counted once.
    const counting = this.counting.get(key);
    if (counting) return counting;
    const counted = within(this.counter.target(target, this.since), SURVEY_TIMEOUT_MS).then(
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
    this.counting.set(key, counted);
    return counted;
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
    return {
      row,
      label: this.labelOf(row),
      note: () => this.note(row),
      checked: targeted || this.arrived(row),
    };
  }

  /**
   * Whether a row is an export that was asked for, come since it was: one
   * older, like an export from years ago in ~/Downloads, isn't the one
   * waited for, so the request stands.
   */
  private arrived(row: ScanRow): boolean {
    const asked = (this.settings.requested ?? []).find(
      r => r.source === row.source && r.flags.strategy === row.strategy
    );
    if (!asked || !row.root) return false;
    try {
      return statSync(row.root).mtimeMs >= Date.parse(asked.at);
    } catch {
      return false;
    }
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

  /**
   * Offers as a picker's options, their sources and labels lined up, each
   * valued by `key` and labeled by `label`, the first under `heading`.
   */
  private options(
    offers: Offer[],
    {
      key,
      heading,
      label = offer => offer.label,
    }: { key: (offer: Offer) => string; heading?: string; label?: (offer: Offer) => string }
  ): SelectOption[] {
    const sources = Math.max(0, ...offers.map(o => o.row.source.length));
    const labels = Math.min(48, Math.max(0, ...offers.map(o => label(o).length)));
    return offers.map((o, i) => ({
      value: key(o),
      label: `${o.row.source.padEnd(sources)}  ${truncatePath(label(o), labels).padEnd(labels)}`,
      // Read each time it's drawn, so a count fills in.
      get description() {
        return o.note();
      },
      ...(i === 0 && heading && { heading }),
    }));
  }

  /**
   * The offers taken without asking: those that need no step, ready with
   * their plugin installed, picked before, or on this computer and not
   * left unpicked before.
   */
  private unasked(offers: Offer[]): Offer[] {
    const skipped = this.settings.skipped ?? [];
    return offers.filter(
      o =>
        o.row.installed &&
        o.row.status === 'ready' &&
        (o.checked || (!o.row.root && !skipped.some(target => reads(target, o.row))))
    );
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
    if (plugins.length > 0) {
      await this.refresh();
      // Their rows say so now, so going back and on again doesn't install them again.
      for (const offer of [...offers, ...this.offered]) {
        offer.row.installed = this.listing(offer.row.source)?.installed ?? offer.row.installed;
      }
    }
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

  /** A folder to look in, asked for: none when Esc goes back. Ctrl-C ends setup, as at every question. */
  private async askFolder(): Promise<string | undefined> {
    const { input } = await import('../../output/prompts.js');
    const other = await input('path', {
      validate: value => existsSync(this.resolve(value)) || 'no such file or directory',
      body: [this.t.muted('  a folder or zip of exports, to look in.')],
      ...this.around(),
      back: true,
    });
    if (other.cancelled) throw cancelled();
    return other.back ? undefined : this.resolve(other.value);
  }

  /**
   * The strategies setup can get ready for a source that isn't here: a
   * sign-in it can do, what a source with no account needs, like a
   * username, or an export, with its plugin's steps or plain ones.
   */
  private ways(listing: SourceListing, providers: Set<string>): SourceListing['strategies'] {
    return listing.strategies.filter(
      s =>
        (s.delivery === 'api' && (this.signsIn(listing.source, s, providers) || accountless(s))) ||
        s.delivery === 'export'
    );
  }

  /**
   * Whether setup can sign a way in: in the browser, with a provider it
   * knows, or by keeping what's pasted, when the strategy's own steps say
   * how, like Pinboard's token.
   */
  private signsIn(
    source: string,
    strategy: ManifestStrategy | undefined,
    providers: Set<string>
  ): boolean {
    return (
      providers.has(providerFor(source)) ||
      Boolean(strategy?.setup?.some(step => 'sign-in' in step))
    );
  }

  /**
   * The services gather offers to add, a way in each, with what that takes
   * and what it gets: each export setup can walk through, even of a source
   * found here, since what's found may be small or old; and each sign-in it
   * can do, or need for a source with no account, unless it's here already.
   */
  private async services(): Promise<Service[]> {
    const providers = await this.providers();
    const here = this.here();
    const services: Service[] = [];
    for (const listing of this.listings.filter(l => l.supported && l.tier !== 'legacy')) {
      for (const way of this.ways(listing, providers)) {
        // An export can always be asked for again: one found may be small, or old.
        if (way.delivery !== 'export' && here.has(`${listing.source}:${way.name}`)) continue;
        const takes = await this.takes(listing.source, way);
        services.push({ source: listing.source, way, takes, gets: gets(way) });
      }
    }
    return services.sort((a, b) => a.source.localeCompare(b.source));
  }

  /**
   * What getting a way in ready takes, in a few words: signing in, to the
   * provider when it isn't the source's own, and making an app first when
   * there's no client yet; or an export, requested when it comes by email,
   * and how long it takes to come, as the plugin's steps say. Without steps
   * of its plugin's, it's requested, as setup's own steps say.
   */
  private async takes(source: string, way: ManifestStrategy): Promise<string> {
    if (way.delivery === 'api') {
      if (accountless(way)) return `type your ${asked(way.setup)}, no sign-in`;
      const provider = providerFor(source);
      const to = provider === source ? 'sign in' : `sign in to ${provider}`;
      if (!(await this.providers()).has(provider)) {
        // Signed in by what's pasted: a token made for it, or an app password.
        const asks = new Set(way.setup?.flatMap(step => ('ask' in step ? [step.ask] : [])));
        if (asks.has('token')) return `${to}, with a token you make`;
        if (asks.has('password')) return `${to}, with an app password`;
        return to;
      }
      return (await this.client(provider)) ? to : `${to}, with an app you make`;
    }
    if (!way.setup?.length) return 'request your data';
    const wait = way.setup.find(
      (step): step is { wait: string; via?: 'download' | 'email' } => 'wait' in step
    );
    if (!wait) return 'export, right away';
    const what = wait.via === 'email' ? 'request an export' : 'export';
    // `until the backup finishes` says when, not how long.
    return `${what}, ${wait.wait.replace(/^until /, 'once ')}`;
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

  /** Want a way in, for prepare, unless it's wanted already or its export asked for. */
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
   * longer where it was is asked for again, unless it was imported: one
   * deleted once its records are out is done with.
   */
  private async checkPicks(): Promise<void> {
    // A fix may take a target out of the list, which this loop's copy keeps.
    for (const target of this.settings.targets ?? []) {
      let checked = await this.check(target);
      if (checked.state === 'plugin' && this.asking) {
        await this.install(this.listing(target.source)!.plugin);
        await this.refresh();
        checked = await this.check(target);
      }
      if (checked.state === 'missing' && this.exported(target) && !this.imported(target)) {
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
   * A job for a target that's ready, not imported already, and not already
   * running: added to the run, counted meanwhile.
   */
  private queue(target: Target, again = this.flags.again): void {
    const targets = this.settings.targets ?? [];
    const name = targetName(target, targets);
    if (this.imported(target) && !again) return;
    if (this.jobs.some(job => targetKey(job.target) === targetKey(target))) return;
    const label = targetLabel(target, targets);
    const job: Job = { target, name, label, total: null, state: 'waiting', processed: 0 };
    this.started ||= Date.now();
    this.runner!.add(job);
    this.countTarget(target).then(total => {
      job.total = total;
    });
    this.noteImport();
  }

  /** The import step's note: how far it's got, or what it imported. */
  private noteImport(): void {
    const { jobs } = this;
    if (jobs.length === 0) {
      if (this.steps.state('import') !== 'done') this.steps.set('import', 'waiting', '');
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
      'import',
      going ? 'working' : 'done',
      failed > 0 ? `${amount} ${glyphs.bullet} ${count(failed)} failed` : amount
    );
  }

  /**
   * What's needed before the targets and wanted sources not ready yet can
   * be imported, as todos.
   */
  private async todos(): Promise<Todo[]> {
    const needs: Need[] = [];
    const providers = await this.providers();
    for (const target of this.settings.targets ?? []) {
      const state = this.states.get(target)?.state;
      const way = { source: target.source, strategy: String(target.flags.strategy) };
      if (state === 'full-disk-access') needs.push({ ...way, need: 'full-disk-access' });
      // One that signs in some other way, like gh's own login, is left for the end to say how.
      const strategy = this.strategy(target.source, target.flags.strategy);
      if (state === 'sign-in' && this.signsIn(target.source, strategy, providers)) {
        const provider = providerFor(target.source);
        const steps = strategy?.setup;
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

  /** The providers setup can sign in to, by `chronicle auth login`. */
  private async providers(): Promise<Set<string>> {
    if (!this.signIns) {
      const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
      this.signIns = new Set(await OAuthCommand.listProviders());
    }
    return this.signIns;
  }

  /**
   * Whether a provider signs in without the person making an app first.
   * One that doesn't sign in in the browser has no app, and its steps say
   * what to paste.
   */
  private async client(provider: string): Promise<boolean> {
    if (!(await this.providers()).has(provider)) return false;
    const { OAuthProviderRegistry } = await import('../../auth/ProviderRegistry.js');
    return (
      Boolean(OAuthProviderRegistry.get(provider)?.setup) ||
      Boolean((await CredentialManager.getCredentials(provider))?.clientId)
    );
  }

  /**
   * What a way in that's wanted needs before it can be imported: a sign-in,
   * with its plugin's steps, or an export, with its plugin's or plain ones.
   * Nothing once its provider is signed in to.
   */
  private async need(way: Way): Promise<Need | undefined> {
    const strategy = this.strategy(way.source, way.strategy);
    if (strategy?.delivery === 'api' && accountless(strategy)) {
      return { ...way, need: 'settings', steps: strategy.setup! };
    }
    if (strategy?.delivery === 'api') {
      const provider = providerFor(way.source);
      if (await signedInTo(way.source)) return undefined;
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
   * The prepare step: each todo, Full Disk Access first, then the least
   * work first, to do now or later. Later puts it at the back. Once all
   * that's left was put off, it's done, and they're kept for the next run.
   * False when Full Disk Access is being turned on, which means reopening
   * the terminal: the run ends there, and the next carries on.
   */
  private async prepare(): Promise<boolean> {
    // Full Disk Access is only a Mac's.
    const queue = order(await this.todos(), this.settings.later).filter(
      todo => todo.kind !== 'access' || process.platform === 'darwin'
    );
    this.access = queue.find(todo => todo.kind === 'access');
    const total = queue.length;
    if (total === 0) {
      this.steps.set('prepare', 'done', 'none');
      return true;
    }
    const { tally } = this;
    let turn = 0;
    let putOff = 0;
    while (queue.length > 0 && putOff < queue.length) {
      const todo = queue.shift()!;
      turn++;
      this.steps.set('prepare', 'asking', `${count(Math.min(turn, total))} of ${count(total)}`);
      const result =
        todo.kind === 'access'
          ? await this.allowAccess(todo)
          : todo.requested
            ? (await this.askExport(todo, 0))
              ? 'done'
              : 'later'
            : (await this.offerTodo(todo))
              ? await this.runTodo(todo)
              : 'later';
      if (result === 'reopen') return false;
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
    this.noteTodo();
    return true;
  }

  /** The prepare step's note, once it's through: what was done, and what's left. */
  private noteTodo(): void {
    const { done, waiting, failed, later } = this.tally;
    const parts = [
      done > 0 ? `${count(done)} done` : '',
      waiting > 0 ? `${count(waiting)} waiting` : '',
      failed > 0 ? `${count(failed)} failed` : '',
      later > 0 ? `${count(later)} later` : '',
    ].filter(Boolean);
    this.steps.set('prepare', 'done', parts.join(` ${glyphs.bullet} `) || 'none');
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
   * sign in; an export's end asking where it is. What it gets ready is
   * imported once prepare is through. `waiting` once an export is asked for
   * and not here yet; `later` when it's put off partway.
   */
  private async runTodo(todo: Todo): Promise<'done' | 'waiting' | 'failed' | 'later'> {
    const answers: Partial<Record<Answer, string>> = {};
    const { input } = await import('../../output/prompts.js');
    for (const [i, step] of todo.steps.entries()) {
      if ('open' in step) {
        // The first page opens with the todo's own button; a later one, with its own.
        if (i > 0 && !(await this.offerTodo(todo, i, 'open'))) return 'later';
        await this.openPage(step.open);
      } else if ('ask' in step) {
        const { value, cancelled: stopped } = await input(step.ask.replace('-', ' '), {
          validate: answer => answer.trim().length > 0 || stepText(step),
          // What signs in isn't shown as it's pasted.
          secret: ['token', 'password', 'client-secret'].includes(step.ask),
          ...this.around(() => this.todoLines(todo, i)),
        });
        if (stopped) throw cancelled();
        answers[step.ask] = value.trim();
      } else if ('sign-in' in step) {
        if (!(await this.signIn(step['sign-in'], answers, todo.ways))) return 'failed';
        await this.signedIn(todo);
      }
      // What to do there, and how long to wait, are said, not run.
    }
    // What was asked, with no sign-in after it, is the way in's flags.
    if (todo.kind === 'settings') await this.signedIn(todo, answers);
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

  /**
   * Sign in to a provider in the browser, with the client pasted, if any,
   * asking for the access the ways in need, like YouTube's from Google's
   * sign-in, and no more: whether it worked. One that doesn't sign in in
   * the browser keeps what was pasted, as `chronicle auth set` does: a
   * token, and a username; or a username and password, like Bluesky's
   * handle and app password, kept as its client, where its plugin reads them.
   */
  private async signIn(
    provider: string,
    answers: Partial<Record<Answer, string>>,
    ways: Way[]
  ): Promise<boolean> {
    if (!(await this.providers()).has(provider)) {
      const { token = '', username, password } = answers;
      await CredentialManager.removeCredentials(provider);
      await CredentialManager.storeCredentials(
        provider,
        {
          provider,
          access_token: token,
          token_type: 'static',
          created_at: new Date().toISOString(),
          ...(username && { username }),
        },
        password ? username : undefined,
        password
      );
      return true;
    }
    const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
    const add = unique(ways.flatMap(way => accessFor(way.source) ?? []));
    try {
      await new OAuthCommand(provider, {
        port: SIGN_IN_PORT,
        timeout: 300,
        openAtOnce: true,
        clientId: answers['client-id'],
        clientSecret: answers['client-secret'],
        ...(add.length > 0 && { add, onlyAdded: true }),
      }).execute();
    } catch (error) {
      if ((error as { exitCode?: number }).exitCode === 130) throw cancelled();
      this.logError(`Couldn't sign in to ${provider}`, error);
      return false;
    }
    return true;
  }

  /**
   * After a sign-in, or what a way in with no account needs was given:
   * each target it was in the way of, and each source wanted through it, a
   * target now, with what was given as its `flags`, is checked again, to
   * import.
   */
  private async signedIn(todo: Todo, flags: Record<string, string> = {}): Promise<void> {
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
      const row = {
        ...this.accountRow(this.listing(way.source) ?? listing, way.strategy, true),
        config: flags,
      };
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
   * Check a target again: once it's ready, the import step takes it. A
   * source set up alone is left for `chronicle extract`.
   */
  private async ready(target: Target): Promise<void> {
    this.states.set(target, await this.check(target));
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
   * path as it is. True once it's found and a target, to import.
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
        back: true,
      });
      if (answer.cancelled) throw cancelled();
      if (answer.back) continue;
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
   * The import step: each pick that's ready and not imported already, the
   * last year of it into the store, one at a time, said live under the
   * checklist. Ctrl-C stops them, and setup. Then what was imported.
   */
  private async importAll(): Promise<void> {
    mkdirSync(this.root, { recursive: true });
    // Made here, once, so the imports open a store that's there already.
    const { openStore } = await import('../../persistence/store.js');
    openStore(this.db).close();
    const runner = new JobRunner(this.jobs, {
      root: this.root,
      db: this.db,
      bin: path.join(this.config.root, 'bin', 'run.js'),
      since: this.since.toISOString(),
      // One at a time: two imports writing to one store fight over its lock.
      concurrency: 1,
      onEvent: (job, event) => this.events.push({ job, event }),
      onChange: () => {
        this.noteImport();
        this.redraw?.();
      },
    });
    this.runner = runner;
    runner.run().catch(() => {});
    if (!this.later) for (const target of this.importing()) this.queue(target);
    this.noteImport();
    if (this.jobs.some(job => job.state === 'running' || job.state === 'waiting')) {
      const live = this.live((width, frame) => {
        // The counts go up between a job's changes, so the checklist's is said again each time.
        this.noteImport();
        return liveLines(this.jobs, this.started, this.t, width, frame);
      });
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
    this.noteImport();
    const before = (this.settings.targets ?? []).some(target => this.imported(target));
    if (this.later) this.steps.set('import', 'waiting', 'later');
    // Nothing imported ever, it isn't through.
    else if (this.jobs.length === 0) {
      this.steps.set('import', before ? 'done' : 'waiting', before ? 'nothing new' : 'nothing yet');
    }
    await this.report();
    if (this.jobs.some(job => job.state === 'failed')) throw new Errors.ExitError(1);
  }

  /**
   * Full Disk Access, first in prepare: now, by System Settings, or later.
   * Now ends the run, since turning it on means quitting the terminal and
   * opening it again, and the next run carries on.
   */
  private async allowAccess(todo: Todo): Promise<'reopen' | 'later'> {
    const { app } = await terminal();
    const sources = unique(todo.ways.map(way => way.source));
    const steps = [
      `  1  open system settings`,
      `  2  turn on ${app} under full disk access`,
      `  3  quit ${app} and open it again`,
      `  4  run ${this.again()} to carry on`,
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
    if (value !== 'go') return 'later';
    this.reopening = app;
    await this.config.runCommand('setup:full-disk-access', ['--open']);
    return 'reopen';
  }

  /**
   * How a run ends once Full Disk Access is being turned on, before the
   * import: the checklist, at prepare, then what's left, and to reopen the
   * terminal before carrying on.
   */
  private reopen(): void {
    const app = this.reopening!;
    this.steps.set('prepare', 'asking', `reopen ${app}`);
    this.print([...this.checklist(this.width(), 0), '']);
    this.unfinished(
      this.standing().map(pick => pick.source),
      `Turn on ${app} under Full Disk Access, then quit ${app} and open it again.`
    );
  }

  /**
   * The checklist as it ends, then what was imported, this run and before;
   * where the store is; then what's still waiting, and why.
   */
  private async report(): Promise<void> {
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
        [
          'import',
          ...targetArgs(job.target),
          '--since',
          this.since.toISOString(),
          ...(this.flags.db ? ['--db', this.db] : []),
        ],
        this.home
      );
      this.print(finishedLines(job, names, command, this.t, this.width()));
    }
    const ran = new Set(this.jobs.map(job => targetKey(job.target)));
    const done = [
      ...targets
        .filter(target => !ran.has(targetKey(target)))
        .flatMap(target => {
          const record = this.imported(target);
          return record ? [{ target, records: record.records }] : [];
        }),
      ...this.jobs
        .filter(job => job.state === 'done')
        .map(job => ({ target: job.target, records: job.processed })),
    ];
    if (done.length > 0) {
      const { lines } = table(
        {
          headings: ['source', 'records'],
          cells: done.map(({ target, records }) => [targetLabel(target, targets), count(records)]),
          numeric: [false, true],
        },
        tokens({ stream: 'stdout', theme: this.flags.theme }),
        stdoutWidth()
      );
      for (const text of lines) this.log(text);
    }
    const { jobs } = this;
    const records = jobs.reduce((n, job) => n + (job.state === 'done' ? job.processed : 0), 0);
    const imported = jobs.filter(job => job.state === 'done').length;
    const failed = jobs.filter(job => job.state === 'failed').length;
    if (jobs.length > 0) {
      const title = `Imported ${count(imported)} ${plural('sources', imported)}`;
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
          output: fromHome(this.db, this.home),
        },
      });
    } else if (checklist.length === 0) {
      // Without the checklist, which says it: later, nothing new, or nothing yet.
      this.logger.info(
        this.later
          ? 'Import left for later'
          : done.length > 0
            ? 'Nothing new to import'
            : 'Nothing to import yet'
      );
    }
    if (done.length > 0) {
      // The summary says where the store is; without one, this does.
      const where = jobs.length > 0 ? '' : `They're in ${fromHome(this.db, this.home)}. `;
      this.hint(`${where}Use \`--again\` to import them again.`);
    }
    await this.waiting(
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
  private async waiting(targets: Target[]): Promise<void> {
    const { states } = this;
    // Loading them loads every plugin: only when a sign-in is in the way.
    const providers = targets.some(target => states.get(target)!.state === 'sign-in')
      ? await this.providers()
      : new Set<string>();
    const by = (state: Checked['state']) =>
      targets.filter(target => states.get(target)!.state === state).map(t => t.source);
    // A sign-in setup can't do, like gh's own login, says how it's done.
    const signsIn = (target: Target) =>
      this.signsIn(target.source, this.strategy(target.source, target.flags.strategy), providers);
    const signIns = targets
      .filter(target => states.get(target)!.state === 'sign-in' && signsIn(target))
      .map(target => target.source);
    for (const target of targets) {
      if (states.get(target)!.state !== 'sign-in' || signsIn(target)) continue;
      const remedy = this.rows.find(row => reads(target, row))?.remedy;
      this.hint(
        remedy ??
          `${target.source} needs sign-in. Run \`chronicle auth set ${providerFor(target.source)}\` to sign in.`
      );
    }
    if (!this.asking) {
      const access = by('full-disk-access');
      if (access.length > 0) {
        this.hint(
          `${unique(access).join(', ')} ${access.length === 1 ? 'needs' : 'need'} Full Disk Access. ${FULL_DISK_ACCESS}`
        );
      }
      for (const source of unique(signIns)) {
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
    if (this.asking) {
      // Last, so it's what the run ends on.
      const picked = this.settings.targets ?? [];
      this.unfinished([
        ...picked.filter(target => !this.imported(target)).map(target => target.source),
        ...signIns,
        ...(this.access ? by('full-disk-access') : []),
        ...(this.settings.wanted ?? []).map(way => way.source),
        ...(this.settings.requested ?? []).map(asked => asked.source),
      ]);
      return;
    }
    for (const asked of (this.settings.requested ?? []).filter(r => this.mine(r.source))) {
      this.hint(
        `Waiting for ${asked.source}'s export, asked for ${date(new Date(asked.at)).slice(0, 10)}.`
      );
    }
  }

  /**
   * How a run ends with something of `sources` left to do, set apart so it
   * isn't missed: where each of their picks stands, as the next run's
   * splash will say, anything to do first, and the command that continues.
   * Nothing when there's nothing left.
   */
  private unfinished(sources: string[], first?: string): void {
    const left = new Set(sources.filter(source => this.mine(source)));
    const picks = this.standing().filter(pick => pick.state !== 'done' && left.has(pick.source));
    if (picks.length === 0) return;
    const names = Math.max(...picks.map(pick => pick.name.length));
    this.logger.emit({
      level: 'info',
      kind: 'guide',
      message: this.alone ? `${this.alone} isn't ready yet` : "Setup isn't finished",
      guide: {
        text: [
          ...picks.map(pick => `${MARKS[pick.state]} ${pick.name.padEnd(names)}  ${pick.text}`),
          ...(first ? ['', first] : []),
          '',
          `Run \`${this.again()}\` to continue.`,
        ],
      },
    });
  }
}
