import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AgentAndChildren,
  Comment,
  Entity,
  Issue,
  LikeAction,
  PublishAction,
  PullRequest,
  Repository,
  RespondAction,
  Response,
  SoftwareSourceCode,
} from '@chronicle.app/schema';
import {
  GitHubActor,
  GitHubComment,
  GitHubGist,
  GitHubRepository,
  GitHubReview,
  GitHubReviewComment,
  GitHubStar,
  GitHubThread,
  GitHubViewer,
} from '../utils/GitHubProxy.js';
import type { ReplyRecord } from './GitHubRepliesExtractor.js';
import type { ReviewRecord } from './GitHubReviewsExtractor.js';

const SOURCE = 'github';
const KEY: ['@type', 'source', 'sourceId'] = ['@type', 'source', 'sourceId'];

/** GitHub's visibilities, in the schema's buckets. An enterprise's internal repository is private. */
const VISIBILITY = { PUBLIC: 'public', PRIVATE: 'private', INTERNAL: 'private' } as const;

export default class GitHubTransformer extends ChronicleTransformer {
  /** The account being extracted, set per record from context. */
  private viewer?: GitHubViewer;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    // Safe as a per-record field: everything below builds synchronously.
    this.viewer = record.context.viewer;

    switch (record.extraction.recordType) {
      case 'pull-requests':
      case 'issues': {
        return [this.buildOpen(record.data as GitHubThread)];
      }
      case 'comments': {
        const { comment, thread } = record.data as { comment: GitHubComment; thread: GitHubThread };
        return [this.buildComment(comment, thread)];
      }
      case 'reviews': {
        return this.buildReview(record.data as ReviewRecord);
      }
      case 'replies': {
        const reply = record.data as ReplyRecord;
        switch (reply.kind) {
          case 'comment': {
            return [this.buildComment(reply.comment, reply.thread)];
          }
          case 'review': {
            return this.buildReview(reply);
          }
          case 'review-comment': {
            return [this.buildReviewComment(reply.comment, reply.pullRequest)];
          }
        }
        return [];
      }
      case 'stars': {
        return [this.buildStar(record.data as GitHubStar)];
      }
      case 'gists': {
        return [this.buildGist(record.data as GitHubGist)];
      }
      default: {
        return [];
      }
    }
  }

  /** You opened an issue or pull request: it's published under your name. */
  private buildOpen(thread: GitHubThread): PublishAction {
    return {
      '@type': 'PublishAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: thread.id,
      timestamp: new Date(thread.createdAt),
      ...(thread.author && { agent: this.buildActor(thread.author) }),
      object: this.buildThread(thread),
    };
  }

  /** A conversation comment on an issue or pull request. */
  private buildComment(comment: GitHubComment, thread: GitHubThread): RespondAction {
    return {
      '@type': 'RespondAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: comment.id,
      timestamp: new Date(comment.createdAt),
      ...(comment.author && { agent: this.buildActor(comment.author) }),
      object: this.buildThread(thread),
      result: this.buildCommentNode(comment, thread),
    };
  }

  /**
   * A review is a Response rated with its verdict. A review with no summary
   * that only comments carries nothing its inline comments don't, and GitHub
   * files each reply in a review thread as one, so it gets no action of its
   * own; its inline comments still point at it.
   */
  private buildReview({
    review,
    comments,
    pullRequest,
  }: {
    review: GitHubReview;
    comments: GitHubReviewComment[];
    pullRequest: GitHubThread;
  }): RespondAction[] {
    const actions: RespondAction[] = [];
    if (review.state === 'PENDING') return actions;
    if (review.body || review.state !== 'COMMENTED') {
      actions.push({
        '@type': 'RespondAction',
        '@key': KEY,
        source: SOURCE,
        sourceId: review.id,
        timestamp: new Date(review.submittedAt ?? review.createdAt),
        ...(review.author && { agent: this.buildActor(review.author) }),
        object: this.buildThread(pullRequest),
        result: this.buildReviewNode(review, pullRequest),
      });
    }
    for (const comment of comments) actions.push(this.buildReviewComment(comment, pullRequest));
    return actions;
  }

  /** An inline comment on a pull request's code, in its review and its thread. */
  private buildReviewComment(
    comment: GitHubReviewComment,
    pullRequest: GitHubThread
  ): RespondAction {
    const node: Comment = {
      ...this.buildCommentNode(comment, pullRequest),
      ...(comment.pullRequestReview && {
        isPartOf: [this.ref('Response', comment.pullRequestReview.id)],
      }),
      ...(comment.replyTo && { inReplyTo: [this.ref('Comment', comment.replyTo.id)] }),
    };
    return {
      '@type': 'RespondAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: comment.id,
      timestamp: new Date(comment.createdAt),
      ...(comment.author && { agent: this.buildActor(comment.author) }),
      object: this.buildThread(pullRequest),
      result: node,
    };
  }

  private buildStar({ starredAt, node }: GitHubStar): LikeAction {
    return {
      '@type': 'LikeAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: node.id,
      timestamp: new Date(starredAt),
      ...(this.viewer && { agent: this.buildSelf() }),
      object: this.buildRepository(node),
    };
  }

  private buildGist(gist: GitHubGist): PublishAction {
    const files = gist.files ?? [];
    const languages = [...new Set(files.flatMap(file => file.language?.name ?? []))];
    const name = gist.description || files[0]?.name;
    const code: SoftwareSourceCode = {
      '@type': 'SoftwareSourceCode',
      '@key': KEY,
      source: SOURCE,
      sourceId: gist.id,
      url: gist.url,
      ...(name && { name }),
      datePublished: new Date(gist.createdAt),
      ...(this.viewer && { author: [this.buildSelf()] }),
      ...(languages.length > 0 && { programmingLanguage: languages }),
      // A secret gist is hidden from listings but open to anyone with its URL.
      visibility: gist.isPublic ? 'public' : 'unlisted',
    };
    return {
      '@type': 'PublishAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: gist.id,
      timestamp: new Date(gist.createdAt),
      ...(this.viewer && { agent: this.buildSelf() }),
      object: code,
    };
  }

  private buildThread(thread: GitHubThread): Issue | PullRequest {
    return {
      '@type': thread.__typename === 'PullRequest' ? 'PullRequest' : 'Issue',
      '@key': KEY,
      source: SOURCE,
      sourceId: thread.id,
      url: thread.url,
      name: thread.title,
      ...(thread.body && { body: thread.body }),
      datePublished: new Date(thread.createdAt),
      ...(thread.author && { author: [this.buildActor(thread.author)] }),
      isPartOf: [this.buildRepository(thread.repository)],
      visibility: VISIBILITY[thread.repository.visibility],
    };
  }

  private buildCommentNode(comment: GitHubComment, thread: GitHubThread): Comment {
    return {
      '@type': 'Comment',
      '@key': KEY,
      source: SOURCE,
      sourceId: comment.id,
      url: comment.url,
      ...(comment.body && { body: comment.body }),
      ...(comment.author && { author: [this.buildActor(comment.author)] }),
      about: [this.ref(thread.__typename, thread.id)],
      visibility: VISIBILITY[thread.repository.visibility],
    };
  }

  private buildReviewNode(review: GitHubReview, pullRequest: GitHubThread): Response {
    return {
      '@type': 'Response',
      '@key': KEY,
      source: SOURCE,
      sourceId: review.id,
      url: review.url,
      ...(review.body && { body: review.body }),
      ratingValue: review.state,
      ...(review.author && { author: [this.buildActor(review.author)] }),
      about: [this.ref('PullRequest', pullRequest.id)],
      visibility: VISIBILITY[pullRequest.repository.visibility],
    };
  }

  private buildRepository(repository: GitHubRepository): Repository {
    const topics = repository.repositoryTopics.nodes.map(({ topic }) => topic.name);
    return {
      '@type': 'Repository',
      '@key': KEY,
      source: SOURCE,
      sourceId: repository.id,
      url: repository.url,
      name: repository.nameWithOwner,
      ...(repository.description && { description: repository.description }),
      ...(repository.homepageUrl && { references: [this.buildLink(repository.homepageUrl)] }),
      ...(repository.primaryLanguage && {
        programmingLanguage: [repository.primaryLanguage.name],
      }),
      ...(topics.length > 0 && { tags: topics }),
      creator: [this.buildActor(repository.owner)],
      visibility: VISIBILITY[repository.visibility],
    };
  }

  /** A node another record describes in full, named by its key alone. */
  private ref<T extends 'Issue' | 'PullRequest' | 'Response' | 'Comment'>(type: T, id: string) {
    return { '@type': type, '@key': KEY, source: SOURCE, sourceId: id };
  }

  /** A linked page: the shared `{url}` hub other sources' visits meet. */
  private buildLink(url: string): Entity {
    return { '@type': 'Entity', '@key': ['url'], url };
  }

  private buildActor(actor: GitHubActor): AgentAndChildren {
    if (actor.id && actor.id === this.viewer?.id) return this.buildSelf();
    const type =
      actor.__typename === 'Organization'
        ? 'Organization'
        : actor.__typename === 'Bot'
          ? 'SoftwareAgent'
          : 'Person';
    return {
      '@type': type,
      // An account without an id (rare: enterprise accounts) falls back to its login.
      ...(actor.id
        ? { '@key': KEY, sourceId: actor.id }
        : { '@key': ['@type', 'source', 'handle'] as ['@type', 'source', 'handle'] }),
      source: SOURCE,
      handle: actor.login,
      ...(actor.name && { name: actor.name }),
      url: actor.url,
    };
  }

  private buildSelf(): AgentAndChildren {
    const viewer = this.viewer!;
    return {
      ...selfAgent({
        type: 'Person',
        source: SOURCE,
        sourceId: viewer.id,
        handle: viewer.login,
        ...(viewer.name && { name: viewer.name }),
      }),
      url: viewer.url,
    };
  }
}
