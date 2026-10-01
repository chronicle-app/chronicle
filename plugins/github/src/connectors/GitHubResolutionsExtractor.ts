import { Record } from '@chronicle.app/etl';
import { GitHubResolutionEvent, GitHubThread, ResolvedThread } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

/** How an issue or pull request ended, as the transformer reads it. */
export interface ResolutionRecord {
  event: GitHubResolutionEvent;
  thread: GitHubThread;
}

export default class GitHubResolutionsExtractor extends GitHubExtractor {
  static override description =
    'Issues and pull requests you closed or merged, and what became of your pull requests';

  static override recordTypes: string[] = ['resolutions'];
  // Collected from several walks, then sorted.
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    const resolutions = new Map<string, Record>();
    const me = this.viewer.databaseId;
    const read = (thread: ResolvedThread) => {
      const { timelineItems, ...ref } = thread;
      // Merging closes a pull request too; the merge says it.
      const merged = timelineItems.nodes.find(event => event.__typename === 'MergedEvent');
      const mine = ref.__typename === 'PullRequest' && ref.author?.databaseId === me;
      for (const event of timelineItems.nodes) {
        if (resolutions.has(event.id) || !this.inRange(event.createdAt)) continue;
        if (event.__typename === 'ClosedEvent' && merged && event.createdAt >= merged.createdAt) {
          continue;
        }
        // Your own decisions count, and whatever became of your pull requests.
        if (event.actor?.databaseId !== me && !mine) continue;
        const data: ResolutionRecord = { event, thread: ref };
        resolutions.set(event.id, this.record('resolutions', event.id, event.createdAt, data));
      }
    };

    // Closing or merging makes a thread active, so each walk, most recently
    // active first, can stop at the first thread quiet since `since`.
    for (const name of ['closedIssues', 'closedPullRequests'] as const) {
      for await (const thread of this.proxy.viewerConnection<ResolvedThread>(name)) {
        if (this.isBeforeSince(thread.updatedAt)) break;
        read(thread);
      }
    }
    for await (const { id } of this.proxy.viewerConnection<{ id: string }>('ownedRepositories')) {
      for (const kind of ['issues', 'pullRequests'] as const) {
        for await (const thread of this.proxy.resolvedIn(id, kind)) {
          if (this.isBeforeSince(thread.updatedAt)) break;
          read(thread);
        }
      }
    }

    yield* [...resolutions.values()].sort(
      (a, b) => Date.parse(b.context.occurredAt) - Date.parse(a.context.occurredAt)
    );
  }
}
