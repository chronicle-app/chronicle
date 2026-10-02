import { MergingExtractor, Record } from '@chronicle.app/etl';
import GitHubCommentsExtractor from './GitHubCommentsExtractor.js';
import { gitHubSchema, openSession, sharedSessions } from './GitHubExtractor.js';
import GitHubGistsExtractor from './GitHubGistsExtractor.js';
import GitHubIssuesExtractor from './GitHubIssuesExtractor.js';
import GitHubPullRequestsExtractor from './GitHubPullRequestsExtractor.js';
import GitHubRepositoriesExtractor from './GitHubRepositoriesExtractor.js';
import GitHubStarsExtractor from './GitHubStarsExtractor.js';
import GitHubTransformer from './GitHubTransformer.js';

/**
 * Your own activity in one newest-first pass — what a bare `extract github`
 * means. `commits`, `replies`, and `resolutions` are left out: each reads
 * every repository or thread you're part of before it can say which event is
 * newest, so they run only when asked for with `--type`. The children share
 * one session, so credentials are resolved, and reported, once.
 */
export default class GitHubDefaultExtractor extends MergingExtractor<
  typeof GitHubDefaultExtractor
> {
  static override source = 'github';
  static override description =
    'Your activity, newest first: all but commits, replies, and resolutions';

  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = [
    'pull-requests',
    'issues',
    'comments',
    'repositories',
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
    GitHubRepositoriesExtractor,
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
