import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import {
  type ApiMedia,
  type ApiTweet,
  type ApiUser,
  POST_PARAMS_WITH_AUTHORS,
  TwitterApi,
} from '../../utils/TwitterApi.js';
import { type TimedPost, timedList } from '../../utils/actionTimes.js';
import { type TweetMedia, bestVideo } from '../../utils/media.js';
import TwitterTransformer from '../TwitterTransformer.js';

/** A timeline can't go back further than this; X refuses a window before it. */
const TIMELINE_START = Date.parse('2010-11-06T00:00:01Z');

/**
 * Reads the signed-in account through the X API v2. Records take the
 * archive's shapes, so the transformer and the keys are shared: a tweet or
 * like seen through both lands on the same nodes.
 */
export abstract class TwitterApiExtractor extends Extractor<typeof TwitterApiExtractor> {
  static override source = 'twitter';
  static override strategy = 'api';
  static override delivery = 'api' as const;
  static override defaultTransformer = TwitterTransformer;
  static override schema = Extractor.schema.extend({
    accessToken: z
      .string()
      .optional()
      .describe('An X OAuth 2.0 user access token (default: the stored sign-in)'),
  });

  protected api!: TwitterApi;
  protected user!: ApiUser;

  override async setup(): Promise<void> {
    this.api = new TwitterApi({
      accessToken: this.config.accessToken,
      log: message => this.logger.info(message),
    });
    this.user = await this.api.me();
  }

  /** The tweet's id: X's own, the same through the archive and the API. */
  override keyOf(record: Record): string | null {
    const data = record.data as { id?: string; tweetId?: string };
    return data.id ?? data.tweetId ?? null;
  }

  /** A liked or bookmarked post's text, which its `type` would otherwise stand in for. */
  override titleOf(record: Record): string | undefined {
    return (record.data as { fullText?: string }).fullText;
  }

  /** Each post this kind reads, newest first, with the record data it becomes. */
  protected abstract read(): AsyncGenerator<{ data: object; tweet: ApiTweet }>;

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for await (const { data, tweet } of this.read()) {
      yield this.createRecord(data, {
        strategy: 'api',
        accountInfo: {
          accountId: this.user.id,
          username: this.user.username,
          accountDisplayName: this.user.name,
        },
        originalData: tweet,
      });
      count++;
      // Stop before the next post is read: X bills each one.
      if (this.shouldStopExtracting(count)) return;
    }
  }

  /**
   * A page as large as a limited run keeps, between the endpoint's smallest
   * and X's largest, 100: X bills every post a page returns.
   */
  protected pageSize(min: number): number {
    const limit = this.getEffectiveLimit();
    return limit === null ? 100 : Math.min(100, Math.max(min, limit));
  }

  /**
   * A timeline's posts at `path`, newest first, within since and until. A
   * retweet comes with the post it retweets, looked up once a page; one X no
   * longer has is just its id.
   */
  protected async *timeline(
    path: string,
    params: { [param: string]: string }
  ): AsyncGenerator<{ tweet: ApiTweet; retweeted?: ApiTweet | { id: string } }> {
    const { since, until } = this.config;
    if (until && until.getTime() <= TIMELINE_START) return;
    const query = {
      ...params,
      max_results: String(this.pageSize(5)),
      ...(since && since.getTime() > TIMELINE_START && { start_time: since.toISOString() }),
      ...(until && { end_time: until.toISOString() }),
    };
    let token: string | undefined;
    do {
      const page = await this.api.page<ApiTweet>(path, query, token);
      const ids = [...new Set(page.items.flatMap(tweet => retweetedId(tweet) ?? []))];
      const originals = new Map(
        (await this.api.lookup(ids, POST_PARAMS_WITH_AUTHORS)).map(tweet => [tweet.id, tweet])
      );
      for (const tweet of page.items) {
        const id = retweetedId(tweet);
        yield { tweet, ...(id && { retweeted: originals.get(id) ?? { id } }) };
      }
      token = page.next;
    } while (token);
  }

  /** Your likes or bookmarks at `path`, with when you liked or bookmarked each. */
  protected timedPosts(path: string, minPageSize: number): AsyncGenerator<TimedPost> {
    return timedList(this.api, path, {
      minPageSize,
      fullPageSize: this.pageSize(minPageSize),
      params: POST_PARAMS_WITH_AUTHORS,
      since: this.config.since,
      until: this.config.until,
      warn: message => this.logger.warn(message),
    });
  }
}

/** A post's text in full: a long post's `text` is cut at 280 characters. */
export function fullText(tweet: ApiTweet): string {
  return tweet.note_tweet?.text ?? tweet.text;
}

/**
 * The v2 mentions, links, and hashtags in the archive's v1.1 shape, which
 * the transformer reads.
 * A long post's are in its `note_tweet`, but a quoted post's link is only in
 * the short version's, so both count, each once.
 */
export function archiveEntities(tweet: ApiTweet) {
  const all = [tweet.note_tweet?.entities, tweet.entities];
  const mentions = new Map<string, string>();
  const urls = new Map<string, string | undefined>();
  const hashtags = new Set<string>();
  for (const entities of all) {
    for (const hashtag of entities?.hashtags ?? []) hashtags.add(hashtag.tag);
    // A mention without an id is left to the transformer's handle fallback.
    for (const mention of entities?.mentions ?? []) {
      if (mention.id) mentions.set(mention.id, mention.username);
    }
    // A link to the post's own photo or video isn't one it makes: the media
    // is attached, as the archive has it.
    for (const url of entities?.urls ?? []) {
      if (!url.media_key && !urls.has(url.url)) urls.set(url.url, url.expanded_url);
    }
  }
  return {
    user_mentions: [...mentions].map(([id, username]) => ({ id_str: id, screen_name: username })),
    urls: [...urls].map(([url, expanded]) => ({ url, expanded_url: expanded })),
    hashtags: [...hashtags].map(text => ({ text })),
  };
}

/**
 * A post you liked or bookmarked, in the archive's like shape, with its
 * author and, as a tweet has, its mentions, links, hashtags, and media.
 */
export function likedOrSaved(tweet: ApiTweet): object {
  const media = mediaOf(tweet);
  return {
    tweetId: tweet.id,
    fullText: fullText(tweet),
    expandedUrl: `https://twitter.com/i/web/status/${tweet.id}`,
    authorId: tweet.author_id,
    ...(tweet.author && {
      author: { id: tweet.author.id, username: tweet.author.username, name: tweet.author.name },
    }),
    postedAt: tweet.created_at,
    entities: archiveEntities(tweet),
    ...(media.length > 0 && { media }),
  };
}

/**
 * A post in the archive's tweet shape, with its author, media, and, for a
 * retweet, the post it retweets.
 */
export function postData(tweet: ApiTweet, retweeted?: ApiTweet | { id: string }): object {
  const metrics = tweet.public_metrics ?? {};
  const media = mediaOf(tweet);
  return {
    id: tweet.id,
    text: fullText(tweet),
    created_at: tweet.created_at,
    favorite_count: metrics.like_count ?? 0,
    retweet_count: metrics.retweet_count ?? 0,
    in_reply_to_status_id: tweet.referenced_tweets?.find(ref => ref.type === 'replied_to')?.id,
    in_reply_to_user_id: tweet.in_reply_to_user_id,
    entities: archiveEntities(tweet),
    ...(tweet.author_id && { authorId: tweet.author_id }),
    ...(tweet.author && {
      author: { id: tweet.author.id, username: tweet.author.username, name: tweet.author.name },
    }),
    ...(media.length > 0 && { media }),
    ...(retweeted && {
      retweeted: 'text' in retweeted ? postData(retweeted) : { id: retweeted.id },
    }),
  };
}

/** The post a retweet retweets, by id. */
function retweetedId(tweet: ApiTweet): string | undefined {
  return tweet.referenced_tweets?.find(ref => ref.type === 'retweeted')?.id;
}

/** A post's photos and videos, keyed by X's media id, the same as the archive's. */
function mediaOf(tweet: ApiTweet): TweetMedia[] {
  return (tweet.media ?? []).map((media: ApiMedia) => {
    const url = media.type === 'photo' ? media.url : bestVideo(media.variants ?? []);
    return {
      id: media.media_key.split('_').pop() ?? media.media_key,
      type: media.type,
      ...(url && { url }),
      ...(media.width && { width: media.width }),
      ...(media.height && { height: media.height }),
      ...(media.alt_text && { altText: media.alt_text }),
    };
  });
}

/**
 * A record's time: its instant, or else the end of its stretch, which keeps
 * the list in order.
 */
export function timeOf(data: any, at: string, during: string): Date | undefined {
  const time = data?.[at] ?? data?.[during]?.split('/')[1];
  return time ? new Date(time) : undefined;
}
