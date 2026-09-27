import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import BlueskyProxy from '../utils/BlueskyProxy.js';
import BlueskyTransformer from './BlueskyTransformer.js';

export default abstract class BlueskyExtractor extends Extractor<typeof BlueskyExtractor> {
  protected proxy!: BlueskyProxy;
  protected records!: Record[];

  static override defaultTransformer = BlueskyTransformer;
  static override source = 'bluesky';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override schema = Extractor.schema.extend({
    accessToken: z.string().describe('Access token for account').optional(),
    password: z
      .string()
      .describe('Password for account (auto-retrieved from stored credentials if not provided)')
      .optional(),
    handle: z
      .string()
      .describe('Bluesky handle (auto-retrieved from stored credentials if not provided)')
      .optional(),
  });

  private agentProfile: any;

  override async setup(): Promise<void> {
    const proxy = new BlueskyProxy({
      accessToken: this.config.accessToken,
      handle: this.config.handle,
      password: this.config.password,
    });
    await proxy.initialize();

    // Use the resolved handle from proxy after initialization
    this.agentProfile = await proxy.getProfile(proxy.userDid || this.config.handle || '');
    this.proxy = proxy;
  }

  protected abstract extractRecords(): Promise<Record[]>;

  protected defaultContext() {
    return {
      agent: this.agentProfile,
    };
  }

  async *extract(): AsyncGenerator<Record> {
    const records = await this.extractRecords();
    for await (const record of records) {
      yield record;
    }
  }
}
