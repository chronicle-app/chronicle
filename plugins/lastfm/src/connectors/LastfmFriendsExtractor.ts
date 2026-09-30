import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { resolveCredentials } from '@chronicle.app/auth';
import LastfmTransformer from './LastfmTransformer.js';
import LastfmProxy from '../utils/LastfmProxy.js';

export class LastfmFriendsExtractor extends Extractor<typeof LastfmFriendsExtractor> {
  static override source = 'lastfm';
  static override description = 'Users you follow';

  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['friends'];
  // The friends list is a re-read of current following state: re-running
  // re-reports the same friends, and unfollowing drops one. The follow is
  // sighted at read time (Last.fm gives no befriended date). See
  // Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LastfmTransformer;

  static override schema = Extractor.schema.extend({
    // OAuth token (from auth command)
    accessToken: z
      .string()
      .optional()
      .describe(
        'OAuth session key from Last.fm (auto-retrieved from stored credentials if not provided)'
      ),

    // Traditional API key (alternative)
    apiKey: z.string().optional().describe('Last.fm API key'),

    username: z
      .string()
      .optional()
      .describe('Last.fm username (auto-retrieved from stored credentials if not provided)'),
  });

  private proxy!: LastfmProxy;
  private username!: string;

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof LastfmFriendsExtractor.schema>;

    // Use the flag-provided key, else the stored client ID, else the stored
    // OAuth session token.
    const { authToken } = await resolveCredentials(
      'lastfm',
      {
        authToken: { from: ['clientId', 'accessToken'] },
      },
      {
        overrides: { authToken: config.accessToken || config.apiKey },
        errorMessage:
          'Authentication required. Either:\n' +
          '1. Run: chronicle auth login lastfm --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET\n' +
          '2. Or use: --api-key YOUR_API_KEY for traditional auth\n' +
          '3. Or use: --access-token TOKEN for OAuth session key',
        hint: 'run `chronicle auth login lastfm`',
      }
    );

    // Get username from config or stored credentials
    const { username } = await resolveCredentials(
      'lastfm',
      {
        username: { from: ['username'] },
      },
      {
        overrides: { username: config.username },
        errorMessage:
          'Last.fm username is required. Either provide --username or authenticate with: chronicle auth login lastfm',
        hint: 'run `chronicle auth login lastfm`',
      }
    );

    this.proxy = new LastfmProxy(authToken as string, username as string);
    this.username = username as string;
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof LastfmFriendsExtractor.schema>;

    try {
      // The listener whose friends these are (for the FollowAction agent).
      const userInfo = await this.proxy.getUserInfo();

      const friends = await this.proxy.getFriends({ limit: config.limit });

      this.logger.info(`Retrieved ${friends.length} friends from Last.fm`);

      for (const friend of friends) {
        yield this.createRecord(friend, {
          recordType: 'friends',
          metadata: {
            username: this.username,
            userInfo,
          },
        });
      }
    } catch (error) {
      this.logger.error('Error fetching Last.fm friends');
      throw error;
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getFriendsCount();
    } catch {
      return null;
    }
  }
}
