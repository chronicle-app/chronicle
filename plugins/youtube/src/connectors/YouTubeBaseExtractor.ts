import { Extractor, Record } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';
import { googleAccountOptions } from '@chronicle.app/google';
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
    ...googleAccountOptions,
  });

  protected proxy!: YouTubeProxy;
  protected user?: YouTubeSelfChannel;

  static async hasValidCredentials(): Promise<boolean> {
    try {
      await TokenHelper.getValidToken('google');
      return true;
    } catch {
      return false;
    }
  }

  override async setup(): Promise<void> {
    const { account, accessToken } = this.config as z.infer<typeof YouTubeBaseExtractor.schema>;

    this.proxy = new YouTubeProxy({ account, accessToken });
    await this.proxy.initialize();
    this.user = await this.proxy.getUser();
  }

  protected createRecordWithUser(data: any, options: { recordType: string }): Record {
    return this.createRecord(data, {
      recordType: options.recordType,
      user: this.user,
    });
  }
}
