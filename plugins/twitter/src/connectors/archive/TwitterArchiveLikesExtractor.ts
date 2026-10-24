import { Record, type Survey } from '@chronicle.app/etl';
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
      let count = 0;
      for (const like of await this.loadLikes(filePath)) {
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
    } catch (error) {
      this.logger.warn('Could not process likes', { error: String(error) });
    }
  }

  /** The archive's likes, as it writes them: with no time, so since and until can't apply. */
  private async loadLikes(filePath: string) {
    const content = await this.files.readText(filePath);
    return this.parseTwitterJS(content, 'like')
      .map(item => item.like)
      .filter(Boolean);
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

  /** The likes a run reads, counted alone: the archive doesn't say when any were made. */
  override async survey(): Promise<Survey> {
    return { likes: { count: (await this.loadLikes(`data/like.js`)).length } };
  }
}
