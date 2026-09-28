import { Extractor, Record } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';
import { z } from 'zod';
import YouTubeTransformer from './YouTubeTransformer.js';
import YouTubeProxy, { YouTubeSelfChannel } from '../utils/YouTubeProxy.js';

export abstract class YouTubeBaseExtractor<
  T extends typeof YouTubeBaseExtractor,
> extends Extractor<T> {
  static override source = 'youtube';
  static override description = 'Base extractor for YouTube data';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override defaultTransformer = YouTubeTransformer;

  static override schema = Extractor.schema.extend({
    accessToken: z
      .string()
      .optional()
      .describe('OAuth access token for the YouTube Data API (auto-retrieved if not provided)'),
  });

  protected proxy!: YouTubeProxy;
  protected user?: YouTubeSelfChannel;

  static async hasValidCredentials(): Promise<boolean> {
    try {
      await TokenHelper.getValidToken('youtube');
      return true;
    } catch {
      return false;
    }
  }

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof YouTubeBaseExtractor.schema>;

    this.proxy = new YouTubeProxy(config.accessToken);
    this.user = await this.proxy.getUser();
  }

  protected createRecordWithUser(data: any, options: { recordType: string }): Record {
    return this.createRecord(data, {
      recordType: options.recordType,
      user: this.user,
    });
  }
}
