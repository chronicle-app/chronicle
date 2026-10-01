import { MergingExtractor, Record } from '@chronicle.app/etl';
import GitHubCommentsExtractor from './GitHubCommentsExtractor.js';
import { gitHubSchema, openSession, sharedSessions } from './GitHubExtractor.js';
import GitHubGistsExtractor from './GitHubGistsExtractor.js';
import GitHubIssuesExtractor from './GitHubIssuesExtractor.js';
import GitHubPullRequestsExtractor from './GitHubPullRequestsExtractor.js';
import GitHubRepliesExtractor from './GitHubRepliesExtractor.js';
import GitHubResolutionsExtractor from './GitHubResolutionsExtractor.js';
import GitHubStarsExtractor from './GitHubStarsExtractor.js';
import GitHubTransformer from './GitHubTransformer.js';

/**
 * Every record type in one newest-first pass — what a bare `extract github`
 * means. The children share one session, so credentials are resolved, and
 * reported, once.
 */
export default class GitHubDefaultExtractor extends MergingExtractor<
  typeof GitHubDefaultExtractor
> {
  static override source = 'github';
  static override description = 'Everything below, newest first';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = [
    'pull-requests',
    'issues',
    'comments',
    'resolutions',
    'replies',
    'stars',
    'gists',
  ];

  static override default = true;
  static override defaultTransformer = GitHubTransformer;
  static override schema = gitHubSchema as any;

  static override children = [
    GitHubPullRequestsExtractor,
    GitHubIssuesExtractor,
    GitHubCommentsExtractor,
    GitHubResolutionsExtractor,
    GitHubRepliesExtractor,
    GitHubStarsExtractor,
    GitHubGistsExtractor,
  ];

  override async setup(): Promise<void> {
    sharedSessions.set(
      this.rawConfig,
      await openSession(this.config as any, message => this.logInitStep(message))
    );
    await super.setup();
  }

  protected sortKey(record: Record): number {
    return Date.parse(record.context.occurredAt);
  }
}
