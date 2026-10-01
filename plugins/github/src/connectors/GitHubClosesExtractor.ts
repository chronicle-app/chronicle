import { Record } from '@chronicle.app/etl';
import { ClosedIssue, GitHubClosedEvent, GitHubThread } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

/** An issue you closed, as the transformer reads it. */
export interface CloseRecord {
  event: GitHubClosedEvent;
  issue: GitHubThread;
}

export default class GitHubClosesExtractor extends GitHubExtractor {
  static override description = 'Issues you closed, in your issues and the repositories you own';
  static override recordTypes: string[] = ['closes'];
  // Collected from several walks, then sorted.
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    const closes = new Map<string, Record>();
    const read = (issue: ClosedIssue) => {
      const { timelineItems, ...ref } = issue;
      for (const event of timelineItems.nodes) {
        // Others close your issues too; only yours count, once each.
        if (event.actor?.databaseId !== this.viewer.databaseId || closes.has(event.id)) continue;
        if (!this.inRange(event.createdAt)) continue;
        const data: CloseRecord = { event, issue: ref };
        closes.set(event.id, this.record('closes', event.id, event.createdAt, data));
      }
    };

    // Closing an issue makes it active, so each walk, most recently active
    // first, can stop at the first issue quiet since `since`.
    for await (const issue of this.proxy.viewerConnection<ClosedIssue>('closedIssues')) {
      if (this.isBeforeSince(issue.updatedAt)) break;
      read(issue);
    }
    for await (const { id } of this.proxy.viewerConnection<{ id: string }>('ownedRepositories')) {
      for await (const issue of this.proxy.closedIssuesIn(id)) {
        if (this.isBeforeSince(issue.updatedAt)) break;
        read(issue);
      }
    }

    const sorted = [...closes.values()].sort(
      (a, b) => Date.parse(b.context.occurredAt) - Date.parse(a.context.occurredAt)
    );
    yield* sorted;
  }
}
