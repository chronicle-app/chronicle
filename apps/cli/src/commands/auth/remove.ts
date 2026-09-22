import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager, TokenHelper } from '../../auth/index.js';

export default class AuthRemove extends BaseCommand<typeof AuthRemove> {
  static override description = 'Remove stored credentials for a source';

  static override examples = ['chronicle auth remove spotify'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  static override args = {
    provider: Args.string({ description: 'OAuth provider name', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AuthRemove);
    const { provider } = args;

    try {
      const hasCredentials = await CredentialManager.hasCredentials(provider);
      if (!hasCredentials) {
        this.log(`No credentials found for ${provider}`);
        return;
      }

      await TokenHelper.removeCredentials(provider);
      this.log(`✅ Removed credentials for ${provider}`);
    } catch (error) {
      this.error(`Failed to remove credentials for ${provider}: ${error}`);
    }
  }
}
