import { Extractor, Record } from '@chronicle.app/etl';
import { CredentialManager } from '@chronicle.app/auth';
import { z } from 'zod';
import ArenaTransformer from './ArenaTransformer.js';
import ArenaProxy, { ArenaUser } from '../utils/ArenaProxy.js';

export default abstract class ArenaExtractor extends Extractor<typeof ArenaExtractor> {
  static override source = 'arena';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  // Both extractors re-read current state: the bookmarks crawl re-reports every
  // channel/block with its latest title/description/body each run, and the
  // following crawl re-reads the whole follow list. So attributes are sighted at
  // read time rather than back-dated to a creation/connection timestamp, letting
  // an edit supersede cleanly instead of colliding with the old value at that
  // instant. Arena is a live API, so each read is a genuine sighting and the
  // default run-start asOfTime is correct. See Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = ArenaTransformer;

  static override schema = Extractor.schema.extend({
    userId: z
      .number()
      .optional()
      .describe('Are.na user ID to extract for (defaults to authenticated user)'),
    accessToken: z
      .string()
      .optional()
      .describe('Are.na access token (overrides stored credentials)'),
  });

  protected proxy!: ArenaProxy;
  protected userId!: number;
  protected authenticatedUser!: ArenaUser;
  protected selectedUser!: ArenaUser;

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof ArenaExtractor.schema>;

    // Get access token from config or credentials
    let { accessToken } = config;
    if (!accessToken) {
      const credentials = await CredentialManager.getCredentials('arena');
      accessToken = credentials?.accessToken;
    }

    if (!accessToken) {
      throw new Error(
        'No Are.na access token found. Either:\n' +
          '1. Create a personal access token at https://www.are.na/developers/personal-access-tokens and run: chronicle auth set arena\n' +
          '2. Run: chronicle auth login arena --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET\n' +
          '3. Provide a token directly with --access-token'
      );
    }

    this.proxy = new ArenaProxy(accessToken);

    this.authenticatedUser = await this.proxy.getMe();
    this.userId = config.userId ?? this.authenticatedUser.id;
    this.selectedUser =
      this.userId === this.authenticatedUser.id
        ? this.authenticatedUser
        : await this.proxy.getUser(this.userId);
    this.logger.info(
      `Authenticated as ${this.authenticatedUser.name} (${this.authenticatedUser.slug})`
    );
  }

  // Stamp the authenticated user id onto every record's context so the
  // transformer can tag the owner as self. buildUser is shared with followed
  // users and others' blocks, so it tags by id match, not blanket.
  protected override createRecord(data: unknown, context: { [key: string]: unknown } = {}): Record {
    return super.createRecord(data, {
      ...context,
      userId: this.authenticatedUser.id,
    });
  }

  abstract override extract(): AsyncGenerator<Record>;

  // The record count isn't known without walking the whole API, which would
  // double the request load, so report it as indeterminate.
  override async determineCount(): Promise<number | null> {
    return null;
  }
}
