import { Args, Command, Errors } from '@oclif/core';
import { EXIT_CODES, describeError } from '@chronicle.app/logging';
import { closest } from './closest.js';
import { BaseCommand } from '../baseCommand.js';
import { PluginScanner, type ExtractorMetadata } from '../plugins/PluginScanner.js';
import { FlagManager } from './FlagManager.js';
import { recordTypesHint, renderRecordTypes, renderSourceHelp } from './sourceHelp.js';
import { getTheme } from '../theme.js';
import { outputFlagsIn } from '../output/index.js';

// NOTE: nothing here may statically import `ink` (ExtractorSelector/InkSelect,
// ExtractCommand). Importing ink resumes
// process.stdin at load time, which would drain piped input before the
// file/stdin (non-source) path reads it. Those are dynamic-imported below,
// only on the dispatch path — which never touches stdin.
const EXTRACT_BASE_FLAGS = FlagManager.getBaseFlags(BaseCommand.baseFlags);

/**
 * The native source dispatcher shared by `extract` and `ingest`. A positional
 * `<source>` is routed by runtime cross-plugin discovery — so multiple
 * extractors / strategies for one source (whether bundled in a plugin or spread
 * across several) are all selectable, and each extractor's own Zod-schema flags
 * are parsed dynamically. The two verbs differ only in default loader.
 *
 * When the positional is not a discoverable source, `handleNonSource()` runs:
 * `ingest` treats it as a file/stdin of Chronicle JSON-LD; `extract` offers to
 * install a plugin for it.
 */
export abstract class SourceDispatchCommand<T extends typeof Command> extends BaseCommand<T> {
  /** Default loader when the user doesn't pass --loader. extract → json, ingest → store. */
  protected abstract readonly defaultLoaderName: 'json';

  /** Handle a positional that isn't a discoverable source (file/stdin, or install-prompt). */
  protected abstract handleNonSource(positional: string | undefined): Promise<void>;

  /**
   * Whether a positional that isn't a source still has its flags parsed. A verb
   * that only reports an unknown source turns this off, so a source's own flags
   * (`extract old-name --limit 5`) don't fail before the real error.
   */
  protected readonly parsesFlagsForNonSource: boolean = true;

  static override args = {
    source: Args.string({ description: 'Source name (e.g. shell, imessage)', required: false }),
  };

  static override strict = false;

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  protected selectedExtractor: any;
  private dispatching = false;
  private nonSourceArg: string | undefined;
  private globalLogs: Array<{ timestamp: Date; message: string }> = [];

  /**
   * Find the source/file positional, skipping flags and their values. We can't
   * use oclif's parser yet (we don't know the source-specific flags), so this
   * walks argv with the set of known value-taking global flags. The positional
   * is expected before any source-specific flags, which is how it's typed.
   */
  private firstPositional(): string | undefined {
    const [first] = this.positionals();
    return first === undefined ? undefined : this.argv[first];
  }

  /** Where the positionals are in argv, skipping flags and their values as {@link firstPositional} does. */
  private positionals(): number[] {
    const valueFlags = new Set([
      '--theme',
      '--log-format',
      '--preset',
      '-p',
      '--db',
      '--input',
      '-i',
      '--loader',
      '--limit',
      '-l',
      '--since',
      '-s',
      '--until',
      '-u',
      '--output',
      '-o',
      '--type',
      '-t',
      '--strategy',
      '--sample',
      '--fields',
      '--delay',
      '--fold-batch',
    ]);
    const found: number[] = [];
    for (let i = 0; i < this.argv.length; i++) {
      const tok = this.argv[i];
      if (tok.startsWith('-')) {
        if (tok.includes('=')) continue; // --flag=value
        if (valueFlags.has(tok)) i++; // skip this flag's value
        continue; // boolean flag (or value already skipped)
      }
      found.push(i);
    }
    return found;
  }

  public override async init(): Promise<void> {
    // Before discovery, so what it says follows the output flags.
    this.installOutput(outputFlagsIn(this.argv));
    // `help` anywhere asks for help: `extract help [source]` reads like
    // `git help <command>`, and `extract spotify help` like a kind would. The
    // command's help, or the source's.
    const helpAt = this.positionals().find(i => this.argv[i] === 'help');
    if (helpAt !== undefined) {
      this.argv = this.argv.filter((_, i) => i !== helpAt);
      if (!this.firstPositional()) {
        await this.config.runCommand('help', [this.id ?? 'extract']);
        this.exit(0);
      }
      this.argv.push('--help');
    }
    const positional = this.firstPositional();
    const wantsHelp = this.argv.includes('--help') || this.argv.includes('-h');

    // No positional → file/stdin/none. Read promptly via super.init() WITHOUT
    // first awaiting plugin discovery, or async work would drain piped stdin
    // before BaseCommand reads it.
    if (!positional) {
      this.nonSourceArg = undefined;
      await super.init();
      return;
    }

    const candidates = (await PluginScanner.scanAllPlugins()).get(positional) ?? [];

    // A positional that isn't a discoverable source → defer to the subclass
    // (a file path / inline JSON for ingest, or an install-prompt for extract).
    if (candidates.length === 0) {
      this.nonSourceArg = positional;
      if (this.parsesFlagsForNonSource) await super.init();
      return;
    }

    this.dispatchedSource = positional;
    const override = candidates[0].localOverride;
    if (override) {
      this.logger.info(`Using the local plugin for ${positional}`, { path: override });
    }

    // Help / list-types render from the candidates alone — before flag parsing,
    // so they never trip over a source's own required flags.
    if (wantsHelp) {
      this.renderSourceHelp(positional, candidates);
      this.exit(0);
    }
    if (this.argv.includes('--list-types') || this.argv.includes('-L')) {
      this.log(renderRecordTypes(candidates));
      const { message, action } = recordTypesHint(
        positional,
        candidates,
        (this.constructor as any).id || 'extract'
      );
      this.logger.emit({
        level: 'info',
        kind: 'hint',
        message,
        ...(action && { hint: { action } }),
      });
      this.exit(0);
    }

    // Assemble the dynamic flag set: base (incl. --loader/--limit/--type)
    // + --strategy + the UNION of every candidate's schema flags. The loader
    // default encodes the verb.
    // Exclude `input` from the base skip-set so an extractor that makes it
    // required (an export it must be handed) overrides the optional base
    // `input` flag — otherwise oclif wouldn't enforce it and the extractor
    // throws a raw Zod error instead of a clean "Missing required flag".
    const baseForSchema = { ...EXTRACT_BASE_FLAGS };
    delete (baseForSchema as any).input;
    let schemaFlags: Record<string, any> = {};
    for (const c of candidates) {
      schemaFlags = {
        ...schemaFlags,
        ...FlagManager.schemaToFlags(c.extractor, 'EXTRACTION', baseForSchema),
      };
    }
    const assembled = {
      ...EXTRACT_BASE_FLAGS,
      loader: FlagManager.loaderFlag(this.defaultLoaderName),
      ...FlagManager.strategyFlag(candidates),
      ...schemaFlags,
    };

    const verb = (this.constructor as any).id || 'extract';
    let args: any;
    let flags: any;
    let metadata: any;
    let positionals: unknown[] = [];
    try {
      ({
        args,
        flags,
        metadata,
        argv: positionals,
      } = await this.parse({
        args: SourceDispatchCommand.args,
        flags: assembled,
        strict: false,
        baseFlags: BaseCommand.baseFlags,
      }));
    } catch (error) {
      // A flag the source doesn't have: oclif's own message would print the
      // generic extract usage, which knows none of the source's flags.
      const unknown =
        error instanceof Error
          ? error.message.match(/Nonexistent flags?: ([^\n]+)/)?.[1]
          : undefined;
      if (unknown) this.unknownFlags(unknown.split(/,\s*/), assembled, positional, verb);
      // A flag given without its value: for --type, the kinds to choose from.
      const valueless =
        error instanceof Error
          ? error.message.match(/Flag --([\w-]+) expects a value/)?.[1]
          : undefined;
      if (valueless) this.missingValue(valueless, positional, verb);
      // Any other parse failure (a missing required flag, a bad value): the
      // source's help lists its flags, which oclif's generic usage doesn't.
      if (error instanceof Errors.ExitError || (error as any)?.oclif?.exit === 130) throw error;
      this.fail(
        (error instanceof Error ? error.message : String(error)).replace(
          /\s*See more help.*$/s,
          ''
        ),
        {
          hint: `Run \`chronicle ${verb} ${positional} --help\` to see its flags.`,
        }
      );
    }
    this.args = args as typeof this.args;
    this.flags = await this.resolveCommandFlags(flags, metadata);
    // --preview: a few records, readable. An explicit --limit still wins.
    if ((this.flags as any).preview) {
      (this.flags as any).loader = 'preview';
      if (metadata?.flags?.limit?.setFromDefault) (this.flags as any).limit = 5;
    }

    // Resolve the run across the two axes: the strategy (--strategy, else what
    // --input / credentials / the declared default imply) and the record kinds
    // (--type). Whatever surplus --type leaves is filtered by the Runner.
    const parsed = this.flags as any;
    const { ExtractorSelector } = await import('./ExtractorSelector.js');
    const { requestedRecordTypes } = await import('./RunnerBuilder.js');
    // Kinds named after the source (`extract github stars gists`), or with --type.
    const named = positionals.filter((arg): arg is string => typeof arg === 'string').slice(1);
    if (named.length > 0 && parsed.type) {
      this.fail('Record kinds named twice', {
        hint: 'Name them after the source or with `--type`, not both.',
      });
    }
    const selector = new ExtractorSelector({
      source: positional,
      candidates,
      strategy: parsed.strategy,
      types: named.length > 0 ? named : requestedRecordTypes(parsed.type),
      // Only a path you gave picks a strategy: an extractor's default input
      // (WhatsApp's Mac database) is not an export you handed it.
      input: metadata?.flags?.input?.setFromDefault ? undefined : parsed.input,
      hasCredentials: await this.hasStoredCredentials(positional),
      // Interactive selection needs a TTY (Ink raw mode). In a pipe the
      // selector throws with the strategies instead of crashing on raw mode.
      interactive: process.stdin.isTTY,
      theme: parsed.theme,
    });

    try {
      this.selectedExtractor = await selector.select();
    } catch (error) {
      if ((error as any)?.oclif?.exit === 130) throw error;
      // A typed failure (an unknown --type) says what to do in its hint; the
      // whole source help would bury it.
      const { message, code, exitCode, hint } = describeError(error);
      if (code !== 'internal') {
        this.logger.emit({
          level: 'error',
          kind: 'error',
          message,
          error: { code, exitCode },
          ...(hint && { hint: { action: hint } }),
        });
        this.logger.flush();
        throw new Errors.ExitError(exitCode);
      }
      this.fail(error instanceof Error ? error.message : String(error), {
        hint: `Run \`chronicle ${verb} ${positional} --help\` to see its strategies and record types.`,
      });
    }
    this.announce(selector.selection, positional, verb);
    // When the extractor reads kinds beyond those chosen, the Runner keeps
    // only the chosen ones, however they were chosen.
    const emitted: string[] = this.selectedExtractor?.recordTypes ?? [];
    const kinds = selector.selection?.kinds ?? [];
    if (emitted.some(kind => !kinds.includes(kind))) parsed.type = kinds.join(',');
    this.dispatching = true;
  }

  /**
   * Before a run of several kinds, or of the plugin's defaults, say which kinds
   * it reads, and which it leaves out and how to have them.
   */
  private announce(
    selection: { kinds: string[]; excluded: string[]; how: string; merged: boolean } | undefined,
    source: string,
    verb: string
  ): void {
    if (!selection) return;
    const { kinds, excluded, how, merged } = selection;
    // One kind, nothing left out: nothing to say.
    if (kinds.length < 2 && (how === 'named' || excluded.length === 0)) return;
    const order = kinds.length > 1 && !merged ? ', one kind after another' : '';
    this.logger.info(`Extracting ${kinds.join(', ')}${order}`);
    if (excluded.length > 0 && how !== 'named') {
      this.logger.emit({
        level: 'info',
        kind: 'hint',
        message: `Also available: ${excluded.join(', ')}. Use \`-t all\` to get everything.`,
      });
    }
  }

  /** The source being run, once the positional names one. */
  private dispatchedSource?: string;

  /** A source's own help, which lists its flags; the command's otherwise. */
  protected override helpCommand(): string | undefined {
    const verb = (this.constructor as any).id || 'extract';
    return this.dispatchedSource
      ? `chronicle ${verb} ${this.dispatchedSource} --help`
      : super.helpCommand();
  }

  /**
   * Report flags the source doesn't have as a usage error whose hint names the
   * likeliest flag meant and where the source's flags and kinds are listed.
   */
  private unknownFlags(
    typed: string[],
    flags: Record<string, { char?: string }>,
    source: string,
    verb: string
  ): never {
    const [first] = typed;
    const bare = first.replace(/^-+/, '');
    let guess: string | undefined;
    if (!first.startsWith('--') && bare.length === 1) {
      // A short flag: the same letter in the other case, if a flag has it.
      const name = Object.keys(flags).find(
        n => flags[n].char?.toLowerCase() === bare.toLowerCase()
      );
      if (name) guess = `\`-${flags[name].char}\` (\`--${name}\`)`;
    } else {
      const name = closest(bare, Object.keys(flags));
      if (name) guess = `\`--${name}\``;
    }
    this.logger.emit({
      level: 'error',
      kind: 'error',
      message: `Unknown flag ${typed.join(', ')}`,
      error: { code: 'unknown-flag', exitCode: EXIT_CODES.usage },
      hint: {
        action: guess
          ? `Did you mean ${guess}?`
          : `Run \`chronicle ${verb} ${source} --help\` to see its flags.`,
      },
    });
    this.logger.flush();
    throw new Errors.ExitError(EXIT_CODES.usage);
  }

  /** Report a flag given without its value, with where its values are listed. */
  private missingValue(flag: string, source: string, verb: string): never {
    this.logger.emit({
      level: 'error',
      kind: 'error',
      message: `--${flag} needs a value`,
      error: { code: 'missing-flag-value', exitCode: EXIT_CODES.usage },
      hint: {
        action:
          flag === 'type'
            ? `Run \`chronicle ${verb} ${source} --list-types\` to see what it has.`
            : `Run \`chronicle ${verb} ${source} --help\` for details.`,
      },
    });
    this.logger.flush();
    throw new Errors.ExitError(EXIT_CODES.usage);
  }

  /**
   * Whether this source has credentials on file. Only consulted to pick the
   * live strategy for a source that declares no default — never to authenticate.
   */
  private async hasStoredCredentials(source: string): Promise<boolean> {
    try {
      const { CredentialManager } = await import('../auth/CredentialManager.js');
      return Boolean(await CredentialManager.getCredentials(source));
    } catch {
      return false;
    }
  }

  public async run(): Promise<any> {
    if (!this.dispatching) {
      return this.handleNonSource(this.nonSourceArg);
    }

    const { runExtraction } = await import('./runExtraction.js');
    return runExtraction(this.selectedExtractor, this.flags, this.flagSources);
  }

  /**
   * A source that isn't installed: when the catalog has it, offer to install
   * its plugin on a terminal and then run again, or else print the command.
   */
  protected async installPrompt(source: string): Promise<void> {
    const { listSources } = await import('../plugins/catalog.js');
    const listing = (await listSources()).find(s => s.source === source && !s.installed);
    if (!listing) {
      this.fail(`No source named "${source}"`, {
        hint: "Run `chronicle sources --all` to see what's available.",
      });
    }

    const command = `chronicle plugins install ${listing.plugin}`;
    // The prompt draws on stdout, so only offer it when records aren't piped.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.fail(`${source} isn't installed`, { hint: `Install it with \`${command}\`.` });
    }
    const { inkConfirm } = await import('../components/InkConfirm.js');
    const { confirmed } = await inkConfirm(
      `${source} needs the ${listing.package} plugin. Install it now?`,
      { defaultValue: true, theme: (this.flags as any)?.theme }
    );
    if (!confirmed) {
      this.logger.emit({
        level: 'info',
        kind: 'hint',
        message: `Not installed. Install it later with \`${command}\`.`,
      });
      this.exit(1);
    }

    const { installPlugin, resolveInstallTarget } = await import('../plugins/install.js');
    try {
      await installPlugin(await resolveInstallTarget(listing.plugin, this.config.version));
    } catch (error) {
      this.failFrom(error);
    }
    this.logger.emit({ level: 'info', kind: 'summary', message: `Installed ${listing.package}` });
    const verb = (this.constructor as any).id || 'extract';
    await this.config.runCommand(verb, this.argv);
  }

  /** Render the source's extractors + flags via the shared renderer. */
  protected renderSourceHelp(source: string, candidates: ExtractorMetadata[]): void {
    const verb = (this.constructor as any).id || 'extract';
    this.log(renderSourceHelp(source, candidates, { verb, theme: (this.flags as any)?.theme }));
  }
}
