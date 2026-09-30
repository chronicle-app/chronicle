import axios, { AxiosAdapter, AxiosInstance, AxiosRequestConfig, isAxiosError } from 'axios';
import { AuthRequired, RateLimited } from '@chronicle.app/logging';
import { delay, paginateByPage, paginateCursor, paginateOffset } from './pagination.js';

/** Authentication was rejected (HTTP 401) — the token is missing or stale. */
export class ApiAuthError extends AuthRequired {
  readonly status = 401;
}

/** The API asked us to back off (HTTP 429). */
export class ApiRateLimitError extends RateLimited {
  readonly status = 429;

  /** Parsed Retry-After header, when the API provided one. */
  get retryAfterSeconds(): number | undefined {
    return this.retryAfter;
  }
}

export interface ApiProxyOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  /** Default wait between paginated requests, in ms. */
  pageDelayMs?: number;
  /** Custom axios adapter — lets tests mock the HTTP layer. */
  adapter?: AxiosAdapter;
}

/**
 * Base class for plugin API proxies: one axios client, bearer-token
 * injection, 401/429 mapping to typed errors, a shared rate-limit delay, and
 * the three pagination strategies.
 *
 * Credential loading stays in the subclass (`initialize()`), because the
 * credential store lives in the CLI package and the dependency points the
 * other way. A typical subclass reads its stored credentials there, then
 * calls `setAccessToken` (APIs with bearer auth) or keeps its own fields
 * (APIs with query-param auth).
 */
export abstract class ApiProxy {
  protected client: AxiosInstance;
  protected accessToken?: string;
  protected pageDelayMs: number;

  constructor(options: ApiProxyOptions = {}) {
    this.client = axios.create({
      baseURL: options.baseURL,
      headers: options.headers,
      adapter: options.adapter,
    });
    this.pageDelayMs = options.pageDelayMs ?? 0;
  }

  /** Load credentials and prepare the client; called once before use. */
  abstract initialize(): Promise<void>;

  protected setAccessToken(token: string | undefined): void {
    this.accessToken = token;
  }

  /**
   * Perform one request: injects the bearer header when an access token is
   * set, and maps 401/429 to `ApiAuthError`/`ApiRateLimitError`. All other
   * errors pass through untouched.
   */
  protected async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.request<T>({
        ...config,
        headers: {
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          ...(config.headers as Record<string, string> | undefined),
        },
      });
      return response.data;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  protected mapError(error: unknown): unknown {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) {
        return new ApiAuthError(
          `${this.constructor.name}: authentication failed (401) — re-authorize this source and retry`
        );
      }
      if (status === 429) {
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        return new ApiRateLimitError(`${this.constructor.name}: rate limited (429)`, {
          ...(Number.isFinite(retryAfter) && { retryAfter }),
        });
      }
    }
    return error;
  }

  protected delay(ms: number = this.pageDelayMs): Promise<void> {
    return delay(ms);
  }

  protected paginateOffset<T>(
    options: Omit<Parameters<typeof paginateOffset<T>>[0], 'pageDelayMs'>
  ): Promise<T[]> {
    return paginateOffset<T>({ ...options, pageDelayMs: this.pageDelayMs });
  }

  protected paginateByPage<T>(
    options: Omit<Parameters<typeof paginateByPage<T>>[0], 'pageDelayMs'>
  ): Promise<T[]> {
    return paginateByPage<T>({ ...options, pageDelayMs: this.pageDelayMs });
  }

  protected paginateCursor<T>(
    options: Omit<Parameters<typeof paginateCursor<T>>[0], 'pageDelayMs'>
  ): Promise<T[]> {
    return paginateCursor<T>({ ...options, pageDelayMs: this.pageDelayMs });
  }
}
