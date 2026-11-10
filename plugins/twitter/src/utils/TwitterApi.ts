import { TokenHelper } from '@chronicle.app/auth';
import { AuthRequired, RateLimited } from '@chronicle.app/etl';

/** The longest a run waits for a rate-limit window to reset before giving up. */
const MAX_RATE_LIMIT_WAIT_MS = 16 * 60 * 1000;

export interface ApiUser {
  id: string;
  username: string;
  name: string;
}

export interface ApiTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: { type: 'replied_to' | 'quoted' | 'retweeted'; id: string }[];
  attachments?: { media_keys?: string[] };
  entities?: {
    mentions?: { username: string; id?: string; start: number; end: number }[];
    /** A link to the post's own photo or video has the media's key. */
    urls?: { url: string; expanded_url?: string; display_url?: string; media_key?: string }[];
    hashtags?: { tag: string }[];
  };
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  };
  /** The full text of a post longer than 280 characters; `text` is cut short. */
  note_tweet?: { text: string; entities?: ApiTweet['entities'] };
  lang?: string;
  /** Its photos and videos, from the page's `includes`. */
  media?: ApiMedia[];
  /** Who posted it, from the page's `includes`, when asked for. */
  author?: ApiUser;
}

/** A photo, video, or GIF (a short video) attached to a post. */
export interface ApiMedia {
  /** The media's id after its type: `3_<id>` for a photo. */
  media_key: string;
  type: 'photo' | 'video' | 'animated_gif';
  /** A photo's file. */
  url?: string;
  /** A video's files, at each bitrate. */
  variants?: { bit_rate?: number; content_type: string; url: string }[];
  width?: number;
  height?: number;
  alt_text?: string;
}

interface Includes {
  media?: ApiMedia[];
  users?: ApiUser[];
}

interface Page<T> {
  data?: T[];
  includes?: Includes;
  meta?: { next_token?: string; result_count?: number };
}

/** The fields every post read asks for. */
export const TWEET_FIELDS = [
  'created_at',
  'author_id',
  'conversation_id',
  'in_reply_to_user_id',
  'referenced_tweets',
  'attachments',
  'entities',
  'public_metrics',
  'note_tweet',
  'lang',
].join(',');

const MEDIA_FIELDS = 'type,url,variants,width,height,alt_text';

/** What a post read asks for: its fields and its photos and videos. */
export const POST_PARAMS = {
  'tweet.fields': TWEET_FIELDS,
  expansions: 'attachments.media_keys',
  'media.fields': MEDIA_FIELDS,
};

/**
 * A post read that also asks who posted each, for their handle, which a
 * post's page is under. X bills each account it returns, so reads of your own
 * tweets don't ask.
 */
export const POST_PARAMS_WITH_AUTHORS = {
  ...POST_PARAMS,
  expansions: 'attachments.media_keys,author_id',
  'user.fields': 'username,name',
};

/**
 * A thin client for the X API v2 with the signed-in user's OAuth 2.0 token.
 * A refused token is refreshed once (an access token lasts two hours), and a
 * rate-limited request waits for the window to reset.
 */
export class TwitterApi {
  /** Where requests go; tests point it at a local server. */
  static baseUrl = 'https://api.x.com';

  private token?: string;

  constructor(
    private readonly options: {
      accessToken?: string;
      log?: (message: string) => void;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {}

  async me(): Promise<ApiUser> {
    const body = await this.get<{ data: ApiUser }>('/2/users/me');
    return body.data;
  }

  /** Every item of a paginated list, newest first, page by page. */
  async *pages<T>(path: string, params: Record<string, string> = {}): AsyncGenerator<T> {
    let next: string | undefined;
    do {
      const page = await this.page<T>(path, params, next);
      yield* page.items;
      next = page.next;
    } while (next);
  }

  /** One page of a paginated list, and the token for the page after it. */
  async page<T>(
    path: string,
    params: Record<string, string>,
    token?: string
  ): Promise<{ items: T[]; next?: string }> {
    const page = await this.get<Page<T>>(path, {
      ...params,
      ...(token && { pagination_token: token }),
    });
    return { items: withIncludes(page.data ?? [], page.includes), next: page.meta?.next_token };
  }

  /** Posts by id, up to 100, with what `params` asks for; one X no longer has is left out. */
  async lookup(ids: string[], params: Record<string, string>): Promise<ApiTweet[]> {
    if (ids.length === 0) return [];
    const page = await this.get<Page<ApiTweet>>('/2/tweets', { ...params, ids: ids.join(',') });
    return withIncludes(page.data ?? [], page.includes);
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, TwitterApi.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let refreshed = Boolean(this.options.accessToken);
    for (;;) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      });

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.token = await TokenHelper.getValidToken('twitter', { refresh: true });
        continue;
      }
      if (response.status === 429) {
        await this.waitForReset(response);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new AuthRequired(`X refused the request: ${await problem(response)}`, {
          source: 'twitter',
        });
      }
      if (!response.ok) {
        throw new Error(`X API ${path} failed with ${response.status}: ${await problem(response)}`);
      }
      return (await response.json()) as T;
    }
  }

  private async accessToken(): Promise<string> {
    this.token ??= this.options.accessToken ?? (await TokenHelper.getValidToken('twitter'));
    return this.token;
  }

  private async waitForReset(response: Response): Promise<void> {
    const reset = Number(response.headers.get('x-rate-limit-reset'));
    const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 - Date.now() + 1000 : 60_000;
    if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
      throw new RateLimited('X’s rate limit is used up for now', {
        retryAfter: Math.ceil(waitMs / 1000),
      });
    }
    this.options.log?.(`Rate limited by X; waiting ${Math.ceil(waitMs / 1000)}s`);
    await (this.options.sleep ?? sleep)(Math.max(waitMs, 0));
  }
}

/** Each post with its media and author from the response's `includes`. */
function withIncludes<T>(items: T[], includes: Includes | undefined): T[] {
  const media = new Map((includes?.media ?? []).map(item => [item.media_key, item]));
  const users = new Map((includes?.users ?? []).map(user => [user.id, user]));
  return items.map(item => {
    const tweet = item as ApiTweet;
    const attached = (tweet.attachments?.media_keys ?? []).flatMap(key => media.get(key) ?? []);
    const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
    return {
      ...item,
      ...(attached.length > 0 && { media: attached }),
      ...(author && { author }),
    };
  });
}

async function problem(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return body.detail ?? body.title ?? body.error_description ?? text;
  } catch {
    return text || response.statusText;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
