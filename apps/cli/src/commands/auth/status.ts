import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager } from '../../auth/index.js';
import { card, date, stdoutWidth, tokens } from '../../output/index.js';

export default class AuthStatus extends BaseCommand<typeof AuthStatus> {
  static override description = "Show a provider's stored credentials";

  static override examples = ['chronicle auth status spotify'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  static override args = {
    provider: Args.string({ description: 'A provider, like spotify', required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AuthStatus);
    const { provider } = args;

    let entries;
    try {
      entries = await CredentialManager.getAllCredentials(provider);
    } catch (error) {
      this.failFrom(error, `Couldn't read the credentials for ${provider}`);
    }

    if (entries.length === 0) {
      this.fail(`No credentials stored for ${provider}`, {
        code: 'no-credentials',
        hint: "Run `chronicle auth list` to see what's stored.",
      });
    }

    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    // One card per signed-in account.
    for (const [i, credentials] of entries.entries()) {
      const { account } = credentials;
      // Each entry by its own expiry: checking one doesn't refresh another.
      const expired = CredentialManager.isTokenExpired(credentials);
      const created = new Date(credentials.createdAt);
      const status = expired
        ? credentials.refreshToken
          ? 'expired, refreshes on next use'
          : 'expired'
        : 'valid';
      const fields: [string, string][] = [
        ...(account ? [['account', account] as [string, string]] : []),
        ['status', status],
        ['type', credentials.tokenType],
        ['created', date(created)],
      ];
      if (credentials.expiresIn) {
        fields.push(['expires', date(new Date(created.getTime() + credentials.expiresIn * 1000))]);
      }
      if (credentials.scope) fields.push(['scopes', credentials.scope]);
      fields.push(['refresh token', credentials.refreshToken ? 'yes' : 'no']);

      if (i > 0) this.log('');
      for (const line of card(provider, fields, t, stdoutWidth())) this.log(line);
    }
  }
}
