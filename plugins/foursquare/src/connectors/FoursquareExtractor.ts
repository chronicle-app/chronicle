import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { resolveCredentials } from '@chronicle.app/auth';
import FoursquareProxy, { FoursquareUser } from '../utils/FoursquareProxy.js';
import FoursquareTransformer from './FoursquareTransformer.js';

export class FoursquareExtractor extends Extractor<typeof FoursquareExtractor> {
  static override source = 'foursquare';
  static override description = 'Check-ins';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['checkins'];
  static override default = true;
  static override defaultTransformer = FoursquareTransformer;

  static override schema = Extractor.schema.extend({
    'access-token': z
      .string()
      .optional()
      .describe('Foursquare access token (auto-retrieved from stored credentials if not provided)'),
  });

  private proxy!: FoursquareProxy;
  private actor!: FoursquareUser;

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof FoursquareExtractor.schema>;

    // Use the token from the flag, else the one stored by `auth login foursquare`.
    const { accessToken } = await resolveCredentials(
      'foursquare',
      {
        accessToken: { from: ['accessToken'] },
      },
      {
        overrides: { accessToken: config['access-token'] },
        errorMessage:
          'Foursquare access token is required. Either pass --access-token or authenticate with: chronicle auth login foursquare --client-id YOUR_ID --client-secret YOUR_SECRET',
        hint: 'run `chronicle auth login foursquare`',
      }
    );

    this.proxy = new FoursquareProxy(accessToken as string);
    this.actor = await this.proxy.loadSelf();
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof FoursquareExtractor.schema>;

    try {
      const checkins = await this.proxy.loadCheckins({
        since: config.since,
        limit: config.limit,
      });

      this.logger.info(`Retrieved ${checkins.length} checkins from Foursquare`);

      for (const checkin of checkins) {
        yield this.createRecord(checkin, { actor: this.actor });
      }
    } catch (error) {
      this.logger.error('Error fetching Foursquare checkins');
      throw error;
    }
  }

  override async determineCount(): Promise<number | null> {
    return null;
  }
}
