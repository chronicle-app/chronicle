import { PluginScanner } from '../plugins/PluginScanner.js';
import { Config } from '@oclif/core';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { chronicleConfigDir } from '@chronicle.app/auth';
import { OAuthServer } from './OAuthServer.js';
import { OAuthProvider } from './OAuthProvider.js';
import { OAuthProviderRegistry } from './ProviderRegistry.js';
import { BrowserLauncher } from './BrowserLauncher.js';
import { CredentialManager } from './CredentialManager.js';
import { ClientCredentials, OAuthParams, ProviderSetupContext, TokenResponse } from './types.js';
import { EXIT_CODES, ExtractorError, createLogger } from '@chronicle.app/logging';

const logger = createLogger({ scope: 'auth' });

export interface OAuthCommandOptions {
  clientId?: string;
  clientSecret?: string;
  /** A client JSON file downloaded from the provider's console. */
  clientFile?: string;
  port?: number;
  scopes?: string[];
  /** Named scope sets to ask for on top of those already granted. */
  add?: string[];
  noBrowser?: boolean;
  timeout?: number;
  /** Run the provider's setup again from the start. */
  fresh?: boolean;
}

export class OAuthCommand {
  private server: OAuthServer;
  private options: OAuthCommandOptions;
  private providerId: string;
  /** Aborted on Ctrl-C, which also withdraws any question being asked. */
  private aborts = new AbortController();
  private interrupt = () => {};

  constructor(providerId: string, options: OAuthCommandOptions) {
    this.providerId = providerId;
    this.options = options;
    this.server = new OAuthServer();
  }

  /**
   * Execute the OAuth flow
   */
  async execute(): Promise<TokenResponse> {
    await OAuthCommand.listProviders();

    // Validate provider exists
    const ProviderClass = OAuthProviderRegistry.get(this.providerId);
    if (!ProviderClass) {
      throw new Error(
        `Unknown OAuth provider: ${this.providerId}. Available providers: ${OAuthProviderRegistry.getProviderIds().join(', ')}`
      );
    }

    const config = ProviderClass.getConfig();
    const { server, aborts } = this;
    const onInterrupt = () => {
      const cancelled = Object.assign(new Error('Authorization cancelled'), { exitCode: 130 });
      aborts.abort(cancelled);
      server.stop(cancelled);
    };
    this.interrupt = onInterrupt;
    process.once('SIGINT', onInterrupt);

    try {
      const sets = await this.scopeSets(ProviderClass);
      const client = await this.client(ProviderClass, sets);

      // Start OAuth server
      await this.server.start(
        this.options.port || 0,
        this.options.timeout === undefined ? undefined : this.options.timeout * 1000
      );
      const callbackUrl = this.server.getCallbackUrl();

      logger.debug('OAuth server listening', { url: callbackUrl });

      // Create provider instance
      const state = OAuthProvider.generateState();
      const oauthParams: OAuthParams = {
        clientId: client.clientId,
        clientSecret: client.clientSecret || '',
        redirectUri: callbackUrl,
        scopes:
          this.options.scopes ?? (sets.length > 0 ? ProviderClass.scopesFor(sets) : config.scopes),
        state,
        ...(ProviderClass.pkce && { codeVerifier: OAuthProvider.createCodeVerifier() }),
      };

      const provider = new (ProviderClass as any)(oauthParams);
      const authUrl = provider.buildAuthUrl();

      // The URL is the one thing a person must act on, so it isn't cut to fit.
      await this.open(authUrl, this.server.waitForCallback());

      logger.info('Waiting for authorization…');

      // Wait for callback
      const result = await this.server.waitForCallback();

      if (result.error) {
        throw new Error(
          `Authorization failed: ${result.error}${result.error_description ? ` - ${result.error_description}` : ''}`
        );
      }

      // An OAuth2 code comes back with the state it was asked with; anything
      // else came from another page. (Last.fm's token carries no state.)
      if (result.code && result.state !== state) {
        throw new Error('Authorization failed: the reply was for a different sign-in');
      }

      const authCode = result.code || result.token;
      if (!authCode) {
        throw new Error('No authorization code or token received');
      }

      logger.debug('Authorization received; exchanging it for tokens');

      // Exchange code/token for tokens
      const tokens: TokenResponse = await provider.exchangeCodeForToken(authCode);

      // Store credentials in local file for future use
      try {
        await CredentialManager.storeCredentials(
          this.providerId,
          tokens,
          client.clientId,
          client.clientSecret
        );
        logger.emit({
          level: 'info',
          kind: 'summary',
          message: `Signed in to ${this.providerId}`,
          fields: {
            ...(tokens.account && { account: tokens.account }),
            credentials: CredentialManager.getCredentialsPath(),
          },
          sensitive: ['account'],
        });
      } catch (error) {
        // Continue anyway - user still gets the tokens
        logger.warn("Signed in, but couldn't save the credentials", { error: String(error) });
      }

      this.reportMissingScopes(ProviderClass, sets, tokens);
      if (ProviderClass.signedInHint) {
        logger.emit({
          level: 'info',
          kind: 'hint',
          message: '',
          hint: { action: ProviderClass.signedInHint },
        });
      }

      return tokens;
    } finally {
      // Always cleanup
      this.server.stop();
      process.removeListener('SIGINT', onInterrupt);
    }
  }

  /**
   * The named scope sets to ask for: those an earlier sign-in was granted
   * (or the provider's defaults on a first one), plus any added with `--add`.
   */
  private async scopeSets(ProviderClass: typeof OAuthProvider): Promise<string[]> {
    const added = this.options.add ?? [];
    if (Object.keys(ProviderClass.scopeSets).length === 0) {
      if (added.length > 0) {
        throw new Error(`${this.providerId} has no scope sets to add`);
      }
      return [];
    }
    if (this.options.scopes) {
      if (added.length > 0) {
        throw new ExtractorError('Use --scopes or --add, not both', {
          code: 'conflicting-flags',
          exitCode: EXIT_CODES.usage,
          hint: `Run \`chronicle auth login ${this.providerId} --add ${added.join(',')}\` to add access to what you have.`,
        });
      }
      return [];
    }
    const granted = (await CredentialManager.getAllCredentials(this.providerId)).flatMap(entry =>
      ProviderClass.scopeSetsIn(entry.scope)
    );
    const sets = [
      ...new Set([...(granted.length > 0 ? granted : ProviderClass.defaultScopeSets), ...added]),
    ];
    // Checked here, before setup, so a typo doesn't cost a trip to a console.
    ProviderClass.scopesFor(sets);
    return sets;
  }

  /**
   * The OAuth client to sign in with: from the command line, a downloaded
   * client file, the provider's own setup, or an earlier sign-in.
   */
  private async client(
    ProviderClass: typeof OAuthProvider,
    sets: string[]
  ): Promise<ClientCredentials> {
    const config = ProviderClass.getConfig();
    let { clientId, clientSecret } = this.options;

    if (this.options.clientFile) {
      ({ clientId, clientSecret } = await readClientFile(this.options.clientFile));
    }

    if (!clientId && ProviderClass.setup) {
      return ProviderClass.setup(this.setupContext(sets));
    }

    // Fall back to client credentials stored from a previous login, so
    // re-authenticating doesn't require re-passing --client-id/--client-secret.
    if (!clientId || (config.requiresClientSecret && !clientSecret)) {
      const stored = await CredentialManager.getCredentials(this.providerId);
      if (stored) {
        clientId ||= stored.clientId;
        clientSecret ||= stored.clientSecret;
      }
    }

    // Validate required options
    if (!clientId) {
      throw new Error(
        `Client ID is required. Pass --client-id, or run "chronicle auth login ${this.providerId}" once with --client-id (and --client-secret) to store them for reuse.`
      );
    }

    if (config.requiresClientSecret && !clientSecret) {
      throw new Error(
        `Client secret is required for this provider. Pass --client-secret, or run "chronicle auth login ${this.providerId}" once with it to store it for reuse.`
      );
    }

    return { clientId, clientSecret };
  }

  private setupContext(scopeSets: string[]): ProviderSetupContext {
    return {
      logger,
      configDir: chronicleConfigDir(),
      scopeSets,
      interactive: interactive(),
      fresh: Boolean(this.options.fresh),
      signal: this.aborts.signal,
      openUrl: url => this.open(url),
      ask: (prompt, withdrawn) => this.ask(prompt, withdrawn),
    };
  }

  /** Ask at the terminal; Ctrl-C cancels the sign-in. */
  private async ask(prompt: string, withdrawn?: AbortSignal): Promise<string> {
    const { signal } = this.aborts;
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    // At a prompt, readline takes Ctrl-C itself instead of the process.
    readline.once('SIGINT', this.interrupt);
    try {
      const answer = await readline.question(`  ${prompt} `, {
        signal: withdrawn ? AbortSignal.any([signal, withdrawn]) : signal,
      });
      return answer.trim();
    } catch (error) {
      throw signal.aborted ? signal.reason : error;
    } finally {
      readline.close();
    }
  }

  /**
   * Show a page's URL, and open it in the browser once the person presses
   * Enter. Without a terminal to ask at, or a browser, the URL is all.
   */
  private async open(url: string, settled?: Promise<unknown>): Promise<void> {
    // Keyed by the URL, so a run that opens several pages never rolls one
    // up as a repeat: each is a link the person needs.
    logger.emit({
      level: 'info',
      kind: 'notice',
      message: 'Open this URL in your browser',
      fields: { url },
      key: url,
    });
    if (this.options.noBrowser || !interactive() || !(await BrowserLauncher.canOpenBrowser())) {
      return;
    }
    // The person may open the URL themselves: once `settled` (the sign-in
    // callback) arrives, the question is withdrawn and nothing opens.
    const withdrawn = new AbortController();
    const done = settled?.then(
      () => 'done' as const,
      () => 'done' as const
    );
    const pressed = this.ask('Press Enter to open it.', withdrawn.signal).then(
      () => 'pressed' as const,
      error => {
        if (withdrawn.signal.aborted && !this.aborts.signal.aborted) return 'done' as const;
        throw error;
      }
    );
    const first = await Promise.race(done ? [pressed, done] : [pressed]);
    withdrawn.abort();
    if (first === 'done') return;
    try {
      await BrowserLauncher.openUrl(url);
    } catch (error) {
      logger.warn("Couldn't open a browser", { error: String(error) });
    }
  }

  /**
   * Say which asked-for sets weren't granted: a consent page lets a person
   * untick some, and the sources that need them would fail later.
   */
  private reportMissingScopes(
    ProviderClass: typeof OAuthProvider,
    sets: string[],
    tokens: TokenResponse
  ): void {
    if (sets.length === 0 || tokens.scope === undefined) return;
    const granted = new Set(ProviderClass.scopeSetsIn(tokens.scope));
    const missing = sets.filter(set => !granted.has(set));
    if (missing.length === 0) return;
    logger.emit({
      level: 'warn',
      kind: 'notice',
      message: `No access to ${missing.join(' or ')}`,
      hint: {
        action: `Run \`chronicle auth login ${this.providerId}\` again and tick every box on the consent page.`,
      },
    });
  }

  /**
   * List available providers
   */
  static async listProviders(providedConfig?: Config): Promise<string[]> {
    for (const plugin of await PluginScanner.findChroniclePlugins()) {
      await PluginScanner.importPlugin(plugin);
    }
    return OAuthProviderRegistry.getProviderIds();
  }

  /**
   * Check if a provider is available
   */
  static hasProvider(providerId: string): boolean {
    return OAuthProviderRegistry.has(providerId);
  }
}

/**
 * A client file as an OAuth console downloads it: Google nests the client
 * under `installed` (desktop) or `web`; others put it at the top level.
 */
async function readClientFile(path: string): Promise<ClientCredentials> {
  const parsed = JSON.parse(await readFile(path, 'utf-8'));
  const client = parsed.installed ?? parsed.web ?? parsed;
  if (typeof client?.client_id !== 'string') {
    throw new TypeError(`No client_id in ${path}`);
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

/** Whether a person is at a terminal to answer. */
const interactive = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);
