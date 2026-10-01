import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AgentAndChildren,
  CancelAction,
  Comment,
  CompleteAction,
  Entity,
  LikeAction,
  PlanAction,
  PublishAction,
  PullRequest,
  Repository,
  RespondAction,
  SoftwareSourceCode,
  Task,
} from '@chronicle.app/schema';
import {
  GitHubActor,
  GitHubComment,
  GitHubGist,
  GitHubRepository,
  GitHubStar,
  GitHubThread,
  GitHubViewer,
} from '../utils/GitHubProxy.js';
import type { CloseRecord } from './GitHubClosesExtractor.js';
import type { ReplyRecord } from './GitHubRepliesExtractor.js';

const SOURCE = 'github';
const KEY: ['@type', 'source', 'sourceId'] = ['@type', 'source', 'sourceId'];
const HANDLE_KEY: ['@type', 'source', 'handle'] = ['@type', 'source', 'handle'];
/** A repository is its owner's, by name: the owner's id survives a change of login. */
const REPOSITORY_KEY = ['@type', 'source', 'creator.sourceId', 'name'];
/** You star a repository once, so the repository identifies the star. */
const STAR_KEY = ['@type', 'source', 'object.creator.sourceId', 'object.name'];

/** GitHub's visibilities, in the schema's buckets. An enterprise's internal repository is private. */
const VISIBILITY = { PUBLIC: 'public', PRIVATE: 'private', INTERNAL: 'private' } as const;

export default class GitHubTransformer extends ChronicleTransformer {
  /** The account being extracted, set per record from context. */
  private viewer?: GitHubViewer;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    // Safe as a per-record field: everything below builds synchronously.
    this.viewer = record.context.viewer;

    switch (record.extraction.recordType) {
      case 'pull-requests': {
        return [this.buildPullRequestOpened(record.data as GitHubThread)];
      }
      case 'issues': {
        return [this.buildIssueOpened(record.data as GitHubThread)];
      }
      case 'comments':
      case 'replies': {
        const { comment, thread } = record.data as ReplyRecord;
        return [this.buildComment(comment, thread)];
      }
      case 'closes': {
        return [this.buildClose(record.data as CloseRecord)];
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

  /** You filed an issue: a task you planned, as a to-do app records one. */
  private buildIssueOpened(issue: GitHubThread): PlanAction {
    return {
      '@type': 'PlanAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: issue.id,
      timestamp: new Date(issue.createdAt),
      ...(issue.author && { agent: this.buildActor(issue.author) }),
      object: this.buildTask(issue),
    };
  }

  /** You opened a pull request: it's published under your name. */
  private buildPullRequestOpened(pullRequest: GitHubThread): PublishAction {
    return {
      '@type': 'PublishAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: pullRequest.id,
      timestamp: new Date(pullRequest.createdAt),
      ...(pullRequest.author && { agent: this.buildActor(pullRequest.author) }),
      object: this.buildPullRequest(pullRequest),
    };
  }

  /**
   * You closed an issue: done when closed as completed, cancelled when closed
   * as not planned or a duplicate. A close from before GitHub recorded reasons
   * has none, and GitHub shows it as completed.
   */
  private buildClose({ event, issue }: CloseRecord): CompleteAction | CancelAction {
    const cancelled = event.stateReason === 'NOT_PLANNED' || event.stateReason === 'DUPLICATE';
    return {
      '@type': cancelled ? 'CancelAction' : 'CompleteAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: event.id,
      timestamp: new Date(event.createdAt),
      ...(event.actor && { agent: this.buildActor(event.actor) }),
      object: this.buildTask(issue),
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

  private buildStar({ starredAt, node }: GitHubStar): LikeAction {
    return {
      '@type': 'LikeAction',
      '@key': STAR_KEY,
      source: SOURCE,
      timestamp: new Date(starredAt),
      ...(this.viewer && { agent: this.buildSelf() }),
      object: this.buildRepository(node),
    };
  }

  private buildGist(gist: GitHubGist): PublishAction {
    const files = gist.files ?? [];
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

  private buildThread(thread: GitHubThread): Task | PullRequest {
    return thread.__typename === 'PullRequest'
      ? this.buildPullRequest(thread)
      : this.buildTask(thread);
  }

  /**
   * An issue is a task: work to be done, filed against its repository. A task
   * isn't a creative work, so who filed it is the agent of its PlanAction.
   */
  private buildTask(issue: GitHubThread): Task {
    return {
      '@type': 'Task',
      '@key': KEY,
      source: SOURCE,
      sourceId: issue.id,
      url: issue.url,
      name: issue.title,
      ...(issue.body && { body: issue.body }),
      isPartOf: [this.buildRepository(issue.repository)],
    };
  }

  private buildPullRequest(pullRequest: GitHubThread): PullRequest {
    return {
      '@type': 'PullRequest',
      '@key': KEY,
      source: SOURCE,
      sourceId: pullRequest.id,
      url: pullRequest.url,
      name: pullRequest.title,
      ...(pullRequest.body && { body: pullRequest.body }),
      datePublished: new Date(pullRequest.createdAt),
      ...(pullRequest.author && { author: [this.buildActor(pullRequest.author)] }),
      isPartOf: [this.buildRepository(pullRequest.repository)],
      visibility: VISIBILITY[pullRequest.repository.visibility],
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
      about: [this.ref(thread.__typename === 'PullRequest' ? 'PullRequest' : 'Task', thread.id)],
      visibility: VISIBILITY[thread.repository.visibility],
    };
  }

  private buildRepository(repository: GitHubRepository): Repository {
    const topics = repository.repositoryTopics.nodes.map(({ topic }) => topic.name);
    return {
      '@type': 'Repository',
      '@key': REPOSITORY_KEY,
      source: SOURCE,
      url: repository.url,
      name: repository.name,
      ...(repository.description && { description: repository.description }),
      ...(repository.homepageUrl && { references: [this.buildLink(repository.homepageUrl)] }),
      ...(topics.length > 0 && { tags: topics }),
      creator: [this.buildActor(repository.owner)],
      visibility: VISIBILITY[repository.visibility],
    };
  }

  /** A node another record describes in full, named by its key alone. */
  private ref<T extends 'Task' | 'PullRequest'>(type: T, id: string) {
    return { '@type': type, '@key': KEY, source: SOURCE, sourceId: id };
  }

  /** A linked page: the shared `{url}` hub other sources' visits meet. */
  private buildLink(url: string): Entity {
    return { '@type': 'Entity', '@key': ['url'], url };
  }

  private buildActor(actor: GitHubActor): AgentAndChildren {
    if (actor.databaseId !== undefined && actor.databaseId === this.viewer?.databaseId) {
      return this.buildSelf();
    }
    const type =
      actor.__typename === 'Organization'
        ? 'Organization'
        : actor.__typename === 'Bot'
          ? 'SoftwareAgent'
          : 'Person';
    return {
      '@type': type,
      // An account without an id (rare: enterprise accounts) falls back to its login.
      ...(actor.databaseId === undefined
        ? { '@key': HANDLE_KEY }
        : { '@key': KEY, sourceId: String(actor.databaseId) }),
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
        sourceId: String(viewer.databaseId),
        handle: viewer.login,
        ...(viewer.name && { name: viewer.name }),
      }),
      url: viewer.url,
    };
  }
}
