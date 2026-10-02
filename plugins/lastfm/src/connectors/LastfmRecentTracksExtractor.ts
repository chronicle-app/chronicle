import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { resolveCredentials } from '@chronicle.app/auth';
import LastfmTransformer from './LastfmTransformer.js';
import LastfmProxy from '../utils/LastfmProxy.js';

export class LastfmRecentTracksExtractor extends Extractor<typeof LastfmRecentTracksExtractor> {
  static override source = 'lastfm';
  static override description = 'Scrobbled listens';

  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['listens'];
  static override default = true;
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
    const config = this.config as z.infer<typeof LastfmRecentTracksExtractor.schema>;

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
        hint: 'Run `chronicle auth login lastfm` to sign in.',
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
        hint: 'Run `chronicle auth login lastfm` to sign in.',
      }
    );

    this.proxy = new LastfmProxy(authToken as string, username as string);
    this.username = username as string;
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof LastfmRecentTracksExtractor.schema>;

    try {
      // Get user info for real name
      const userInfo = await this.proxy.getUserInfo();

      // Extract recent tracks (listened)
      const recentTracks = await this.proxy.getRecentTracks({
        since: config.since,
        until: config.until,
        limit: config.limit,
      });

      this.logger.info(`Retrieved ${recentTracks.length} recent tracks from Last.fm`);

      for (const track of recentTracks) {
        yield this.createRecord(track, {
          recordType: 'listens',
          metadata: {
            username: this.username,
            userInfo,
          },
        });
      }
    } catch (error) {
      this.logger.error('Error fetching Last.fm recent tracks');
      throw error;
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getItemCount();
    } catch {
      return null;
    }
  }
}
