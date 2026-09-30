import { Record } from '@chronicle.app/etl';
import { GitHubThread } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubPullRequestsExtractor extends GitHubExtractor {
  static override description = 'Pull requests you opened';
  static override recordTypes: string[] = ['pull-requests'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const pr of this.proxy.viewerConnection<GitHubThread>('pullRequests')) {
      if (this.isBeforeSince(pr.createdAt)) return;
      if (!this.inRange(pr.createdAt)) continue;
      yield this.record('pull-requests', pr.id, pr.createdAt, { ...pr, __typename: 'PullRequest' });
    }
  }
}
