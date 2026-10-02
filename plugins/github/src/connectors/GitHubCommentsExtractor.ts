import { Record } from '@chronicle.app/etl';
import { GitHubIssueComment } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubCommentsExtractor extends GitHubExtractor {
  static override description = 'Comments you wrote on issues and pull requests';
  static override recordTypes: string[] = ['comments'];

  protected async *records(): AsyncGenerator<Record> {
    // GitHub lists a user's comments by when they were last edited. A comment
    // is edited after it's written, so once edits predate `since`, so do the
    // comments; until then, an old comment edited recently still turns up and
    // is filtered on when it was written.
    for await (const comment of this.proxy.viewerConnection<GitHubIssueComment>('issueComments')) {
      if (this.isBeforeSince(comment.updatedAt)) return;
      if (!this.inRange(comment.createdAt)) continue;
      const { issue, pullRequest, updatedAt: _, ...rest } = comment;
      // A comment on a pull request also names the issue behind it, which has
      // an id of its own; the pull request is the thread.
      const thread = pullRequest ?? issue;
      yield this.record('comments', comment.id, comment.createdAt, { comment: rest, thread });
    }
  }
}
