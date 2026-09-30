import { Extractor, InputNotFound, Record, z } from '@chronicle.app/etl';
import { resolveCredentials } from '@chronicle.app/auth';
import HackerNewsProxy, { HackerNewsItem, HackerNewsUser } from '../utils/HackerNewsProxy.js';
import HackerNewsTransformer from './HackerNewsTransformer.js';

/** Items fetched at once. The Firebase API has no batch endpoint. */
const CONCURRENCY = 8;

export default abstract class HackerNewsExtractor extends Extractor<typeof HackerNewsExtractor> {
  static override defaultTransformer = HackerNewsTransformer;
  static override source = 'hacker-news';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override schema = Extractor.schema.extend({
    username: z
      .string()
      .describe('Hacker News username (auto-retrieved from stored credentials if not provided)')
      .optional(),
  });

  protected proxy!: HackerNewsProxy;
  protected user!: HackerNewsUser;

  override async setup(): Promise<void> {
    const { username } = await resolveCredentials(
      'hacker-news',
      { username: { from: ['username', 'handle'] } },
      {
        overrides: { username: this.config.username },
        errorMessage: 'Hacker News username is required. Provide --username.',
      }
    );
    this.proxy = new HackerNewsProxy();
    const user = await this.proxy.getUser(username as string);
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

  /** The items in order, a batch at a time, without the missing and deleted. */
  protected async *fetchEach(ids: number[]): AsyncGenerator<HackerNewsItem> {
    for (let start = 0; start < ids.length; start += CONCURRENCY) {
      const batch = await Promise.all(
        ids.slice(start, start + CONCURRENCY).map(id => this.proxy.getItem(id))
      );
      for (const item of batch) if (item && !item.deleted) yield item;
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
