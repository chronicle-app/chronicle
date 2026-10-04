import { Args, Errors, Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { OAuthCommand } from '../../auth/OAuthCommand.js';
import { OAuthProviderRegistry } from '../../auth/ProviderRegistry.js';

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static override description = 'Authorize a source with OAuth';

  static override examples = [
    'chronicle auth login lastfm --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET',
    'chronicle auth login lastfm --client-id YOUR_CLIENT_ID --port 3000 --no-browser',
    'chronicle auth login lastfm  # reuses client id/secret stored from a previous login',
    'chronicle auth login google  # walks you through creating your own Google client',
    'chronicle auth login google --add drive',
    'chronicle auth login --list',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    'client-id': Flags.string({ description: 'OAuth client ID' }),
    'client-secret': Flags.string({ description: 'OAuth client secret' }),
    'client-file': Flags.string({
      description: 'OAuth client JSON downloaded from the provider’s console',
    }),
    add: Flags.string({
      description: 'Access to add to what was granted before (e.g. gmail,calendar)',
    }),
    setup: Flags.boolean({
      description: 'Set up a new OAuth client, for providers with guided setup',
      default: false,
    }),
    port: Flags.integer({
      description: 'Port for OAuth callback server',
      default: 7463, // Spells "CHRO" on phone keypad
    }),
    scopes: Flags.string({ description: 'OAuth scopes (comma-separated)' }),
    'no-browser': Flags.boolean({
      description: "Don't open browser automatically",
      default: false,
    }),
    timeout: Flags.integer({ description: 'Timeout in seconds', default: 300 }),
    list: Flags.boolean({ description: 'List available OAuth providers', default: false }),
  };

  static override args = {
    provider: Args.string({
      description: 'OAuth provider name (e.g., lastfm, twitter, spotify)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AuthLogin);

    if (flags.list) {
      const providers = await OAuthCommand.listProviders(this.config);
      if (providers.length === 0) {
        this.log('No OAuth providers available. Make sure plugins are installed.');
        return;
      }
      this.log('Available OAuth providers:');
      for (const provider of providers.sort()) {
        const ProviderClass = OAuthProviderRegistry.get(provider);
        const config = ProviderClass?.getConfig();
        this.log(`  ${provider}${config?.requiresClientSecret ? ' (requires client secret)' : ''}`);
      }
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
      this.failFrom(error, 'OAuth authorization failed');
    }
  }
}
