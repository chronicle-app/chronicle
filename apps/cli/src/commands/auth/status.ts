import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager, TokenHelper } from '../../auth/index.js';

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
      const credentials = await CredentialManager.getCredentials(provider);

      if (!credentials) {
        this.log(`No credentials stored for ${provider}`);
        this.log(
          `Authenticate using: chronicle auth login ${provider} --client-id YOUR_ID --client-secret YOUR_SECRET`
        );
        return;
      }

      const isExpired = CredentialManager.isTokenExpired(credentials);
      const hasValid = await TokenHelper.hasValidCredentials(provider);

      this.log(`${provider} credentials:`);
      this.log(`  Status: ${hasValid ? '✅ Valid' : '⚠️  Expired/Invalid'}`);
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
    } catch (error) {
      this.error(`Failed to check status for ${provider}: ${error}`);
    }
  }
}
