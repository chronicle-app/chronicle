import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { OAuthCommand } from '../../auth/OAuthCommand.js';
import { OAuthProviderRegistry } from '../../auth/ProviderRegistry.js';

export default class AuthLogin extends BaseCommand<typeof AuthLogin> {
  static override description = 'Authorize a source with OAuth';

  static override examples = [
    'chronicle auth login lastfm --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET',
    'chronicle auth login lastfm --client-id YOUR_CLIENT_ID --port 3000 --no-browser',
    'chronicle auth login lastfm  # reuses client id/secret stored from a previous login',
    'chronicle auth login --list',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    'client-id': Flags.string({ description: 'OAuth client ID' }),
    'client-secret': Flags.string({ description: 'OAuth client secret' }),
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
      this.error('Provider name is required. Use --list to see available providers.');
    }

    try {
      const oauthCommand = new OAuthCommand(args.provider, {
        clientId: flags['client-id'],
        clientSecret: flags['client-secret'],
        port: flags.port,
        scopes: flags.scopes?.split(',').map(s => s.trim()),
        noBrowser: flags['no-browser'],
        timeout: flags.timeout,
      });

      const tokens = await oauthCommand.execute();
      this.log(JSON.stringify(tokens, null, 2));
    } catch (error) {
      this.error(`OAuth authorization failed: ${error}`);
    }
  }
}
