import { Extractor, Record, z } from '@chronicle.app/etl';
import { CREDENTIAL_LABELS, resolveGitHubCredential } from '../utils/credentials.js';
import GitHubProxy, { GitHubViewer } from '../utils/GitHubProxy.js';
import GitHubTransformer from './GitHubTransformer.js';

/** A signed-in connection to GitHub: one per run, however many extractors share it. */
export interface GitHubSession {
  proxy: GitHubProxy;
  viewer: GitHubViewer;
}

/**
 * Sessions by the raw config they were opened with. Extractors run together
 * get the same config object, so a run of several record types resolves
 * credentials, and says which it used, once.
 */
const sessions = new WeakMap<object, Promise<GitHubSession>>();

export const gitHubSchema = Extractor.schema.extend({
  token: z
    .string()
    .optional()
    .describe(
      'GitHub token (default: the stored `chronicle auth set github` token, GH_TOKEN, GITHUB_TOKEN, then gh CLI)'
    ),
  gh: z
    .boolean()
    .default(true)
    .describe('Borrow the gh CLI’s token when no other is set (--no-gh to turn off)'),
});

/** Resolve a token, say where it came from, and read who it belongs to. */
export async function openSession(
  config: z.infer<typeof gitHubSchema>,
  log: (message: string, fields?: object) => void
): Promise<GitHubSession> {
  const credential = await resolveGitHubCredential({
    token: config.token,
    gh: config.gh,
  });
  log(`Using GitHub credentials from ${CREDENTIAL_LABELS[credential.source]}`);
  const proxy = new GitHubProxy(credential);
  await proxy.initialize();
  const viewer = await proxy.viewer();
  return { proxy, viewer };
}

export default abstract class GitHubExtractor extends Extractor<typeof GitHubExtractor> {
  static override defaultTransformer = GitHubTransformer;
  static override source = 'github';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override schema = gitHubSchema;

  protected proxy!: GitHubProxy;
  protected viewer!: GitHubViewer;
  private readonly rawInput: object;

  constructor(config: any) {
    super(config);
    this.rawInput = config;
  }

  override async setup(): Promise<void> {
    let opening = sessions.get(this.rawInput);
    if (!opening) {
      opening = openSession(this.config, message => this.logInitStep(message));
      sessions.set(this.rawInput, opening);
    }
    const session = await opening;
    this.proxy = session.proxy;
    this.viewer = session.viewer;
  }

  /** When it happened, as each record type dates it: so several types merge newest first. */
  override occurredAt(record: Record): Date | undefined {
    const { occurredAt } = record.context;
    return occurredAt ? new Date(occurredAt) : undefined;
  }

  /** GitHub's global node id, which no two objects share. */
  override keyOf(record: Record): string | null {
    return record.context.key ?? null;
  }

  protected abstract records(): AsyncGenerator<Record>;

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for await (const record of this.records()) {
      if (this.shouldStopExtracting(count)) return;
      yield record;
      count++;
    }
  }

  /**
   * A record whose `key` is its GitHub id and whose `occurredAt` orders it
   * among the other record types in a merged run.
   *
   * GitHub answers with accounts, repositories, and threads as they are now,
   * not as they were when the action happened, so the record is observed at
   * read time. The action keeps its own `timestamp`. This isn't a snapshot:
   * a snapshot would mark every node complete, and commits and links are
   * shared with other sources.
   */
  protected record(recordType: string, key: string, occurredAt: string, data: unknown): Record {
    return this.createRecord(
      data,
      { recordType, key, occurredAt, viewer: this.viewer },
      { assertedAt: this.asOfTime() }
    );
  }

  protected isBeforeSince(time: string): boolean {
    return this.config.since !== undefined && new Date(time) < this.config.since;
  }

  protected inRange(time: string): boolean {
    return !this.isBeforeSince(time) && !(this.config.until && new Date(time) > this.config.until);
  }
}
