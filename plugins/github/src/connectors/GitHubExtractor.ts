import { Extractor, Record, z } from '@chronicle.app/etl';
import { CREDENTIAL_LABELS, resolveGitHubCredential } from '../utils/credentials.js';
import GitHubProxy, {
  CONTRIBUTION_WINDOW_MS,
  GitHubViewer,
  ReviewContribution,
} from '../utils/GitHubProxy.js';
import GitHubTransformer from './GitHubTransformer.js';

/** A signed-in connection to GitHub: one per run, however many extractors share it. */
export interface GitHubSession {
  proxy: GitHubProxy;
  viewer: GitHubViewer;
}

/**
 * Sessions opened by the default extractor, keyed by the raw config it hands
 * each child, so a merged run resolves credentials and says which it used once.
 */
export const sharedSessions = new WeakMap<object, GitHubSession>();

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
    const session =
      sharedSessions.get(this.rawInput) ??
      (await openSession(this.config, message => this.logInitStep(message)));
    this.proxy = session.proxy;
    this.viewer = session.viewer;
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
   */
  protected record(recordType: string, key: string, occurredAt: string, data: unknown): Record {
    return this.createRecord(data, { recordType, key, occurredAt, viewer: this.viewer });
  }

  /**
   * Your reviews, newest first. GitHub reads contributions a year at a time,
   * so this walks back from `until` (or now) a window at a time, to `since` or
   * to when the account was created.
   */
  protected async *contributions(since?: Date): AsyncGenerator<ReviewContribution> {
    const floor = Math.max(
      Date.parse(this.viewer.createdAt),
      since?.getTime() ?? Number.NEGATIVE_INFINITY
    );
    const seen = new Set<string>();
    let to = this.config.until?.getTime() ?? Date.now();
    while (to > floor) {
      const from = Math.max(floor, to - CONTRIBUTION_WINDOW_MS);
      for await (const contribution of this.proxy.reviewContributions(
        new Date(from),
        new Date(to)
      )) {
        // A review on a window's edge can appear in both windows.
        const { id } = contribution.pullRequestReview;
        if (seen.has(id)) continue;
        seen.add(id);
        yield contribution;
      }
      to = from;
    }
  }

  protected isBeforeSince(time: string): boolean {
    return this.config.since !== undefined && new Date(time) < this.config.since;
  }

  protected inRange(time: string): boolean {
    return !this.isBeforeSince(time) && !(this.config.until && new Date(time) > this.config.until);
  }
}
