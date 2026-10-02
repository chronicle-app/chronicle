import { Record } from '@chronicle.app/etl';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubCommitsExtractor extends GitHubExtractor {
  static override description =
    'Commits you authored, on the default branch of every repository you can see';

  static override recordTypes: string[] = ['commits'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    const window = { since: this.config.since, until: this.config.until };
    for await (const commit of this.proxy.commitsBy(this.viewer.login, window)) {
      if (!this.inRange(commit.authoredDate)) continue;
      yield this.record('commits', commit.oid, commit.authoredDate, commit);
    }
  }
}
