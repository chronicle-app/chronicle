import { Args, Flags } from '@oclif/core';
import * as readline from 'node:readline';
import { BaseCommand } from '../../baseCommand.js';
import { CredentialManager } from '../../auth/index.js';

export default class AuthSet extends BaseCommand<typeof AuthSet> {
  static override description = "Store an API key or token for a provider that doesn't use OAuth";

  static override examples = [
    { description: 'Store a token.', command: 'chronicle auth set pinboard --token <token>' },
    { description: 'Type the token in, hidden.', command: 'chronicle auth set pinboard' },
    {
      description: 'Store a key with your username, for a provider whose API needs it.',
      command: 'chronicle auth set lastfm --token <key> --username <username>',
    },
    {
      description: 'Add a username to a stored token.',
      command: 'chronicle auth set lastfm --username <username>',
    },
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    token: Flags.string({
      summary: 'The API key or token. Leave it out to type it in, hidden.',
    }),
    username: Flags.string({
      summary: 'Your username, for a provider whose API needs it, like lastfm',
    }),
  };

  static override args = {
    provider: Args.string({ description: 'A provider, like pinboard', required: true }),
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
      this.fail('No token given', { hint: 'Pass one with `--token`, or type it when asked.' });
    }

    // Carry forward a previously stored username when only the token is being set.
    const username = flags.username?.trim() || existing?.username;

    // A static token has no OAuth lifecycle, so it's stored as a single
    // `accessToken` with `token_type: 'static'` and no expiry. Replace any
    // existing credential, so `auth set` is idempotent.
    await CredentialManager.removeCredentials(provider);
    await CredentialManager.storeCredentials(provider, {
      provider,
      access_token: token,
      token_type: 'static',
      created_at: new Date().toISOString(),
      ...(username && { username }),
    });

    this.summary(
      `Stored the credentials for ${provider}${username ? `, with username ${username}` : ''}`
    );
  }

  // Read the token from an interactive prompt without echoing it, so it never
  // lands in shell history or the terminal scrollback. Non-interactive callers
  // must pass --token (reading piped stdin races the CLI bootstrap, which may
  // consume it first).
  private async readToken(): Promise<string> {
    if (!process.stdin.isTTY) {
      this.fail('No token given', { hint: 'Pass one with `--token` when not at a terminal.' });
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
