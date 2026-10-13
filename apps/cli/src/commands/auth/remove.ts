import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager, TokenHelper } from '../../auth/index.js';

export default class AuthRemove extends BaseCommand<typeof AuthRemove> {
  static override description = "Remove a provider's stored credentials";

  static override examples = ['chronicle auth remove spotify'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  static override args = {
    provider: Args.string({ description: 'A provider, like spotify', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AuthRemove);
    const { provider } = args;

    let stored: boolean;
    try {
      stored = await CredentialManager.hasCredentials(provider);
    } catch (error) {
      this.failFrom(error, `Couldn't read the credentials for ${provider}`);
    }
    if (!stored) {
      this.fail(`No credentials stored for ${provider}`, {
        code: 'no-credentials',
        hint: "Run `chronicle auth list` to see what's stored.",
      });
    }

    try {
      await TokenHelper.removeCredentials(provider);
    } catch (error) {
      this.failFrom(error, `Couldn't remove the credentials for ${provider}`);
    }
    this.summary(`Removed the credentials for ${provider}`);
  }
}
