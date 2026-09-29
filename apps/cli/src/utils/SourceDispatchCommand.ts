import { Args, Command } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import { PluginScanner, type ExtractorMetadata } from '../plugins/PluginScanner.js';
import { FlagManager } from './FlagManager.js';
import { renderSourceHelp } from './sourceHelp.js';
import { getTheme } from '../theme.js';

// NOTE: nothing here may statically import `ink` (InkProgressManager,
// ExtractorSelector/InkSelect, ExtractCommand). Importing ink resumes
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
    const valueFlags = new Set([
      '--theme',
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
      '--via',
      '--strategy',
      '--sample',
      '--fields',
      '--delay',
      '--fold-batch',
    ]);
    for (let i = 0; i < this.argv.length; i++) {
      const tok = this.argv[i];
      if (tok.startsWith('-')) {
        if (tok.includes('=')) continue; // --flag=value
        if (valueFlags.has(tok)) i++; // skip this flag's value
        continue; // boolean flag (or value already skipped)
      }
      return tok;
    }
    return undefined;
  }

  public override async init(): Promise<void> {
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
      await super.init();
      return;
    }

    const override = candidates[0].localOverride;
    if (override) {
      this.logToStderr(`Using the local plugin for ${positional} (${override})`);
    }

    // Help / list-types render from the candidates alone — before flag parsing,
    // so they never trip over a source's own required flags.
    if (wantsHelp || this.argv.includes('--list-types') || this.argv.includes('-L')) {
      this.renderSourceHelp(positional, candidates);
      this.exit(0);
    }

    // Assemble the dynamic flag set: base (incl. --loader/--limit/--type)
    // + --via + the UNION of every candidate's schema flags. The loader
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
      ...FlagManager.viaFlags(candidates),
      ...schemaFlags,
    };

    const verb = (this.constructor as any).id || 'extract';
    let args: any;
    let flags: any;
    let metadata: any;
    try {
      ({ args, flags, metadata } = await this.parse({
        args: SourceDispatchCommand.args,
        flags: assembled,
        strict: false,
        baseFlags: BaseCommand.baseFlags,
      }));
    } catch (error) {
      // Surface missing source-specific flags with a pointer to the source help.
      if (error instanceof Error && /Missing required flag/i.test(error.message)) {
        this.error(
          `${error.message.replace(/\s*See more help.*$/s, '')}\n` +
            `Run \`chronicle ${verb} ${positional} --help\` to see ${positional}'s flags.`
        );
      }
      throw error;
    }
    this.args = args as typeof this.args;
    this.flags = await this.resolveCommandFlags(flags, metadata);
    // --preview: a few records, readable. An explicit --limit still wins.
    if ((this.flags as any).preview) {
      (this.flags as any).loader = 'preview';
      if (metadata?.flags?.limit?.setFromDefault) (this.flags as any).limit = 5;
    }

    // Resolve the run across the two axes: the way in (--via, else what
    // --input / credentials / the declared default imply) and the record kinds
    // (--type). Whatever surplus --type leaves is filtered by the Runner.
    const parsed = this.flags as any;
    const { ExtractorSelector } = await import('./ExtractorSelector.js');
    const { requestedRecordTypes } = await import('./RunnerBuilder.js');
    const selector = new ExtractorSelector({
      source: positional,
      candidates,
      via: parsed.via ?? parsed.strategy,
      types: requestedRecordTypes(parsed.type),
      input: parsed.input,
      hasCredentials: await this.hasStoredCredentials(positional),
      // Interactive selection needs a TTY (Ink raw mode). In a pipe the
      // selector throws with the ways in instead of crashing on raw mode.
      interactive: process.stdin.isTTY,
      theme: parsed.theme,
    });

    try {
      this.selectedExtractor = await selector.select();
    } catch (error) {
      if ((error as any)?.oclif?.exit === 130) throw error;
      this.error(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          renderSourceHelp(positional, candidates, { verb, theme: parsed.theme })
      );
    }
    this.dispatching = true;
  }

  /**
   * Whether this source has credentials on file. Only consulted to pick the
   * live way in for a source that declares no default — never to authenticate.
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
    return runExtraction(this.selectedExtractor, this.flags, 'extract');
  }

  /**
   * A source that isn't installed: when the catalog has it, offer to install
   * its plugin on a terminal and then run again, or else print the command.
   */
  protected async installPrompt(source: string): Promise<void> {
    const theme = getTheme((this.flags as any)?.theme);
    const { listSources } = await import('../plugins/catalog.js');
    const listing = (await listSources()).find(s => s.source === source && !s.installed);
    if (!listing) {
      this.error(
        `No source named "${source}". Run "chronicle sources --all" to see what's available.`
      );
    }

    const command = `chronicle plugins install ${listing.plugin}`;
    // The prompt draws on stdout, so only offer it when records aren't piped.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.error(`${source} isn't installed. Install it with:\n  ${command}`);
    }
    const { inkConfirm } = await import('../components/InkConfirm.js');
    const { confirmed } = await inkConfirm(
      `${source} needs the ${listing.package} plugin. Install it now?`,
      { defaultValue: true, theme: (this.flags as any)?.theme }
    );
    if (!confirmed) {
      this.logToStderr(theme.textDim(`Install it later with: ${command}`));
      this.exit(1);
    }

    const { installPlugin, resolveInstallTarget } = await import('../plugins/install.js');
    try {
      await installPlugin(await resolveInstallTarget(listing.plugin, this.config.version));
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
    this.logToStderr(theme.success(`Installed ${listing.package}.`));
    const verb = (this.constructor as any).id || 'extract';
    await this.config.runCommand(verb, this.argv);
  }

  /** Render the source's extractors + flags via the shared renderer. */
  protected renderSourceHelp(source: string, candidates: ExtractorMetadata[]): void {
    const verb = (this.constructor as any).id || 'extract';
    this.log(renderSourceHelp(source, candidates, { verb, theme: (this.flags as any)?.theme }));
  }
}
