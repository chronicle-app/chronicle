import { Command, Flags, Interfaces } from '@oclif/core';
import { ConfigManager, FlagResolver, FlagSource } from './config/index.js';

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
  };

  // add the --json flag
  // static override enableJsonFlag = true;

  static stdin: string;

  /** Opt in to reading piped stdin in init(); see shouldReadStdin. */
  static acceptsStdin = false;

  protected args!: Args<T>;
  protected flags!: Flags<T>;
  protected flagSources?: Record<string, FlagSource>;

  protected override async catch(err: { exitCode?: number } & Error): Promise<any> {
    // add any custom logic to handle errors from the command
    // or simply return the parent class error handling
    return super.catch(err);
  }

  protected override async finally(_: Error | undefined): Promise<any> {
    // called after run and catch regardless of whether or not the command errored
    return super.finally(_);
  }

  public override async init(): Promise<any> {
    await super.init();
    const { args, flags, metadata } = await this.parse({
      args: this.ctor.args,
      baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
      enableJsonFlag: this.ctor.enableJsonFlag,
      flags: this.ctor.flags,
      strict: this.ctor.strict,
    });

    this.flags = await this.resolveCommandFlags(flags, metadata);
    this.args = args as Args<T>;

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
