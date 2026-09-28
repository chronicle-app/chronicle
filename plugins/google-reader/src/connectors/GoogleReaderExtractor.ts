import { Extractor, Record } from '@chronicle.app/etl';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { z } from 'zod';
import GoogleReaderTransformer from './GoogleReaderTransformer.js';

import { GoogleReaderItem, GoogleReaderStream, UserInfo } from './types.js';

export class GoogleReaderExtractor extends Extractor<typeof GoogleReaderExtractor> {
  static override source = 'google-reader';
  static override description = 'Read, starred, and shared items from Takeout';

  static override delivery = 'export' as const;
  static override strategy = 'takeout';
  static override recordTypes = ['stream-contents'];

  static override default = true;
  static override defaultTransformer = GoogleReaderTransformer;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the google-reader archive directory'),
    userId: z.string().optional().describe('Specific user ID to filter for (optional)'),
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof GoogleReaderExtractor.schema>;

    this.logger.verboseInfo('Starting Google Reader archive extraction', {
      archivePath: config.input,
      userId: config.userId,
      limit: config.limit,
    });

    try {
      // Load user info
      const userInfoPath = join(config.input, 'data', 'user-info.json');
      let userInfo: UserInfo | null = null;
      try {
        const userInfoContent = await readFile(userInfoPath, 'utf-8');
        userInfo = JSON.parse(userInfoContent);
        this.logger.info('Loaded user info', {
          userName: userInfo?.user_name,
          userId: userInfo?.user_id,
        });
      } catch (error) {
        this.logger.warn('Could not load user-info.json', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const ownerId = config.userId ?? userInfo?.user_id;
      if (!ownerId) {
        throw new Error('Provide --user-id when data/user-info.json has no user_id');
      }
      const rawDataPath = join(config.input, '_raw_data');
      const files = (await readdir(rawDataPath))
        .sort()
        .filter(
          file =>
            file.startsWith('www.google.com-reader-api-0-stream-contents-user-') &&
            (!config.userId || file.includes(`-user-${config.userId}-`))
        );
      let totalProcessed = 0;
      for (const file of files) {
        if (this.shouldStopExtracting(totalProcessed)) break;
        // Stream sequentially so the global cap avoids reading later files.
        // eslint-disable-next-line no-await-in-loop
        for await (const record of this.processStreamFile(
          join(rawDataPath, file),
          ownerId,
          userInfo
        )) {
          yield record;
          totalProcessed++;
          if (this.shouldStopExtracting(totalProcessed)) break;
        }
      }
    } catch (error) {
      this.logger.error('Failed to process Google Reader archive', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to process Google Reader archive: ${error}`);
    }
  }

  private async *processStreamFile(
    filePath: string,
    userId: string,
    userInfo: UserInfo | null
  ): AsyncGenerator<Record> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const streamData: GoogleReaderStream = JSON.parse(content);

      if (!streamData.items) {
        this.logger.warn('Stream file has no items', { filePath });
        return;
      }

      this.logger.info(`Processing ${streamData.items.length} items from stream`, {
        streamTitle: streamData.title,
        itemCount: streamData.items.length,
      });

      const { items, ...streamMetadata } = streamData;
      for (const item of items) {
        if (!this.isPersonalUserAction(item, userId)) continue;
        const timestamp = new Date(Number(item.timestampUsec) / 1000);
        if (!Number.isFinite(timestamp.getTime())) {
          throw new TypeError(`Invalid timestampUsec for item ${item.id}`);
        }
        if (this.config.since && timestamp < this.config.since) continue;
        if (this.config.until && timestamp > this.config.until) continue;

        yield this.createRecord(
          {
            type: 'stream-content',
            userId,
            userInfo,
            streamData: streamMetadata,
            item,
            filePath: basename(filePath),
          },
          {
            itemId: item.id,
            timestamp: item.timestampUsec,
          }
        );
      }
    } catch (error) {
      this.logger.error('Failed to process stream file', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private isPersonalUserAction(item: GoogleReaderItem, userId: string): boolean {
    if (!item.categories) return false;

    return (
      item.categories.some(category =>
        ['read', 'broadcast', 'starred'].some(
          state => category === `user/${userId}/state/com.google/${state}`
        )
      ) || Boolean(item.annotations?.some(annotation => annotation.userId === userId))
    );
  }

  override async determineCount(): Promise<number | null> {
    let count = 0;
    for await (const _record of this.extract()) count++;
    return count;
  }
}
