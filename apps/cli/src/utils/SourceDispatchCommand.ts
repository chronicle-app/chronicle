import { Args, Command, Errors } from '@oclif/core';
import { EXIT_CODES, describeError } from '@chronicle.app/logging';
import { closest } from './closest.js';
import { BaseCommand } from '../baseCommand.js';
import { PluginScanner, type ExtractorMetadata } from '../plugins/PluginScanner.js';
import { FlagManager } from './FlagManager.js';
import { recordTypesHint, renderRecordTypes, renderSourceHelp } from './sourceHelp.js';
import { canAsk, outputFlagsIn } from '../output/index.js';
import type { ExtractorSelector } from './ExtractorSelector.js';

const EXTRACT_BASE_FLAGS = FlagManager.getBaseFlags(BaseCommand.baseFlags);

/**
 * The native source dispatcher shared by `extract` and `survey`. A positional
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
  /** Default loader when the user doesn't pass --loader, for a verb that loads records. */
  protected readonly defaultLoaderName: 'json' = 'json';

  /**
   * The flags every run of this verb takes beside a source's own: extract's
   * loader, output and limit, and the run filters. A source's option with
   * one of these names is the verb's.
   */
  protected commonFlags(): Record<string, any> {
    return { ...EXTRACT_BASE_FLAGS, loader: FlagManager.loaderFlag(this.defaultLoaderName) };
  }

  /** A source's options this verb doesn't take, like a limit for a verb that reads it all. */
  protected readonly unoffered: string[] = [];

  /** The kinds a run reads when it names none: unset for the plugin's defaults, or asking. */
  protected readonly defaultKinds?: string[];

  /** Whether to say which kinds a run reads, and which it leaves out. */
  protected readonly announcesKinds: boolean = true;

  /** Handle a positional that isn't a discoverable source (file/stdin, or install-prompt). */
  protected abstract handleNonSource(positional: string | undefined): Promise<void>;

  /**
   * Whether a positional that isn't a source still has its flags parsed. A verb
   * that only reports an unknown source turns this off, so a source's own flags
   * (`extract old-name --limit 5`) don't fail before the real error.
   */
  protected parsesFlagsForNonSource(_positional: string): boolean {
    return true;
  }

  static override args = {
    source: Args.string({ description: 'A source, like shell or imessage', required: false }),
  };

  static override strict = false;

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  protected selectedExtractor: any;
  /** What the run reads, once selected: its kinds, and how they were chosen. */
  protected selection?: ExtractorSelector['selection'];
  /** The kinds the run names, after the source or with `--type`, if any. */
  protected namedKinds?: string[];
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
      '--format',
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
      if (this.parsesFlagsForNonSource(positional)) await super.init();
      return;
    }

    this.dispatchedSource = positional;
    this.candidates = candidates;
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
      const hint = recordTypesHint(
        positional,
        candidates,
        (this.constructor as any).id || 'extract'
      );
      if (hint) this.hint(hint.message, hint.action);
      this.exit(0);
    }

    // Assemble the dynamic flag set: base (incl. --loader/--limit/--type)
    // + --strategy + the UNION of every candidate's schema flags. The loader
    // default encodes the verb.
    // Exclude `input` from the base skip-set so an extractor that makes it
    // required (an export it must be handed) overrides the optional base
    // `input` flag — otherwise oclif wouldn't enforce it and the extractor
    // throws a raw Zod error instead of a clean "Missing required flag".
    const common = this.commonFlags();
    const baseForSchema: Record<string, unknown> = { ...common };
    delete baseForSchema.input;
    for (const name of this.unoffered) baseForSchema[name] = true;
    let schemaFlags: Record<string, any> = {};
    for (const c of candidates) {
      schemaFlags = {
        ...schemaFlags,
        ...FlagManager.schemaToFlags(c.extractor, 'EXTRACTION', baseForSchema),
      };
    }
    const assembled = {
      ...common,
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
      const required =
        error instanceof Error
          ? error.message.match(/Missing required flags?:?\s+([\w-]+)/)?.[1]
          : undefined;
      if (required) this.missingFlag(required, positional, verb);
      // Any other parse failure (a bad value, say): the
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
    this.namedKinds = named.length > 0 ? named : requestedRecordTypes(parsed.type);
    const selector = new ExtractorSelector({
      source: positional,
      candidates,
      strategy: parsed.strategy,
      types: this.namedKinds ?? this.defaultKinds,
      // Only a path you gave picks a strategy: an extractor's default input
      // (WhatsApp's Mac database) is not an export you handed it.
      input: metadata?.flags?.input?.setFromDefault ? undefined : parsed.input,
      config: FlagManager.buildExtractorConfig(parsed),
      hasCredentials: await this.hasStoredCredentials(positional),
      // Asking needs a terminal. Without one the selector throws with the
      // strategies instead of waiting for keys that never come.
      interactive: canAsk(),
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
    this.selection = selector.selection;
    this.announce(selector.selection, positional, verb);
    // When the extractor reads kinds beyond those chosen, the Runner keeps
    // only the chosen ones, however they were chosen. `--type` always names
    // them, so `-t all` and `-t defaults` aren't kept as kinds of those names.
    const emitted: string[] = this.selectedExtractor?.recordTypes ?? [];
    const kinds = selector.selection?.kinds ?? [];
    if (parsed.type || emitted.some(kind => !kinds.includes(kind))) parsed.type = kinds.join(',');
    this.dispatching = true;
  }

  /**
   * Before a run of several kinds, or of the plugin's defaults, say which kinds
   * it reads, and which it leaves out and how to have them. Say too when the
   * kinds named leave out some the run's options ask for.
   */
  private announce(
    selection:
      | { kinds: string[]; excluded: string[]; how: string; merged: boolean; unread: string[] }
      | undefined,
    source: string,
    verb: string
  ): void {
    if (!selection) return;
    const { kinds, excluded, how, merged, unread } = selection;
    if (unread.length > 0) {
      this.hint(
        `The options ask for ${unread.join(', ')} too, which this run doesn't read. Name ${unread.length === 1 ? 'it' : 'them'} as well, or name no kinds.`
      );
    }
    // One kind, nothing left out: nothing to say.
    if (!this.announcesKinds) return;
    if (kinds.length < 2 && (how === 'named' || excluded.length === 0)) return;
    const order = kinds.length > 1 && !merged ? ', one kind after another' : '';
    this.logger.info(`Extracting ${kinds.join(', ')}${order}`);
    if (excluded.length > 0 && how !== 'named') {
      this.hint(`Also available: ${excluded.join(', ')}. Use \`-t all\` to get everything.`);
    }
  }

  /** The source being run, once the positional names one. */
  protected dispatchedSource?: string;
  /** Every extractor the source has, once the positional names one. */
  protected candidates: ExtractorMetadata[] = [];

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

  /** Report a required flag not given, with where the source's flags are listed. */
  protected missingFlag(flag: string, source: string, verb: string): never {
    this.fail(`${source} needs --${flag}`, {
      hint: `Run \`chronicle ${verb} ${source} --help\` to see its flags.`,
    });
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
    return this.runSelected();
  }

  /** Run what the source, its flags and kinds selected. Extract's runs it into its loader. */
  protected async runSelected(): Promise<any> {
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
    if (!canAsk()) {
      this.fail(`${source} isn't installed`, { hint: `Install it with \`${command}\`.` });
    }
    const { confirm } = await import('../output/prompts.js');
    const { confirmed } = await confirm(
      `${source} needs the ${listing.package} plugin. Install it now?`,
      { defaultValue: true, theme: (this.flags as any)?.theme }
    );
    if (!confirmed) {
      this.hint(`Not installed. Install it later with \`${command}\`.`);
      this.exit(1);
    }

    const { installPlugin, resolveInstallTarget } = await import('../plugins/install.js');
    try {
      await installPlugin(await resolveInstallTarget(listing.plugin, this.config.version));
    } catch (error) {
      this.failFrom(error);
    }
    this.summary(`Installed ${listing.package}`);
    const verb = (this.constructor as any).id || 'extract';
    await this.config.runCommand(verb, this.argv);
  }

  /** Render the source's extractors + flags via the shared renderer. */
  protected renderSourceHelp(source: string, candidates: ExtractorMetadata[]): void {
    const verb = (this.constructor as any).id || 'extract';
    this.log(renderSourceHelp(source, candidates, { verb, theme: (this.flags as any)?.theme }));
  }
}
