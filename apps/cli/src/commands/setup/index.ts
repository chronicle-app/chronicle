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
  type SplashStyleName,
  plural,
  stdoutWidth,
  table,
  tokens,
  truncatePath,
  type Tokens,
} from '../../output/index.js';
import { listSources, type SourceListing } from '../../plugins/catalog.js';
import { PluginScanner, type ExtractorMetadata } from '../../plugins/PluginScanner.js';
import { fromHome, scan, scanPath, type ScanRow } from '../../plugins/scan.js';
import { surveyRow } from '../../plugins/survey.js';
import { finishedLines, liveLines, scanningLines } from '../../setup/display.js';
import { JobRunner, finishedFile, targetFile, type Job } from '../../setup/jobs.js';
import {
  checkTarget,
  commandLine,
  kindsFor,
  providerFor,
  reads,
  stateText,
  surveyTarget,
  targetArgs,
  targetFor,
  targetKey,
  targetLabel,
  targetName,
  type Checked,
  type Target,
} from '../../setup/targets.js';
import { INTRO } from '../../setup/intro.js';
import { allKinds } from '../../utils/recordKinds.js';
import { exportsAndDatabases, statusText } from '../scan.js';
import { within } from '../survey.js';
import { terminal } from './full-disk-access.js';

/** Longest a survey may take before its count is left out. */
const SURVEY_TIMEOUT_MS = 30_000;

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
  /** Picked to start with. */
  checked: boolean;
}

/** The scan statuses a picker offers: what's ready, or a step away. */
const OFFERED = new Set(['ready', 'blocked', 'signed-out']);

/** What a row reads, to tell whether a folder looked in twice found it again. */
const rowKey = (row: ScanRow) => targetKey(targetFor(row, []));

/** The value of the picker's row that looks in another folder. */
const ANOTHER = '';
/** The value of the folder question's row that looks in none; a folder's is its whole path. */
const NOWHERE = 'nowhere';

/**
 * `chronicle setup [folder…]`: find what this Mac holds, in folders of
 * exports, and in online accounts; pick what to bring in; get what's in the
 * way out of it; then extract the last year of each pick to a JSON Lines
 * file. Only the picks are saved. Each run works out again what stands in
 * each one's way, and a pick with a finished file is skipped.
 */
export default class Setup extends BaseCommand<typeof Setup> {
  static override hidden = true;

  static override summary = 'Pick your sources and extract them';

  static override description =
    'Looks around this computer, in folders of exports, and at online accounts, asks which to ' +
    'extract, and helps with what is in the way, like Full Disk Access or a sign-in. Then ' +
    'extracts each to a JSON Lines file. Run it again to carry on where it stopped.';

  static override examples = [
    'chronicle setup',
    'chronicle setup ~/Downloads/takeout',
    'chronicle setup --yes',
  ];

  static override strict = false;

  static override args = {
    folder: Args.string({ description: 'Folders to look in for exports', required: false }),
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
  /** How many records each target's run would extract, by its key. */
  private counts = new Map<string, number | null>();
  /** How many records each row holds: undefined while it's counted, null when it can't say. */
  private held = new Map<ScanRow, number | null | undefined>();
  /** Draws the picker again, while one is up. */
  private redraw?: () => void;
  /** Every survey started, to wait for before exiting, so each puts away its copy. */
  private surveys: Promise<unknown>[] = [];
  private readonly since = yearAgo();
  private readonly home = os.homedir();
  private t!: Tokens;

  /** Whether to ask, or take what's ready. */
  private get asking(): boolean {
    return !this.flags.yes;
  }

  async run(): Promise<void> {
    const { argv } = await this.parse(Setup);
    if (!this.flags.yes && !canAsk()) {
      this.fail('Setup asks which sources to extract', {
        hint: 'Run it at a terminal, or use `--yes` to extract what is ready without asking.',
      });
    }
    this.t = tokens({ stream: 'stderr', theme: this.flags.theme });
    this.manager = new ConfigManager(this.config.configDir);
    this.settings = structuredClone(await this.manager.loadConfig());
    const folders = (argv as string[]).map(folder => this.resolve(folder));
    const root = this.flags.output
      ? this.resolve(this.flags.output)
      : path.join(this.config.dataDir, 'extracts');
    try {
      if (this.asking && !this.flags.quiet) {
        // Plugins load while the logo plays and the steps are read, so the scan starts at once.
        const loading = Promise.all([
          listSources(),
          PluginScanner.scanAllPlugins(),
          PluginScanner.scanAllLocators(),
        ]);
        loading.catch(() => {});
        // A first run says what's ahead, and asks to start, as the logo comes on.
        const first = !this.settings.targets?.length;
        const style = SPLASH_STYLES[this.flags.splash as SplashStyleName];
        if (first && Splash.fits()) {
          const splash = new Splash(this.t, {
            style,
            intro: INTRO,
            prompt: 'Press Enter to start',
          });
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
          if (Splash.fits()) await new Splash(this.t, { style }).play();
          if (first) await this.introduce();
        }
      }
      await this.lookAround();
      if (!(await this.allowAccess())) return;
      let more = !this.settings.targets?.length || folders.length > 0;
      if (!more) {
        await this.checklist(root);
        more = await this.lookForMore();
      }
      if (more) {
        await this.pickSources(folders);
        await this.pickAccounts();
      }
      await this.extract(root, await this.fixAll());
    } finally {
      await Promise.allSettled(this.surveys);
    }
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

  /** `work`, with a spinner and `text`, which may change, meanwhile at a terminal. */
  private async spin<T>(text: string | (() => string), work: () => Promise<T>): Promise<T> {
    const live =
      process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((width, frame) => [
            line(
              [
                [glyphs.spinner[frame % glyphs.spinner.length], this.t.accent],
                [` ${typeof text === 'string' ? text : text()}`],
              ],
              width
            ),
          ])
        : undefined;
    live?.start();
    try {
      return await work();
    } finally {
      live?.stop();
    }
  }

  /** What setup does, step by step, and Enter to start, where the splash can't say it. */
  private async introduce(): Promise<void> {
    const { title, text, note, steps } = INTRO;
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
    const { cancelled: stopped } = await proceed('Press Enter to start', {
      theme: this.flags.theme,
    });
    if (stopped) throw cancelled();
  }

  /**
   * Look around this computer, showing at a terminal what's found as it's
   * found. Done once the scan is: what each holds is counted after, while
   * the questions are up, so counting doesn't hold up the scan.
   */
  private async lookAround(): Promise<void> {
    const title = 'Looking around this computer';
    const found: ScanRow[] = [];
    let progress = 'Looking for sources';
    const live =
      process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((width, frame) =>
            scanningLines(
              title,
              found.map(row => ({ source: row.source, label: row.label, note: this.note(row) })),
              progress,
              this.t,
              width,
              frame,
              process.stderr.rows || 24
            )
          )
        : undefined;
    this.redraw = () => live?.redraw();
    this.print(['']);
    live?.start();
    try {
      [this.listings, this.extractors] = await Promise.all([
        listSources(),
        PluginScanner.scanAllPlugins(),
      ]);
      const { rows } = await scan({
        onSource({ rows: more, done, total }) {
          const offered = more.filter(row => OFFERED.has(row.status));
          found.push(...offered);
          progress = `Checked ${count(done)} of ${count(total)} sources`;
          live?.redraw();
        },
      });
      this.rows = rows;
    } finally {
      live?.stop();
      this.redraw = undefined;
    }
    const sources = new Set(found.map(row => row.source)).size;
    this.summary(
      sources > 0
        ? `Found ${count(sources)} ${plural('sources', sources)} on this computer`
        : 'Found nothing on this computer to extract'
    );
  }

  /**
   * Straight after the scan, before anything's counted: when it found
   * sources macOS keeps from the terminal, offer Full Disk Access, which
   * takes reopening the terminal. Those skipped before aren't asked about
   * again. False when reopening is next.
   */
  private async allowAccess(): Promise<boolean> {
    if (process.platform !== 'darwin' || !this.asking) return true;
    const skipped = this.settings.skipped ?? [];
    const blocked = this.rows.filter(
      row => row.status === 'blocked' && !skipped.some(target => reads(target, row))
    );
    const names = unique(blocked.map(row => row.source));
    if (names.length === 0) return true;
    const { confirm } = await import('../../output/prompts.js');
    const { confirmed, cancelled: stopped } = await confirm(
      `${names.join(', ')} ${names.length === 1 ? 'needs' : 'need'} Full Disk Access. Turn it on now?`,
      { defaultValue: true, theme: this.flags.theme }
    );
    if (stopped) throw cancelled();
    if (!confirmed) return true;
    await this.config.runCommand('setup:full-disk-access', []);
    const { app } = await terminal();
    this.hint(`Quit ${app} and open it again, then run \`chronicle setup\` to continue.`);
    return false;
  }

  /** After a plugin is installed: its sources, extractors, and what they find. */
  private async refresh(): Promise<void> {
    this.listings = await listSources();
    this.extractors = await PluginScanner.scanAllPlugins();
    this.rows = (await scan()).rows;
  }

  private listing(source: string): SourceListing | undefined {
    return this.listings.find(listing => listing.source === source);
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
    const strategy = this.listing(target.source)?.strategies.find(
      s => s.name === target.flags.strategy
    );
    return strategy?.delivery === 'export';
  }

  /** What a target extracted last time, from the file beside its records. */
  private extracted(root: string, name: string): number | undefined {
    try {
      return JSON.parse(readFileSync(targetFile(root, name), 'utf8')).records;
    } catch {
      return undefined;
    }
  }

  /** The picks so far, each with its file or what's in its way, and the exports asked for. */
  private async checklist(root: string): Promise<void> {
    const targets = this.settings.targets ?? [];
    const labels = targets.map(target => targetLabel(target, targets));
    const width = Math.max(...labels.map(label => label.length));
    const lines: string[] = [];
    for (const [i, target] of targets.entries()) {
      const name = targetName(target, targets);
      const file = finishedFile(root, name);
      if (existsSync(file)) {
        const records = this.extracted(root, name);
        lines.push(
          line(
            [
              [glyphs.success, this.t.success],
              [` ${labels[i].padEnd(width)}  `],
              [records === undefined ? '' : `${count(records)} ${plural('records', records)}  `],
              [fromHome(file, this.home), this.t.muted],
            ],
            stdoutWidth()
          )
        );
        continue;
      }
      const checked = await this.check(target);
      const ready = checked.state === 'ready';
      lines.push(
        line(
          [
            [ready ? glyphs.bullet : glyphs.warning, ready ? this.t.muted : this.t.warning],
            [` ${labels[i].padEnd(width)}  `],
            [stateText(checked, this.exported(target)), this.t.muted],
          ],
          stdoutWidth()
        )
      );
    }
    for (const asked of this.settings.requested ?? []) {
      lines.push(
        line(
          [
            [glyphs.warning, this.t.warning],
            [` ${asked.source.padEnd(width)}  `],
            [`waiting for its export, asked for ${asked.at.slice(0, 10)}`, this.t.muted],
          ],
          stdoutWidth()
        )
      );
    }
    this.print(lines);
  }

  private async lookForMore(): Promise<boolean> {
    if (!this.asking) return false;
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled: stopped } = await select(
      'Extract now, or look for more sources?',
      [
        { label: 'Extract now', value: 'extract' },
        { label: 'Look for more sources', value: 'more' },
      ],
      { theme: this.flags.theme }
    );
    if (stopped) throw cancelled();
    return value === 'more';
  }

  /**
   * How many records a target's run would extract, by its survey, counted
   * once a run. Null when it can't say, or doesn't answer in time.
   */
  private countTarget(target: Target): Promise<number | null> {
    const key = targetKey(target);
    if (this.counts.has(key)) return Promise.resolve(this.counts.get(key)!);
    const survey = surveyTarget(target, this.extractors.get(target.source) ?? [], this.since);
    this.surveys.push(survey);
    return within(survey, SURVEY_TIMEOUT_MS).then(
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

  /**
   * What a scan found, as a picker offers it: ready ones checked, unless
   * skipped before, and how much each holds once it's counted.
   */
  private offer(row: ScanRow): Offer {
    const targeted = (this.settings.targets ?? []).some(target => reads(target, row));
    const skipped = (this.settings.skipped ?? []).some(target => reads(target, row));
    const ready = row.status === 'ready' && row.installed;
    const label = row.root ? fromHome(row.root, this.home) : row.label;
    return { row, label, note: () => this.note(row), checked: targeted || (ready && !skipped) };
  }

  /** What's in a row's way, or how much it holds: `2,113 commands`. */
  private note(row: ScanRow): string {
    if (row.status !== 'ready' || !row.installed) return statusText(row);
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
      const survey = surveyRow(row, this.extractors);
      this.surveys.push(survey);
      within(survey, SURVEY_TIMEOUT_MS).then(
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
   * Ask which offers to take, with a row to look in another folder when
   * `another` is set: true when that's what was picked. Without asking,
   * those checked that need no step: ready, with their plugin installed.
   */
  private async pick(
    message: string,
    offers: Offer[],
    another = false
  ): Promise<{ picked: Offer[]; another: boolean }> {
    if (!this.asking) {
      const picked = offers.filter(o => o.checked && o.row.installed && o.row.status === 'ready');
      return { picked, another: false };
    }
    if (offers.length === 0 && !another) return { picked: [], another: false };
    const sources = Math.max(0, ...offers.map(o => o.row.source.length));
    const labels = Math.min(48, Math.max(0, ...offers.map(o => o.label.length)));
    const { multiSelect } = await import('../../output/prompts.js');
    const result = await multiSelect(
      message,
      [
        ...offers.map((o, i) => ({
          value: String(i),
          label: `${o.row.source.padEnd(sources)}  ${truncatePath(o.label, labels).padEnd(labels)}`,
          get description() {
            return o.note();
          },
        })),
        ...(another
          ? [{ value: ANOTHER, label: `Look in another folder${glyphs.ellipsis}`, action: true }]
          : []),
      ],
      {
        initial: offers.flatMap((o, i) => (o.checked ? [String(i)] : [])),
        // Unpicking them all picks none of them.
        none: true,
        subscribe: redraw => {
          this.redraw = redraw;
          return () => {
            this.redraw = undefined;
          };
        },
        theme: this.flags.theme,
      }
    );
    if (result.cancelled) throw cancelled();
    return {
      picked: result.values.filter(value => value !== ANOTHER).map(value => offers[Number(value)]),
      another: result.values.includes(ANOTHER),
    };
  }

  /** Install a plugin, as `chronicle plugins install` does. */
  private async install(plugin: string): Promise<void> {
    const { installPlugin, resolveInstallTarget } = await import('../../plugins/install.js');
    this.logger.info(`Installing ${plugin}`);
    try {
      await installPlugin(await resolveInstallTarget(plugin, this.config.version));
    } catch (error) {
      this.logError(`Couldn't install ${plugin}`, error);
      return;
    }
    this.summary(`Installed ${plugin}`);
  }

  /** Which kinds to extract of a source with no defaults, as `extract` asks. Undefined without asking. */
  private async askKinds(row: ScanRow): Promise<string[] | undefined> {
    const pool = (this.extractors.get(row.source) ?? []).filter(e => e.strategy === row.strategy);
    if (!this.asking || pool.length === 0) return undefined;
    const { multiSelect } = await import('../../output/prompts.js');
    const result = await multiSelect(
      `Which ${row.source} records?`,
      allKinds(pool).map(kind => ({
        label: kind,
        value: kind,
        description: pool.find(e => e.recordType.includes(kind))?.description,
      })),
      { theme: this.flags.theme }
    );
    if (result.cancelled) throw cancelled();
    return result.values;
  }

  /**
   * Make the picks targets, and the rest skipped, and save them: a pick's
   * plugin installed first, since its kinds come from it. A target picked
   * before keeps its kinds.
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
      if (before) {
        targets.push(before);
        continue;
      }
      const kinds = this.rowKinds(offer.row);
      const chosen = kinds.length > 0 ? kinds : await this.askKinds(offer.row);
      if (chosen?.length) targets.push(targetFor(offer.row, chosen));
    }
    this.settings.targets = targets;
    this.settings.skipped = skipped;
    await this.save();
  }

  /**
   * The exports and databases a scan finds in a folder, one export's sources
   * together, said once it's looked: how many, and each, so what a folder
   * turned up is plain before it joins the list. Nothing, said why, when it
   * can't be looked in.
   */
  private async lookIn(folder: string): Promise<ScanRow[]> {
    const where = fromHome(folder, this.home);
    let looked = 0;
    let rows: ScanRow[];
    try {
      ({ rows } = await this.spin(
        () =>
          `Looking in ${where}${looked > 0 ? `  ${count(looked)} ${plural('folders', looked)}` : ''}`,
        () =>
          scanPath(folder, {
            onFolder(n) {
              looked = n;
            },
          })
      ));
    } catch (error) {
      this.logError(`Couldn't look in ${where}`, error);
      return [];
    }
    const found = rows.filter(row => row.status !== 'unsupported');
    if (found.length === 0) {
      this.logger.info(`Nothing to extract in ${where}`);
      return [];
    }
    const roots = unique(found.map(row => row.root));
    found.sort((a, b) => roots.indexOf(a.root) - roots.indexOf(b.root));
    this.summary(`Found ${exportsAndDatabases(found)} in ${where}`);
    const sources = Math.max(...found.map(row => row.source.length));
    this.print(
      found.map(row =>
        line([[`    ${row.source.padEnd(sources)}  `], [row.label, this.t.muted]], stdoutWidth())
      )
    );
    return found;
  }

  /** A folder to look in, asked for: none when the question is cancelled. */
  private async askFolder(): Promise<string | undefined> {
    const { input } = await import('../../output/prompts.js');
    const other = await input('Folder to look in', {
      theme: this.flags.theme,
      validate: value => existsSync(this.resolve(value)) || 'Nothing there',
    });
    return other.cancelled ? undefined : this.resolve(other.value);
  }

  /**
   * Which folders to look in for exports: Downloads, checked until a run
   * leaves it out, and those saved or named, checked. "Another folder…"
   * adds one, checked, and asks again. "Don't look in any folders" takes
   * none, and is checked when nothing else is. Without asking, those saved
   * or named.
   */
  private async chooseFolders(given: string[]): Promise<string[]> {
    const saved = this.settings.folders;
    const named = unique([...(saved ?? []), ...given]);
    if (!this.asking) return named;
    const downloads = path.join(this.home, 'Downloads');
    const offered = unique([...(existsSync(downloads) ? [downloads] : []), ...named]);
    let chosen = saved === undefined ? offered : named;
    const { multiSelect } = await import('../../output/prompts.js');
    for (;;) {
      const result = await multiSelect(
        'Look for exports in',
        [
          ...offered.map(folder => ({ label: fromHome(folder, this.home), value: folder })),
          { label: `Another folder${glyphs.ellipsis}`, value: ANOTHER, action: true },
          { label: "Don't look in any folders", value: NOWHERE, alone: true },
        ],
        {
          initial: chosen.length > 0 ? chosen : [NOWHERE],
          none: true,
          theme: this.flags.theme,
        }
      );
      if (result.cancelled) throw cancelled();
      chosen = result.values.filter(value => value !== ANOTHER && value !== NOWHERE);
      if (!result.values.includes(ANOTHER)) return chosen;
      const folder = await this.askFolder();
      if (!folder) continue;
      if (!offered.includes(folder)) offered.push(folder);
      if (!chosen.includes(folder)) chosen.push(folder);
    }
  }

  /**
   * Pick from what a scan finds, as `chronicle scan` lists it: what's on this
   * computer, and the exports in the folders picked to look in. How much each
   * holds fills in while the questions are up. Looking in another folder
   * from the list adds what's there and asks again, keeping what was picked.
   */
  private async pickSources(given: string[]): Promise<void> {
    const here = this.rows.filter(row => OFFERED.has(row.status));
    // Counted while the folders are picked.
    this.countRows(here);
    const folders = await this.chooseFolders(given);
    this.settings.folders = folders;
    await this.save();
    const rows = [...here];
    for (const folder of folders) rows.push(...(await this.lookIn(folder)));
    const offers = rows.map(row => this.offer(row));
    let picked: Offer[];
    for (;;) {
      this.countRows(offers.map(o => o.row));
      const answer = await this.pick('Pick what to extract', offers, true);
      picked = answer.picked;
      if (!answer.another) break;
      for (const offer of offers) offer.checked = picked.includes(offer);
      const folder = await this.askFolder();
      if (!folder) continue;
      if (!folders.includes(folder)) folders.push(folder);
      const known = new Set(offers.map(o => rowKey(o.row)));
      for (const row of await this.lookIn(folder)) {
        if (!known.has(rowKey(row))) offers.push(this.offer(row));
      }
    }
    this.settings.folders = folders;
    await this.adopt(offers, picked);
  }

  /**
   * Pick online accounts: Google's sources, with a guided sign-in, and any
   * other source already signed in. The rest are named, with where to start.
   */
  private async pickAccounts(): Promise<void> {
    if (!this.asking) return;
    const here = new Set(this.rows.map(row => row.source));
    const offers: Offer[] = [];
    const rest: string[] = [];
    for (const listing of this.listings) {
      const strategy = listing.strategies.find(s => s.delivery === 'api');
      if (
        !strategy ||
        !listing.supported ||
        listing.tier === 'legacy' ||
        here.has(listing.source)
      ) {
        continue;
      }
      const provider = providerFor(listing.source);
      const signedIn = await CredentialManager.hasCredentials(provider);
      if (provider !== 'google' && !signedIn) {
        rest.push(listing.source);
        continue;
      }
      const row: ScanRow = {
        source: listing.source,
        strategy: strategy.name,
        label: provider === 'google' ? 'Google account' : `${provider} account`,
        status: signedIn ? 'ready' : 'signed-out',
        installed: listing.installed,
        plugin: listing.plugin,
        config: {},
        command: '',
        evidence: {},
      };
      const offer = this.offer(row);
      offers.push({ ...offer, note: () => (signedIn ? 'signed in' : 'needs sign-in') });
    }
    const { picked } = await this.pick('Pick online accounts to extract', offers);
    await this.adopt(offers, picked);
    if (rest.length === 0) return;
    // Those with a provider sign in in the browser, with an app of the person's own.
    const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
    const providers = new Set(await OAuthCommand.listProviders());
    const browser = rest.filter(source => providers.has(providerFor(source)));
    const other = rest.filter(source => !browser.includes(source));
    if (browser.length > 0) {
      this.hint(
        `${browser.join(', ')} need an app of your own to sign in with. Run ` +
          `\`chronicle auth login ${browser[0]} --client-id <id> --client-secret <secret>\` to sign in.`
      );
    }
    if (other.length > 0) {
      this.hint(
        `${other.join(', ')} need a token or a name. ` +
          `Run \`chronicle extract ${other[0]} --help\` to see what.`
      );
    }
  }

  /**
   * Each target, with what's in its way fixed where setup can: its plugin
   * installed, or Google signed in to. An export no longer where it was is
   * asked for again. Each fix is checked again, since one target can need two.
   */
  private async fixAll(): Promise<Map<Target, Checked>> {
    const states = new Map<Target, Checked>();
    // A fix may take a target out of the list, which this loop's copy keeps.
    for (const target of this.settings.targets ?? []) {
      let checked = await this.check(target);
      for (let tries = 0; tries < 3 && checked.state !== 'ready'; tries++) {
        if (!(await this.fix(target, checked))) break;
        checked = await this.check(target);
      }
      states.set(target, checked);
    }
    return states;
  }

  /** Get what's in a target's way out of it, when setup can: whether it tried. */
  private async fix(target: Target, checked: Checked): Promise<boolean> {
    switch (checked.state) {
      case 'plugin': {
        if (!this.asking) return false;
        await this.install(this.listing(target.source)!.plugin);
        await this.refresh();
        return true;
      }
      case 'sign-in': {
        if (!this.asking || providerFor(target.source) !== 'google') return false;
        const { OAuthCommand } = await import('../../auth/OAuthCommand.js');
        try {
          await new OAuthCommand('google', { port: 7463, timeout: 300 }).execute();
        } catch (error) {
          if ((error as { exitCode?: number }).exitCode === 130) throw cancelled();
          this.logError("Couldn't sign in", error);
          return false;
        }
        return true;
      }
      case 'missing': {
        if (!this.exported(target)) return false;
        // Moved or deleted: waited for again, like an export asked for.
        this.settings.targets = (this.settings.targets ?? []).filter(t => t !== target);
        const { type: _type, ...flags } = target.flags;
        this.settings.requested = [
          ...(this.settings.requested ?? []),
          { source: target.source, flags, at: new Date().toISOString() },
        ];
        await this.save();
        return false;
      }
      default:
        return false;
    }
  }

  /**
   * Extract each ready target without a finished file, a few at a time,
   * biggest first, then say what was extracted and what's still waiting.
   */
  private async extract(root: string, states: Map<Target, Checked>): Promise<void> {
    const targets = this.settings.targets ?? [];
    mkdirSync(root, { recursive: true });
    const jobs: Job[] = [];
    const before: { target: Target; name: string }[] = [];
    for (const target of targets) {
      const name = targetName(target, targets);
      if (existsSync(finishedFile(root, name)) && !this.flags.again) {
        before.push({ target, name });
      } else if (states.get(target)?.state === 'ready') {
        const label = targetLabel(target, targets);
        jobs.push({ target, name, label, total: null, state: 'waiting', processed: 0 });
      }
    }
    if (jobs.length > 0) {
      await this.spin('Counting what to extract', () =>
        Promise.all(
          jobs.map(async job => {
            job.total = await this.countTarget(job.target);
          })
        )
      );
    }

    const started = Date.now();
    const interrupted = jobs.length > 0 && (await this.runJobs(root, jobs, started));
    if (interrupted) {
      this.logger.emit({
        level: 'info',
        kind: 'notice',
        message: 'Stopped',
        hint: { action: 'Run `chronicle setup` to extract the rest.' },
      });
      this.logger.flush();
      throw new Errors.ExitError(130);
    }
    this.report(root, jobs, before, states, Date.now() - started);
    if (jobs.some(job => job.state === 'failed')) throw new Errors.ExitError(1);
  }

  /** Run the jobs, live at a terminal. Whether Ctrl-C stopped them. */
  private async runJobs(root: string, jobs: Job[], started: number): Promise<boolean> {
    const names = Math.max(...jobs.map(job => job.label.length));
    const since = this.since.toISOString();
    const width = () => (process.stderr.columns || 80) - 1;
    const live =
      process.stderr.isTTY && !this.flags.quiet
        ? new LiveRegion((w, frame) => liveLines(jobs, started, this.t, w, frame))
        : undefined;
    const runner = new JobRunner(jobs, {
      root,
      bin: path.join(this.config.root, 'bin', 'run.js'),
      since,
      concurrency: Math.max(1, this.flags.jobs),
      onEvent: (job, event) => {
        this.logger.emit({
          level: event.level === 'error' ? 'error' : 'warn',
          kind: 'notice',
          message: `${job.label}: ${event.message}`,
          ...(event.hint && { hint: event.hint }),
        });
      },
      onChange: job => {
        if (job.state === 'done' || job.state === 'failed') {
          const command = commandLine(
            ['extract', ...targetArgs(job.target), '--since', since, '--limit', '0'],
            this.home
          );
          this.print(finishedLines(job, names, command, this.t, width()));
        }
        live?.redraw();
      },
    });
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      runner.stop().catch(() => {});
    };
    process.on('SIGINT', onInterrupt);
    live?.start();
    try {
      await runner.run();
    } finally {
      live?.stop();
      process.removeListener('SIGINT', onInterrupt);
    }
    return interrupted;
  }

  /**
   * What was extracted, this run and before, with each file; where the
   * files are; then what's still waiting, and why.
   */
  private report(
    root: string,
    jobs: Job[],
    before: { target: Target; name: string }[],
    states: Map<Target, Checked>,
    durationMs: number
  ): void {
    const targets = this.settings.targets ?? [];
    const done = [
      ...before.map(({ target, name }) => ({ target, name, records: this.extracted(root, name) })),
      ...jobs
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
          durationMs,
          output: fromHome(root, this.home),
        },
      });
    } else if (done.length > 0) {
      this.logger.info('Nothing new to extract');
    } else {
      this.logger.info('Nothing to extract yet');
    }
    if (done.length > 0) {
      // The summary says where the files went; without one, this does.
      const where = jobs.length > 0 ? '' : `The files are in ${fromHome(root, this.home)}. `;
      this.hint(`${where}Delete a file, or use \`--again\`, to extract it again.`);
    }
    this.waiting(
      targets.filter(
        target =>
          states.get(target) &&
          states.get(target)!.state !== 'ready' &&
          !done.some(d => d.target === target)
      ),
      states
    );
  }

  /** What's still in each target's way, and each export asked for: a hint for each kind of thing. */
  private waiting(targets: Target[], states: Map<Target, Checked>): void {
    const by = (state: Checked['state']) =>
      targets.filter(target => states.get(target)!.state === state).map(t => t.source);
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
    for (const asked of this.settings.requested ?? []) {
      this.hint(
        `Waiting for ${asked.source}'s export, asked for ${date(new Date(asked.at)).slice(0, 10)}.`
      );
    }
  }
}
