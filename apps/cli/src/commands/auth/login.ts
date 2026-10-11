import { Args, Errors, Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { OAuthCommand } from '../../auth/OAuthCommand.js';
import { OAuthProviderRegistry } from '../../auth/ProviderRegistry.js';
import { definitions, stdoutWidth, tokens, type Segment } from '../../output/index.js';

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static override description = 'Sign in to a provider in the browser';

  static override examples = [
    {
      description: 'Sign in with your own OAuth client.',
      command: 'chronicle auth login lastfm --client-id <id> --client-secret <secret>',
    },
    {
      description: 'Sign in again with the client from last time.',
      command: 'chronicle auth login lastfm',
    },
    {
      description: 'Set up your own Google client, step by step.',
      command: 'chronicle auth login google',
    },
    {
      description: 'Add Drive to a Google sign-in.',
      command: 'chronicle auth login google --add drive',
    },
    { description: 'List the providers.', command: 'chronicle auth login --list' },
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    'client-id': Flags.string({ summary: 'Your OAuth client ID', helpValue: '<id>' }),
    'client-secret': Flags.string({ summary: 'Your OAuth client secret', helpValue: '<secret>' }),
    'client-file': Flags.string({
      summary: 'An OAuth client file downloaded from the provider’s console',
      helpValue: '<file>',
    }),
    add: Flags.string({
      summary: 'Access to add to what you granted before, like gmail,calendar',
      helpValue: '<access,...>',
    }),
    setup: Flags.boolean({
      summary: 'Set up a new OAuth client, for providers with a guided setup',
      default: false,
    }),
    port: Flags.integer({
      summary: 'The port the browser comes back to after you sign in',
      helpValue: '<port>',
      default: 7463, // Spells "CHRO" on phone keypad
    }),
    scopes: Flags.string({ summary: 'OAuth scopes, comma-separated', helpValue: '<scope,...>' }),
    'no-browser': Flags.boolean({
      summary: 'Print the sign-in link instead of opening the browser',
      default: false,
    }),
    timeout: Flags.integer({
      summary: 'Seconds to wait for you to sign in',
      helpValue: '<seconds>',
      default: 300,
    }),
    list: Flags.boolean({ summary: 'List the providers you can sign in to', default: false }),
  };

  static override args = {
    provider: Args.string({
      description: 'A provider, like lastfm or google',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AuthLogin);

    if (flags.list) {
      const providers = await OAuthCommand.listProviders(this.config);
      if (providers.length === 0) {
        this.fail('No providers to sign in to', {
          hint: 'Run `chronicle plugins` to see the installed plugins.',
        });
      }
      const t = tokens({ stream: 'stdout', theme: flags.theme });
      const rows = [...providers].sort().map(provider => {
        const config = OAuthProviderRegistry.get(provider)?.getConfig();
        return {
          term: [[provider, t.command]] as Segment[],
          text: config?.requiresClientSecret ? 'Needs a client secret' : '',
        };
      });
      for (const line of definitions(rows, t, stdoutWidth(), 0)) this.log(line);
      return;
    }

    if (!args.provider) {
      this.fail('No provider given', { hint: 'Run `chronicle auth login --list` to see them.' });
    }

    try {
      const oauthCommand = new OAuthCommand(args.provider, {
        clientId: flags['client-id'],
        clientSecret: flags['client-secret'],
        clientFile: flags['client-file'],
        add: flags.add?.split(',').map(s => s.trim()),
        fresh: flags.setup,
        port: flags.port,
        scopes: flags.scopes?.split(',').map(s => s.trim()),
        noBrowser: flags['no-browser'],
        timeout: flags.timeout,
      });

      // The summary says who signed in; tokens stay in the credentials file.
      await oauthCommand.execute();
    } catch (error) {
      // Ctrl-C is a choice, not a failure.
      if ((error as { exitCode?: number })?.exitCode === 130) {
        this.logger.info('Sign-in cancelled');
        this.logger.flush();
        throw new Errors.ExitError(130);
      }
      this.failFrom(error, "Couldn't sign in");
    }
  }
}
