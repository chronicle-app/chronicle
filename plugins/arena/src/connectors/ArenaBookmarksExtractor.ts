import ArenaExtractor from './ArenaExtractor.js';
import { Record } from '@chronicle.app/etl';
import { isBlock } from '../utils/ArenaProxy.js';

/**
 * Walks the authenticated user's channels and emits the activity derived from
 * their own content:
 *
 * - `channel`    a channel the user created (CreateAction → Collection)
 * - `connection` a block/channel the user connected into a channel (BookmarkAction)
 * - `block`      a block the user authored (CreateAction → Post)
 * - `comment`    a comment the user left on a block (CreateAction → Comment)
 *
 * Use `--since` for incremental extraction; channels untouched since then are
 * skipped and only connections/content created after it are emitted.
 */
export default class ArenaBookmarksExtractor extends ArenaExtractor {
  static override description = 'Channels, blocks, connections, and comments';

  static override recordTypes: string[] = ['channels', 'connections', 'blocks', 'comments'];

  static override default = true;

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as { since?: Date };
    const since = config.since ? new Date(config.since) : null;
    const isAfterSince = (timestamp: string): boolean => !since || new Date(timestamp) > since;

    let recordCount = 0;
    // A block can be connected to several channels; only emit its CreateAction
    // and fetch its comments once per run.
    const seenBlocks = new Set<number>();

    this.logger.verboseInfo('Starting Are.na extraction', {
      userId: this.userId,
      since: since?.toISOString() || 'all time',
    });

    // Channels come back most-recently-active first.
    const channels = await this.proxy.getUserChannels(this.userId);
    this.logger.info(`Found ${channels.length} channels`);

    for (const channel of channels) {
      if (this.shouldStopExtracting(recordCount)) break;

      // Channels are ordered by most recent activity, so once one predates
      // `since` every later channel does too — stop walking.
      if (since && new Date(channel.updated_at) <= since) break;

      // The user created this channel.
      if (channel.owner?.id === this.userId && isAfterSince(channel.created_at)) {
        yield this.createRecord(channel, { recordType: 'channels' });
        recordCount++;
        if (this.shouldStopExtracting(recordCount)) break;
      }

      // eslint-disable-next-line no-await-in-loop -- Keep API requests sequential.
      const contents = await this.proxy.getChannelContents(channel.id);
      this.logger.debug(`Channel "${channel.title}" has ${contents.length} content items`);

      for (const item of contents) {
        if (this.shouldStopExtracting(recordCount)) break;

        const { connection } = item;

        // The user connected this item into the channel (a bookmark).
        if (
          connection &&
          connection.connected_by?.id === this.userId &&
          isAfterSince(connection.connected_at)
        ) {
          yield this.createRecord({ item, channel, connection }, { recordType: 'connections' });
          recordCount++;
          if (this.shouldStopExtracting(recordCount)) break;
        }

        if (!isBlock(item) || seenBlocks.has(item.id)) continue;
        seenBlocks.add(item.id);

        // The user authored this block.
        if (item.user?.id === this.userId && isAfterSince(item.created_at)) {
          yield this.createRecord(item, { recordType: 'blocks' });
          recordCount++;
          if (this.shouldStopExtracting(recordCount)) break;
        }

        // Comments the user left on the block.
        if (item.comment_count > 0) {
          // eslint-disable-next-line no-await-in-loop -- Keep API requests sequential.
          const comments = await this.proxy.getBlockComments(item.id);
          for (const comment of comments) {
            if (this.shouldStopExtracting(recordCount)) break;
            if (comment.user?.id === this.userId && isAfterSince(comment.created_at)) {
              yield this.createRecord({ comment, block: item }, { recordType: 'comments' });
              recordCount++;
            }
          }
        }
      }
    }

    this.logger.info(`Extracted ${recordCount} records from Are.na`);
  }
}
