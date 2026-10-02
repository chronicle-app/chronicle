import { Record } from '@chronicle.app/etl';
import {
  DiscussedThread,
  GitHubComment,
  GitHubIssueComment,
  GitHubThread,
  THREADS_PER_BATCH,
} from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

/** Someone else's comment to you, as the transformer reads it. */
export interface ReplyRecord {
  comment: GitHubComment;
  thread: GitHubThread;
}

function isBy(actor: { databaseId?: number } | null, id: number): boolean {
  return actor?.databaseId === id;
}

export default class GitHubRepliesExtractor extends GitHubExtractor {
  static override description =
    "Other people's comments on your issues and pull requests, and in discussions you joined (slow: reads every thread you're part of)";

  static override recordTypes: string[] = ['replies'];
  // Collected from many threads, then sorted.
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    const ids = await this.candidateThreads();
    const replies: Record[] = [];
    for (let start = 0; start < ids.length; start += THREADS_PER_BATCH) {
      for (const thread of await this.proxy.discussions(
        ids.slice(start, start + THREADS_PER_BATCH)
      )) {
        for (const data of await this.repliesIn(thread)) {
          const { comment } = data;
          if (this.inRange(comment.createdAt)) {
            replies.push(this.record('replies', comment.id, comment.createdAt, data));
          }
        }
      }
    }
    replies.sort((a, b) => Date.parse(b.context.occurredAt) - Date.parse(a.context.occurredAt));
    yield* replies;
  }

  /**
   * Threads that can hold a reply to you: issues and pull requests you opened,
   * and ones you commented on. An old thread can get a new reply, so `since`
   * only skips threads with no activity since then.
   */
  private async candidateThreads(): Promise<string[]> {
    const ids = new Set<string>();
    for (const name of ['pullRequestsByActivity', 'issuesByActivity'] as const) {
      for await (const thread of this.proxy.viewerConnection<GitHubThread>(name)) {
        // Most recently active first: the rest have been quiet since `since`.
        if (this.isBeforeSince(thread.updatedAt)) break;
        ids.add(thread.id);
      }
    }
    for await (const comment of this.proxy.viewerConnection<GitHubIssueComment>('issueComments')) {
      const thread = comment.pullRequest ?? comment.issue;
      if (!this.isBeforeSince(thread.updatedAt)) ids.add(thread.id);
    }
    return [...ids];
  }

  /**
   * Everything others said on your own thread, and everything after you first
   * spoke on someone else's: GitHub comments aren't threaded, so a later
   * comment is the nearest thing to a reply.
   */
  private async repliesIn(thread: DiscussedThread): Promise<ReplyRecord[]> {
    const { comments: _, ...ref } = thread;
    const me = this.viewer.databaseId;
    const comments = await this.proxy.allComments(thread);
    const joined = isBy(ref.author, me)
      ? Number.NEGATIVE_INFINITY
      : Math.min(...comments.filter(c => isBy(c.author, me)).map(c => Date.parse(c.createdAt)));
    return comments
      .filter(
        comment =>
          comment.author && !isBy(comment.author, me) && Date.parse(comment.createdAt) > joined
      )
      .map(comment => ({ comment, thread: ref }));
  }
}
