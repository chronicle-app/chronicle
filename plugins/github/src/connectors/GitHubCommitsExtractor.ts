import { Record } from '@chronicle.app/etl';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubCommitsExtractor extends GitHubExtractor {
  static override description =
    'Commits you authored on the default branch of repositories you can push to or contributed to';

  static override recordTypes: string[] = ['commits'];
  // Collected across repositories, then sorted.
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    // Every repository you can push to, and those you committed to lately
    // elsewhere: GitHub lists only recent contributions, so the first walk
    // carries the history.
    const repositories = new Set<string>();
    for (const name of ['committableRepositories', 'contributedRepositories'] as const) {
      for await (const { id } of this.proxy.viewerConnection<{ id: string }>(name)) {
        repositories.add(id);
      }
    }

    const commits = new Map<string, Record>();
    const window = { since: this.config.since, until: this.config.until };
    for (const id of repositories) {
      for await (const commit of this.proxy.commitsIn(id, this.viewer.id, window)) {
        // A commit reachable from two repositories (a fork) counts once.
        if (commits.has(commit.oid) || !this.inRange(commit.authoredDate)) continue;
        commits.set(commit.oid, this.record('commits', commit.oid, commit.authoredDate, commit));
      }
    }
    yield* [...commits.values()].sort(
      (a, b) => Date.parse(b.context.occurredAt) - Date.parse(a.context.occurredAt)
    );
  }
}
