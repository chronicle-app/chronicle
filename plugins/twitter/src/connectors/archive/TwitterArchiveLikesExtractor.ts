import { Record } from '@chronicle.app/etl';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

export class TwitterArchiveLikesExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveLikesExtractor
> {
  static override description = 'Likes';
  static override recordTypes = ['likes'];
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  /** The liked tweet's id — the like entry's only id, and Twitter's own. */
  override keyOf(record: Record): string | null {
    return (record.data as { tweetId?: string }).tweetId ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    try {
      // Load account info first
      this.accountInfo = await this.loadAccountInfo();

      yield* this.processLikes(`data/like.js`);
    } catch (error) {
      throw new Error(`Failed to process Twitter likes: ${error}`);
    }
  }

  private async *processLikes(filePath: string): AsyncGenerator<Record> {
    try {
      const content = await this.files.readText(filePath);
      const jsData = this.parseTwitterJS(content, 'like');

      let count = 0;
      for (const item of jsData) {
        const { like } = item;
        if (like) {
          if (this.shouldStopExtracting(count)) break;

          yield this.createRecordWithArchiveContext(
            {
              type: 'like',
              tweetId: like.tweetId,
              fullText: like.fullText,
              expandedUrl: like.expandedUrl,
            },
            { originalData: like }
          );
          count++;
        }
      }
    } catch (error) {
      this.logger.warn('Could not process likes', { error: String(error) });
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      const likesContent = await this.files.readText(`data/like.js`);
      const likesData = this.parseTwitterJS(likesContent, 'like');
      return likesData.length;
    } catch {
      return null;
    }
  }
}
