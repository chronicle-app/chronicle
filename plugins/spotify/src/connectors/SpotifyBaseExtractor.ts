import { Extractor, Record } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';
import { z } from 'zod';
import SpotifyTransformer from './SpotifyTransformer.js';
import SpotifyProxy, { SpotifyUser } from '../utils/SpotifyProxy.js';

export abstract class SpotifyBaseExtractor<
  T extends typeof SpotifyBaseExtractor,
> extends Extractor<T> {
  static override source = 'spotify';
  static override description = 'Base extractor for Spotify data';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override defaultTransformer = SpotifyTransformer;

  static override schema = Extractor.schema.extend({
    accessToken: z
      .string()
      .optional()
      .describe(
        'OAuth access token for Spotify API authentication (auto-retrieved if not provided)'
      ),
  });

  protected proxy!: SpotifyProxy;
  protected user?: SpotifyUser;

  /**
   * Check if valid Spotify credentials are available
   */
  static async hasValidCredentials(): Promise<boolean> {
    try {
      await TokenHelper.getValidToken('spotify');
      return true;
    } catch {
      return false;
    }
  }

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof SpotifyBaseExtractor.schema>;

    // SpotifyProxy will automatically handle token retrieval from storage
    // Only pass accessToken if explicitly provided by user
    this.proxy = new SpotifyProxy(config.accessToken);

    // Get user info for use in transformations
    this.user = await this.proxy.getUser();
  }

  /**
   * Create a record with user context
   */
  protected createRecordWithUser(data: any, options: { recordType: string }): Record {
    return this.createRecord(data, {
      recordType: options.recordType,
      user: this.user,
    });
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getTotalItemCount();
    } catch {
      return null;
    }
  }
}
