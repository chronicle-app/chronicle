import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager } from '../../auth/index.js';

export default class AuthStatus extends BaseCommand<typeof AuthStatus> {
  static override description = 'Show stored credential status for a source';

  static override examples = ['chronicle auth status spotify'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  static override args = {
    provider: Args.string({ description: 'OAuth provider name', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AuthStatus);
    const { provider } = args;

    try {
      const entries = await CredentialManager.getAllCredentials(provider);

      if (entries.length === 0) {
        this.log(`No credentials stored for ${provider}`);
        this.log(`Run \`chronicle auth login ${provider}\` to sign in.`);
        return;
      }

      // One block per signed-in account.
      for (const credentials of entries) {
        const { account } = credentials;
        // Each entry by its own expiry: checking one doesn't refresh another.
        const isExpired = CredentialManager.isTokenExpired(credentials);
        const status = isExpired
          ? credentials.refreshToken
            ? 'Expired (refreshes on next use)'
            : '⚠️  Expired/Invalid'
          : '✅ Valid';

        this.log(`${provider} credentials:`);
        if (account) {
          this.log(`  Account: ${account}`);
        }
        this.log(`  Status: ${status}`);
        this.log(`  Token Type: ${credentials.tokenType}`);
        this.log(`  Created: ${new Date(credentials.createdAt).toLocaleString()}`);

        if (credentials.expiresIn) {
          const expiresAt = new Date(
            new Date(credentials.createdAt).getTime() + credentials.expiresIn * 1000
          );
          this.log(`  Expires: ${expiresAt.toLocaleString()}`);
          this.log(`  Expired: ${isExpired ? 'Yes' : 'No'}`);
        }

        if (credentials.scope) {
          this.log(`  Scopes: ${credentials.scope}`);
        }

        this.log(`  Has Refresh Token: ${credentials.refreshToken ? 'Yes' : 'No'}`);
      }
    } catch (error) {
      this.failFrom(error, `Failed to check status for ${provider}`);
    }
  }
}
