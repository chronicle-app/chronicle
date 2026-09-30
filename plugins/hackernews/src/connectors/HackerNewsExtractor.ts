import { Extractor, InputNotFound, Record, z } from '@chronicle.app/etl';
import HackerNewsProxy, { HackerNewsItem, HackerNewsUser } from '../utils/HackerNewsProxy.js';
import HackerNewsTransformer from './HackerNewsTransformer.js';

/** Items fetched at once. The Firebase API has no batch endpoint. */
const CONCURRENCY = 8;

export default abstract class HackerNewsExtractor extends Extractor<typeof HackerNewsExtractor> {
  static override defaultTransformer = HackerNewsTransformer;
  static override source = 'hackernews';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override schema = Extractor.schema.extend({
    // Hacker News has no API credentials: the username is all it needs.
    username: z.string().describe('Hacker News username'),
  });

  protected proxy!: HackerNewsProxy;
  protected user!: HackerNewsUser;

  override async setup(): Promise<void> {
    const { username } = this.config;
    this.proxy = new HackerNewsProxy();
    const user = await this.proxy.getUser(username);
    if (!user) {
      throw new InputNotFound(`Hacker News has no user named ${username}`);
    }
    this.user = user;
  }

  /** The raw item id — Hacker News numbers every item once, across all types. */
  override keyOf(record: Record): string | null {
    const { id } = record.data as HackerNewsItem;
    return id === undefined ? null : String(id);
  }

  protected abstract records(): AsyncGenerator<Record>;

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for await (const record of this.records()) {
      if (this.shouldStopExtracting(count)) return;
      yield record;
      count++;
    }
  }

  protected context(extra: object = {}) {
    return { user: this.user, ...extra };
  }

  /**
   * The user's own items, newest first. With `stopAtSince`, the walk ends at
   * the first item older than `since`: every later id is older still.
   */
  protected async *ownItems({ stopAtSince }: { stopAtSince: boolean }) {
    for await (const item of this.fetchEach(this.user.submitted ?? [])) {
      if (stopAtSince && this.isBeforeSince(item)) return;
      yield item;
    }
  }

  /**
   * The items in order, a batch at a time, without the missing and deleted.
   * A removed item can also come back as just its id and type, with no time,
   * author, or text; it is skipped too.
   */
  protected async *fetchEach(ids: number[]): AsyncGenerator<HackerNewsItem> {
    for (let start = 0; start < ids.length; start += CONCURRENCY) {
      const batch = await Promise.all(
        ids.slice(start, start + CONCURRENCY).map(id => this.proxy.getItem(id))
      );
      for (const item of batch) {
        if (item && !item.deleted && item.time !== undefined) yield item;
      }
    }
  }

  protected isBeforeSince(item: HackerNewsItem): boolean {
    return this.config.since !== undefined && time(item) < this.config.since;
  }

  protected inRange(item: HackerNewsItem): boolean {
    return !this.isBeforeSince(item) && !(this.config.until && time(item) > this.config.until);
  }
}

function time(item: HackerNewsItem): Date {
  return new Date((item.time ?? 0) * 1000);
}
