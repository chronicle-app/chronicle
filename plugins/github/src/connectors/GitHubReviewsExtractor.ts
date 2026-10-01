import { Record } from '@chronicle.app/etl';
import { GitHubReview, GitHubReviewComment, ReviewContribution } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

/** A review with its inline comments, as the transformer reads it. */
export interface ReviewRecord {
  review: GitHubReview;
  comments: GitHubReviewComment[];
  pullRequest: ReviewContribution['pullRequest'];
}

export default class GitHubReviewsExtractor extends GitHubExtractor {
  static override description = 'Pull request reviews you submitted, with their inline comments';
  static override recordTypes: string[] = ['reviews'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const contribution of this.contributions(this.config.since)) {
      const { pullRequestReview: review, pullRequest } = contribution;
      const time = review.submittedAt ?? contribution.occurredAt;
      if (!this.inRange(time)) continue;
      const comments = await this.proxy.all<GitHubReviewComment>(
        { type: 'PullRequestReview', id: review.id },
        'comments',
        review.comments
      );
      // The review's first page of comments is in `comments` with the rest.
      const { comments: _, ...rest } = review;
      const data: ReviewRecord = { review: rest, comments, pullRequest };
      yield this.record('reviews', review.id, time, data);
    }
  }
}
