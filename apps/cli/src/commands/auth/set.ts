import { Args, Flags } from '@oclif/core';
import * as readline from 'node:readline';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager } from '../../auth/index.js';

export default class AuthSet extends BaseCommand<typeof AuthSet> {
  static override description = 'Store a static API key / access token for a source (non-OAuth)';

  static override examples = [
    'chronicle auth set pinboard --token user:HEXTOKEN',
    'chronicle auth set pinboard            # prompts for the token (not echoed)',
    'chronicle auth set lastfm --token API_KEY --username hyfen',
    'chronicle auth set lastfm --username hyfen   # add username to an existing token',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    token: Flags.string({
      description: 'The API key / access token. Omit to be prompted (not echoed).',
    }),
    username: Flags.string({
      description:
        'Account username to store alongside the token, for sources whose API needs it (e.g. lastfm).',
    }),
  };

  static override args = {
    provider: Args.string({ description: 'Source name (e.g. pinboard)', required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AuthSet);
    const { provider } = args;

    const existing = await CredentialManager.getCredentials(provider);

    // Allow updating just the username on an existing credential without
    // re-entering the token; otherwise require a token (flag or prompt).
    let token = flags.token?.trim();
    if (!token) {
      token =
        flags.username && existing?.accessToken
          ? existing.accessToken
          : (await this.readToken()).trim();
    }
    if (!token) {
      this.error('No token provided.');
    }

    // Carry forward a previously stored username when only the token is being set.
    const username = flags.username?.trim() || existing?.username;

    // A static token has no OAuth lifecycle, so it's stored as a single
    // `accessToken` with `token_type: 'static'` and no expiry. Replace any
    // existing credential rather than appending, so `auth set` is idempotent
    // (storeCredentials pushes onto the provider's array; getCredentials reads
    // the most recent).
    await CredentialManager.removeCredentials(provider);
    await CredentialManager.storeCredentials(provider, {
      provider,
      access_token: token,
      token_type: 'static',
      created_at: new Date().toISOString(),
      ...(username && { username }),
    });

    this.log(`✅ Stored credentials for ${provider}`);
    if (username) {
      this.log(`   username: ${username}`);
    }
    this.log(`   ${CredentialManager.getCredentialsPath()}`);
  }

  // Read the token from an interactive prompt without echoing it, so it never
  // lands in shell history or the terminal scrollback. Non-interactive callers
  // must pass --token (reading piped stdin races the CLI bootstrap, which may
  // consume it first).
  private async readToken(): Promise<string> {
    if (!process.stdin.isTTY) {
      this.error('No token provided. Pass --token when running non-interactively.');
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const muted = { value: false };
    // Suppress echo of typed characters while the answer is being entered.
    const output = rl as unknown as { output: NodeJS.WritableStream };
    const realWrite = output.output.write.bind(output.output);
    (output.output as { write: (s: string) => boolean }).write = (chunk: string) =>
      muted.value ? true : realWrite(chunk);

    return new Promise((resolve, reject) => {
      rl.once('SIGINT', () => {
        output.output.write = realWrite;
        rl.close();
        reject(Object.assign(new Error('Input cancelled'), { exitCode: 130 }));
      });
      rl.question('Token: ', answer => {
        output.output.write = realWrite;
        rl.close();
        process.stderr.write('\n');
        resolve(answer);
      });
      muted.value = true;
    });
  }
}
