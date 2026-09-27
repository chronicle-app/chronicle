import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import PinboardTransformer from './PinboardTransformer.js';
import PinboardProxy from '../utils/PinboardProxy.js';

export class PinboardExtractor extends Extractor<typeof PinboardExtractor> {
  static override source = 'pinboard';
  static override description = 'Bookmarks';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['bookmarks'];
  static override default = true;
  // `/posts/all` re-reports every bookmark with its latest title, description,
  // and tags each run, so it's a state re-read, not an append-only feed:
  // attributes are sighted at read time rather than back-dated to the save
  // instant, letting an edit (a retitled or retagged bookmark) supersede cleanly
  // instead of colliding with the old value at that timestamp. The BookmarkAction
  // keeps its true save date on the timeline. Pinboard is a live API, so each
  // read is a genuine sighting and the default run-start asOfTime is correct.
  // See Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = PinboardTransformer;

  static override schema = Extractor.schema.extend({
    tagBlacklist: z
      .array(z.string())
      .optional()
      .default(['twitterfavs'])
      .describe('Tags to exclude from extraction'),
    apiKey: z
      .string()
      .optional()
      .describe(
        'Pinboard API key for authentication (auto-retrieved from stored credentials if not provided)'
      ),
  });

  private proxy!: PinboardProxy;

  /** The bookmark's `hash` — Pinboard's own id for the saved url, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { hash?: string }).hash ?? null;
  }

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof PinboardExtractor.schema>;
    this.proxy = new PinboardProxy(config.apiKey);
    await this.proxy.initialize();
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof PinboardExtractor.schema>;

    try {
      const posts = await this.proxy.getAllPosts({
        fromdt: config.since,
        todt: config.until,
      });

      this.logger.info(`Retrieved ${posts.length} posts from Pinboard`);

      let totalCount = 0;

      for (const post of posts) {
        // Apply date filtering
        const postDate = new Date(post.time);
        if (config.since && postDate < config.since) continue;
        if (config.until && postDate > config.until) continue;

        // Apply tag blacklist
        const postTags = new Set(post.tags.split(' ').filter((tag: string) => tag.length > 0));
        if (
          config.tagBlacklist &&
          config.tagBlacklist.some(blacklistedTag => postTags.has(blacklistedTag))
        ) {
          continue;
        }

        // Apply limit
        if (this.shouldStopExtracting(totalCount)) {
          break;
        }

        const username = this.proxy.getUsername();

        yield this.createRecord(post, {
          recordType: 'bookmarks',
          username,
        });

        totalCount++;
      }
    } catch (error) {
      this.logger.error('Error fetching Pinboard posts');
      throw error;
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      const config = this.config as z.infer<typeof PinboardExtractor.schema>;
      const posts = await this.proxy.getAllPosts({
        fromdt: config.since,
        todt: config.until,
      });
      return posts.length;
    } catch {
      return null;
    }
  }
}
