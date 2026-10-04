import { Command, Errors, Flags, Interfaces } from '@oclif/core';
import {
  EXIT_CODES,
  createLogger,
  describeError,
  isReported,
  setDefaultSink,
  type Logger,
} from '@chronicle.app/logging';
import { ConfigManager, FlagResolver, FlagSource } from './config/index.js';
import { LOG_FORMATS, outputFlagsIn, sinkFor, type OutputFlags } from './output/index.js';

/**
 * Reading stdin drains it to EOF, so a parent that spawns the CLI with a pipe
 * it never closes (Node's `execFile` default) would hang any command that
 * read it. Only a command that declares `acceptsStdin` reads a non-TTY stdin.
 */
export function shouldReadStdin({
  isTTY,
  acceptsStdin,
}: {
  isTTY: boolean | undefined;
  acceptsStdin: boolean;
}): boolean {
  return acceptsStdin && !isTTY;
}

async function read(stream: NodeJS.ReadStream) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf8');
}

export type Flags<T extends typeof Command> = Interfaces.InferredFlags<
  T['flags'] & (typeof BaseCommand)['baseFlags']
>;
export type Args<T extends typeof Command> = Interfaces.InferredArgs<T['args']>;

export abstract class BaseCommand<T extends typeof Command> extends Command {
  // define flags that can be inherited by any command that extends BaseCommand
  static override baseFlags = {
    verbose: Flags.boolean({
      char: 'v',
      helpGroup: 'GLOBAL',
      summary: 'Enable verbose output (debug level)',
    }),
    quiet: Flags.boolean({
      char: 'q',
      helpGroup: 'GLOBAL',
      summary: 'Suppress non-essential output',
    }),
    preset: Flags.string({
      char: 'p',
      description: 'Use named configuration preset(s), comma-separated',
      helpGroup: 'GLOBAL',
      helpValue: 'name1,name2',
    }),
    theme: Flags.string({
      description: 'Color theme for output (default, minimal, high-contrast)',
      helpGroup: 'GLOBAL',
      options: ['default', 'minimal', 'high-contrast'],
    }),
    'log-format': Flags.option({
      options: LOG_FORMATS,
      helpGroup: 'GLOBAL',
      summary: 'How stderr reports: pretty on a terminal, else plain; json for supervisors',
    })(),
  };

  // add the --json flag
  // static override enableJsonFlag = true;

  static stdin: string;

  /** Whether init() parses the flags; off for a command that reads its own argv. */
  static parsesInInit = true;

  /** Opt in to reading piped stdin in init(); see shouldReadStdin. */
  static acceptsStdin = false;

  protected args!: Args<T>;
  protected flags!: Flags<T>;
  protected flagSources?: Record<string, FlagSource>;

  /**
   * Everything a command tells a person goes through here, never `console`:
   * events on the process-wide sink its output flags ask for.
   */
  protected logger: Logger = createLogger({ scope: 'cli' });

  /** Point every logger without a sink of its own at the sink these flags ask for. */
  protected installOutput(flags: OutputFlags): void {
    setDefaultSink(sinkFor(flags));
  }

  /** An error for a person: the message, and its stack under --verbose. */
  protected logError(message: string, error: unknown): void {
    this.logger.error(message, {
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.stack) this.logger.debug(error.stack);
  }

  /**
   * Stop with an error for a person: the message, and on a line of its own
   * the next step, if there is one. Use this, not oclif's `this.error`, so
   * every error looks the same.
   */
  protected fail(
    message: string,
    {
      hint,
      exitCode = EXIT_CODES.usage,
      code = 'command-failed',
    }: { hint?: string; exitCode?: number; code?: string } = {}
  ): never {
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

  /** The command that shows this command's help, for hints. */
  protected helpCommand(): string | undefined {
    return this.id ? `chronicle ${this.id.replaceAll(':', ' ')} --help` : undefined;
  }

  /**
   * Fail because of `error`: its message, after `context` when given. An exit
   * already on its way out (from `fail` or `exit`) passes through, so a
   * command's catch-all doesn't report a failure twice.
   */
  protected failFrom(error: unknown, context?: string): never {
    if (error instanceof Errors.ExitError || isReported(error)) throw error;
    const { message, hint, code, exitCode } = describeError(error);
    // A typed error says what happened on its own, and keeps its code and exit code.
    if (code !== 'internal') this.fail(message, { ...(hint && { hint }), code, exitCode });
    this.fail(context ? `${context}: ${message}` : message, { ...(hint && { hint }) });
  }

  /**
   * Every error that leaves a command is shown the way `fail` shows one,
   * including oclif's own (an unknown flag, a missing argument), whose "See
   * more help" becomes a hint. Exits and cancellations pass through, and an
   * error already reported as an event isn't shown twice.
   */
  protected override async catch(err: { exitCode?: number } & Error): Promise<any> {
    const exit = (err as any)?.oclif?.exit;
    if (err instanceof Errors.ExitError || isReported(err)) return super.catch(err);
    // Cancelling (Esc in a picker, Ctrl+C in a run) is a choice, not a
    // failure: said plainly, exiting 130 as an interrupt does.
    if (exit === 130) {
      this.logger.info(err.message || 'Cancelled');
      this.logger.flush();
      throw new Errors.ExitError(130);
    }
    // A flag value its extractor's schema rejected: say which flag, and why.
    const { issues } = err as { issues?: { path: (string | number)[]; message: string }[] };
    if (err?.name === 'ZodError' && Array.isArray(issues)) {
      this.fail(issues.map(issue => `--${issue.path.join('.')}: ${issue.message}`).join('; '), {
        ...(this.helpCommand() && { hint: `Run \`${this.helpCommand()}\` to see its flags.` }),
      });
    }
    const described = describeError(err);
    // oclif's own failures (a bad flag, a missing argument) are usage errors.
    const usage = described.code === 'internal' && exit === EXIT_CODES.usage;
    const { message, hint, stack } = described;
    const code = usage ? 'usage' : described.code;
    const exitCode = usage ? EXIT_CODES.usage : described.exitCode;
    const seeHelp = /\n?\s*See more help with --help\s*$/;
    const help = this.helpCommand();
    const helpHint = seeHelp.test(message) && help ? `Run \`${help}\` for help.` : undefined;
    this.logger.emit({
      level: 'error',
      kind: 'error',
      message: message.replace(seeHelp, ''),
      error: { code, exitCode },
      ...((hint ?? helpHint) && { hint: { action: (hint ?? helpHint)! } }),
    });
    // A bug's stack, for --verbose.
    if (code === 'internal' && stack) this.logger.debug(stack);
    this.logger.flush();
    throw new Errors.ExitError(
      code === 'internal' ? (typeof exit === 'number' ? exit : exitCode) : exitCode
    );
  }

  protected override async finally(_: Error | undefined): Promise<any> {
    // called after run and catch regardless of whether or not the command errored
    return super.finally(_);
  }

  public override async init(): Promise<any> {
    // Output first, from raw argv: anything said while parsing follows it.
    this.installOutput(outputFlagsIn(this.argv));
    await super.init();
    // A command that reads its own argv (any flags at all) parses nothing here.
    if (!(this.ctor as unknown as typeof BaseCommand).parsesInInit) return;
    const { args, flags, metadata } = await this.parse({
      args: this.ctor.args,
      baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
      enableJsonFlag: this.ctor.enableJsonFlag,
      flags: this.ctor.flags,
      strict: this.ctor.strict,
    });

    this.flags = await this.resolveCommandFlags(flags, metadata);
    this.args = args as Args<T>;
    this.installOutput(this.flags as OutputFlags);

    if (shouldReadStdin({ isTTY: process.stdin.isTTY, acceptsStdin: this.acceptsPipedStdin() })) {
      BaseCommand.stdin = await read(process.stdin);
    }
  }

  protected async resolveCommandFlags(
    flags: Record<string, any>,
    metadata: any
  ): Promise<Flags<T>> {
    const defaults: Record<string, any> = {};
    const explicit: Record<string, any> = {};
    for (const [key, value] of Object.entries(flags)) {
      (metadata?.flags?.[key]?.setFromDefault ? defaults : explicit)[key] = value;
    }
    const resolver = new FlagResolver(new ConfigManager(this.config.configDir));
    const resolved = await resolver.resolveFlags(
      explicit,
      resolver.parsePresetNames(flags.preset),
      this.getEnvironmentVariables(),
      defaults
    );
    this.flagSources = resolved.sources;
    return resolved.flags as Flags<T>;
  }

  /** Called after argument parsing so commands can opt in only when stdin is used. */
  protected acceptsPipedStdin(): boolean {
    return (this.constructor as typeof BaseCommand).acceptsStdin;
  }

  /**
   * Get environment variables that might override flags
   * Override in subclasses to specify which env vars to check
   */
  protected getEnvironmentVariables(): Record<string, any> {
    return {};
  }

  /**
   * Get schema defaults for flag resolution
   * Override in subclasses to provide schema defaults
   */
  protected getSchemaDefaults(): Record<string, any> {
    return {};
  }
}
