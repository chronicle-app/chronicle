import { Record } from '@chronicle.app/etl';
import {
  DiscussedThread,
  GitHubComment,
  GitHubIssueComment,
  GitHubReview,
  GitHubReviewComment,
  GitHubThread,
  THREADS_PER_BATCH,
} from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

/** Someone else's response to you, as the transformer reads it. */
export type ReplyRecord =
  | { kind: 'comment'; comment: GitHubComment; thread: GitHubThread }
  | {
      kind: 'review';
      review: GitHubReview;
      comments: GitHubReviewComment[];
      pullRequest: GitHubThread;
    }
  | { kind: 'review-comment'; comment: GitHubReviewComment; pullRequest: GitHubThread };

function isBy(actor: { databaseId?: number } | null, id: number): boolean {
  return actor?.databaseId === id;
}

export default class GitHubRepliesExtractor extends GitHubExtractor {
  static override description =
    "Other people's comments and reviews on your issues and pull requests, and in discussions you joined";

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
        for (const reply of await this.repliesIn(thread)) {
          const { time, id } = reply;
          if (this.inRange(time)) replies.push(this.record('replies', id, time, reply.data));
        }
      }
    }
    replies.sort((a, b) => Date.parse(b.context.occurredAt) - Date.parse(a.context.occurredAt));
    yield* replies;
  }

  /**
   * Threads that can hold a reply to you: issues and pull requests you opened,
   * ones you commented on, and ones where you started a review thread. An old
   * thread can get a new reply, so `since` only skips threads with no activity
   * since then.
   */
  private async candidateThreads(): Promise<string[]> {
    const ids = new Set<string>();
    const add = (thread: GitHubThread) => {
      if (!this.isBeforeSince(thread.updatedAt)) ids.add(thread.id);
    };
    for (const name of ['pullRequestsByActivity', 'issuesByActivity'] as const) {
      for await (const thread of this.proxy.viewerConnection<GitHubThread>(name)) {
        // Most recently active first: the rest have been quiet since `since`.
        if (this.isBeforeSince(thread.updatedAt)) break;
        add(thread);
      }
    }
    for await (const comment of this.proxy.viewerConnection<GitHubIssueComment>('issueComments')) {
      add(comment.pullRequest ?? comment.issue);
    }
    for await (const { pullRequestReview, pullRequest } of this.contributions()) {
      if (pullRequestReview.comments.nodes.some(comment => !comment.replyTo)) add(pullRequest);
    }
    return [...ids];
  }

  /** Replies to you in one thread, with when each was written. */
  private async repliesIn(
    thread: DiscussedThread
  ): Promise<{ id: string; time: string; data: ReplyRecord }[]> {
    const { comments: firstComments, reviews: firstReviews, reviewThreads, ...ref } = thread;
    const parent = { type: thread.__typename, id: thread.id };
    const me = this.viewer.databaseId;
    const replies: { id: string; time: string; data: ReplyRecord }[] = [];

    // The conversation: everything others said on your own thread, and
    // everything after you first spoke on someone else's.
    const comments = await this.proxy.all<GitHubComment>(parent, 'comments', firstComments);
    const joined = isBy(ref.author, me)
      ? Number.NEGATIVE_INFINITY
      : Math.min(...comments.filter(c => isBy(c.author, me)).map(c => Date.parse(c.createdAt)));
    for (const comment of comments) {
      if (isBy(comment.author, me) || !comment.author || Date.parse(comment.createdAt) <= joined) {
        continue;
      }
      replies.push({
        id: comment.id,
        time: comment.createdAt,
        data: { kind: 'comment', comment, thread: ref },
      });
    }
    if (!firstReviews || !reviewThreads) return replies;

    // Review threads, each with every comment.
    const threads: GitHubReviewComment[][] = [];
    for (const reviewThread of await this.proxy.all(parent, 'reviewThreads', reviewThreads)) {
      threads.push(
        await this.proxy.all(
          { type: 'PullRequestReviewThread', id: reviewThread.id },
          'comments',
          reviewThread.comments
        )
      );
    }
    const reviewComments = threads.flat();
    const answered = new Set<string>();

    // Others' reviews of your pull request, with their inline comments.
    if (isBy(ref.author, me)) {
      const reviews = await this.proxy.all<GitHubReview>(parent, 'reviews', firstReviews);
      for (const review of reviews) {
        if (isBy(review.author, me) || !review.author || review.state === 'PENDING') continue;
        const inline = reviewComments.filter(c => c.pullRequestReview?.id === review.id);
        for (const comment of inline) answered.add(comment.id);
        replies.push({
          id: review.id,
          time: review.submittedAt ?? review.createdAt,
          data: { kind: 'review', review, comments: inline, pullRequest: ref },
        });
      }
    }

    // Replies in review threads you started, on anyone's pull request.
    for (const [first, ...rest] of threads) {
      if (!first || !isBy(first.author, me)) continue;
      for (const comment of rest) {
        if (isBy(comment.author, me) || !comment.author || answered.has(comment.id)) continue;
        replies.push({
          id: comment.id,
          time: comment.createdAt,
          data: { kind: 'review-comment', comment, pullRequest: ref },
        });
      }
    }
    return replies;
  }
}
