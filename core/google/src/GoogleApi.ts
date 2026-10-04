import { isAxiosError, type AxiosRequestConfig } from 'axios';
import { ApiAuthError, ApiProxy } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';
import { AuthRequired, EXIT_CODES, ExtractorError, RateLimited } from '@chronicle.app/logging';
import { z } from 'zod';
import { GOOGLE_SERVICES, type GoogleService } from './services.js';

/** The options every Google extractor takes: which account, or a token outright. */
export const googleAccountOptions = {
  account: z
    .string()
    .optional()
    .describe('The Google account to use, by email. The default is the last one signed in.'),
  accessToken: z
    .string()
    .optional()
    .describe('A Google access token to use instead of a stored sign-in'),
};

export interface GoogleApiOptions {
  /** Which service this client reads, for the scope and API in its errors. */
  service: GoogleService;
  baseURL: string;
  account?: string;
  accessToken?: string;
  pageDelayMs?: number;
  /** Waits before each retry of a rate-limited request, in ms. */
  retryDelaysMs?: number[];
}

/**
 * Google's per-minute quotas refill within a minute: back off for about that
 * long, doubling, before giving up.
 */
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16_000, 32_000];

/** Google's reasons for a rate limit, as a 403 or a 429. */
const RATE_LIMITED = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'RATE_LIMIT_EXCEEDED',
  'quotaExceeded',
]);

/**
 * A Google REST API, signed in as one account. Google's refusals become
 * typed errors that say what to run: a missing scope adds access, an API
 * that's off gets turned on, an expired sign-in signs in again.
 */
export class GoogleApi extends ApiProxy {
  private readonly service: GoogleService;
  private readonly account?: string;
  private readonly retryDelaysMs: number[];

  constructor(options: GoogleApiOptions) {
    super({ baseURL: options.baseURL, pageDelayMs: options.pageDelayMs ?? 0 });
    this.service = options.service;
    this.account = options.account;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    if (options.accessToken) this.setAccessToken(options.accessToken);
    this.stored = !options.accessToken;
  }

  /** The token came from a stored sign-in, so it can be refreshed. */
  private readonly stored: boolean;

  async initialize(): Promise<void> {
    if (this.accessToken) return;
    this.setAccessToken(await TokenHelper.getValidToken('google', { account: this.account }));
  }

  get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    // Google wants a list as the same name repeated (`labelIds=A&labelIds=B`).
    return this.request<T>({
      method: 'GET',
      url: path,
      params,
      paramsSerializer: { indexes: null },
    });
  }

  /** Every item of a list endpoint, page by page, following `nextPageToken`. */
  async *pages<T>(
    path: string,
    params: Record<string, unknown> = {},
    itemsKey = 'items'
  ): AsyncGenerator<T> {
    let pageToken: string | undefined;
    do {
      const page = await this.get<Record<string, any>>(path, { ...params, pageToken });
      yield* (page[itemsKey] ?? []) as T[];
      pageToken = page.nextPageToken;
      if (pageToken) await this.delay();
    } while (pageToken);
  }

  /**
   * A request, retried with backoff while Google says it's rate limited, and
   * once with a refreshed token when Google refuses one that expired during
   * a long run.
   */
  protected override async request<T>(config: AxiosRequestConfig): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await super.request<T>(config);
      } catch (error) {
        if (error instanceof ApiAuthError && this.stored && !refreshed) {
          refreshed = true;
          this.setAccessToken(
            await TokenHelper.getValidToken('google', { account: this.account, refresh: true })
          );
          continue;
        }
        if (!(error instanceof RateLimited) || attempt >= this.retryDelaysMs.length) throw error;
        await this.delay(this.retryDelaysMs[attempt]);
      }
    }
  }

  protected override mapError(error: unknown): unknown {
    const { label } = GOOGLE_SERVICES[this.service];
    const reasons = isAxiosError(error) ? googleReasons(error.response?.data) : new Set<string>();
    if ([...reasons].some(reason => RATE_LIMITED.has(reason))) {
      return new RateLimited(`Google’s ${label} quota is used up for now`, {
        hint: 'Try again in a minute.',
      });
    }
    if (isAxiosError(error) && error.response?.status === 403) {
      if (
        reasons.has('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
        reasons.has('insufficientPermissions')
      ) {
        return new AuthRequired(`No access to ${label}`, {
          hint: `Run \`chronicle auth login google --add ${this.service}\` to add it.`,
        });
      }
      if (reasons.has('SERVICE_DISABLED') || reasons.has('accessNotConfigured')) {
        // Google says where to turn it on; that page is the quickest way.
        const page = activationUrl(error.response.data);
        return new ExtractorError(`The ${label} API is off in your Google Cloud project`, {
          code: 'api-disabled',
          exitCode: EXIT_CODES.auth,
          hint: page
            ? `Turn it on here, then run this again: ${page}\nOr run \`chronicle auth login google --add ${this.service}\` to turn it on.`
            : `Run \`chronicle auth login google --add ${this.service}\` to turn it on.`,
        });
      }
    }
    if (isAxiosError(error) && error.response?.status === 404) {
      return new ExtractorError(`${label}: not found`, {
        code: 'not-found',
        exitCode: EXIT_CODES.input,
        cause: error,
      });
    }
    const mapped = super.mapError(error);
    if (mapped instanceof ApiAuthError) {
      return new ApiAuthError('Google rejected the stored sign-in', {
        hint: 'Run `chronicle auth login google` to sign in again.',
      });
    }
    // Anything else: Google's own words, not just the status code.
    const said = isAxiosError(error) && googleMessage(error.response?.data);
    if (said && mapped === error) {
      return new ExtractorError(`${label}: ${said}`, {
        code: 'api-error',
        exitCode: EXIT_CODES.internal,
        cause: error,
      });
    }
    return mapped;
  }
}

/** The reasons in a Google error body, from either of its two shapes. */
function googleReasons(body: any): Set<string> {
  const error = body?.error ?? {};
  return new Set<string>(
    [
      ...(error.errors ?? []).map((e: any) => e?.reason),
      ...(error.details ?? []).map((d: any) => d?.reason),
    ].filter((reason): reason is string => typeof reason === 'string')
  );
}

/** The message in a Google error body, if it has one. */
function googleMessage(body: any): string | undefined {
  const message = body?.error?.message;
  return typeof message === 'string' && message ? message : undefined;
}

/** The page that turns an API on, from a Google "service disabled" error. */
function activationUrl(body: any): string | undefined {
  for (const detail of body?.error?.details ?? []) {
    const url = detail?.metadata?.activationUrl;
    if (typeof url === 'string') return url;
  }
  return body?.error?.message?.match(
    /https:\/\/console\.developers\.google\.com\/\S+?(?=\s|$)/
  )?.[0];
}
