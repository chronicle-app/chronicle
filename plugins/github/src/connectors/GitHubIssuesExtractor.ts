import { Record } from '@chronicle.app/etl';
import { GitHubThread } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubIssuesExtractor extends GitHubExtractor {
  static override description = 'Issues you opened';
  static override recordTypes: string[] = ['issues'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const issue of this.proxy.viewerConnection<GitHubThread>('issues')) {
      if (this.isBeforeSince(issue.createdAt)) return;
      if (!this.inRange(issue.createdAt)) continue;
      yield this.record('issues', issue.id, issue.createdAt, { ...issue, __typename: 'Issue' });
    }
  }
}
