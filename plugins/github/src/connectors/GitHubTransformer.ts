import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  AcceptAction,
  ActionAndChildren,
  AgentAndChildren,
  CancelAction,
  Changeset,
  Comment,
  CompleteAction,
  CreateAction,
  Entity,
  LikeAction,
  PlanAction,
  PublishAction,
  RejectAction,
  Repository,
  RespondAction,
  Revision,
  SoftwareSourceCode,
  Task,
  UpdateAction,
} from '@chronicle.app/schema';
import {
  GitHubActor,
  GitHubCommit,
  GitHubOwnRepository,
  GitHubComment,
  GitHubGist,
  GitHubRepository,
  GitHubStar,
  GitHubThread,
  GitHubViewer,
} from '../utils/GitHubProxy.js';
import type { ReplyRecord } from './GitHubRepliesExtractor.js';
import type { ResolutionRecord } from './GitHubResolutionsExtractor.js';

const SOURCE = 'github';
const KEY: ['@type', 'source', 'sourceId'] = ['@type', 'source', 'sourceId'];
const HANDLE_KEY: ['@type', 'source', 'handle'] = ['@type', 'source', 'handle'];
/** A repository is its owner's, by name: the owner's id survives a change of login. */
const REPOSITORY_KEY = ['@type', 'source', 'creator.sourceId', 'name'];
/**
 * An issue or pull request is its repository's, by number: the #12 in its URL.
 * Issues and pull requests share one sequence, so a number is never both.
 */
const THREAD_KEY = ['@type', 'source', 'isPartOf.creator.sourceId', 'isPartOf.name', 'handle'];
/**
 * A commit is named by its hash wherever it's seen, with no source: a clone
 * and its forge share the node.
 */
const REVISION_KEY = ['@type', 'sourceId'];
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
      case 'resolutions': {
        return [this.buildResolution(record.data as ResolutionRecord)];
      }
      case 'repositories': {
        return [this.buildRepositoryCreated(record.data as GitHubOwnRepository)];
      }
      case 'commits': {
        return [this.buildCommit(record.data as GitHubCommit & { repository: GitHubRepository })];
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

  /** You opened a pull request: a changeset, published to the repository it would change. */
  private buildPullRequestOpened(pullRequest: GitHubThread): PublishAction {
    return {
      '@type': 'PublishAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: pullRequest.id,
      timestamp: new Date(pullRequest.createdAt),
      ...(pullRequest.author && { agent: this.buildActor(pullRequest.author) }),
      object: this.buildChangeset(pullRequest),
    };
  }

  /**
   * How an issue or pull request ended. An issue closed as completed is done,
   * and closed as not planned or a duplicate is cancelled; a close from before
   * GitHub recorded reasons has none, and GitHub shows it as completed. A
   * merged pull request was accepted; one closed unmerged was declined, or
   * withdrawn when its own author closed it.
   */
  private buildResolution({
    event,
    thread,
  }: ResolutionRecord): CompleteAction | CancelAction | AcceptAction | RejectAction {
    const common = {
      '@key': KEY,
      source: SOURCE,
      sourceId: event.id,
      timestamp: new Date(event.createdAt),
      ...(event.actor && { agent: this.buildActor(event.actor) }),
    };
    if (thread.__typename === 'Issue') {
      const cancelled = event.stateReason === 'NOT_PLANNED' || event.stateReason === 'DUPLICATE';
      return {
        '@type': cancelled ? 'CancelAction' : 'CompleteAction',
        ...common,
        object: this.buildTask(thread),
      };
    }
    const withdrawn =
      event.actor?.databaseId !== undefined && event.actor.databaseId === thread.author?.databaseId;
    return {
      '@type':
        event.__typename === 'MergedEvent'
          ? 'AcceptAction'
          : withdrawn
            ? 'CancelAction'
            : 'RejectAction',
      ...common,
      object: this.buildChangeset(thread),
      // A merge makes a commit: the repository's next version.
      ...(event.__typename === 'MergedEvent' &&
        event.commit && { result: this.buildRevisionRef(event.commit.oid) }),
    };
  }

  /** You created a repository; a fork is based on the repository it copied. */
  private buildRepositoryCreated(repository: GitHubOwnRepository): CreateAction {
    return {
      '@type': 'CreateAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: repository.id,
      timestamp: new Date(repository.createdAt),
      ...(this.viewer && { agent: this.buildSelf() }),
      result: {
        ...this.buildRepository(repository),
        ...(repository.parent && { isBasedOn: [this.buildRepository(repository.parent)] }),
      },
    };
  }

  /**
   * You committed: the repository's next version. The commit is a Revision of
   * the repository, based on its parent commits, and part of the pull requests
   * it came in through.
   */
  private buildCommit(commit: GitHubCommit): UpdateAction {
    const revision: Revision = {
      ...this.buildRevisionRef(commit.oid),
      url: commit.url,
      name: commit.messageHeadline,
      ...(commit.messageBody && { body: commit.messageBody }),
      ...(this.viewer && { author: [this.buildSelf()] }),
      isPartOf: [
        this.buildRepository(commit.repository),
        ...commit.associatedPullRequests.nodes.map(pullRequest => this.ref(pullRequest)),
      ],
      ...(commit.parents.nodes.length > 0 && {
        isBasedOn: commit.parents.nodes.map(parent => this.buildRevisionRef(parent.oid)),
      }),
    };
    return {
      '@type': 'UpdateAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: commit.oid,
      timestamp: new Date(commit.authoredDate),
      ...(this.viewer && { agent: this.buildSelf() }),
      object: this.buildRepository(commit.repository),
      result: revision,
    };
  }

  /** A commit named by its hash alone. */
  private buildRevisionRef(oid: string): Revision {
    return { '@type': 'Revision', '@key': REVISION_KEY, sourceId: oid };
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

  private buildThread(thread: GitHubThread): Task | Changeset {
    return thread.__typename === 'PullRequest'
      ? this.buildChangeset(thread)
      : this.buildTask(thread);
  }

  /**
   * An issue is a task: work to be done, filed against its repository. A task
   * isn't a creative work, so who filed it is the agent of its PlanAction.
   */
  private buildTask(issue: GitHubThread): Task {
    return {
      '@type': 'Task',
      '@key': THREAD_KEY,
      source: SOURCE,
      handle: String(issue.number),
      url: issue.url,
      name: issue.title,
      ...(issue.body && { body: issue.body }),
      isPartOf: [this.buildRepository(issue.repository)],
    };
  }

  /** A pull request is a changeset: changes to its repository, put forward as a unit. */
  private buildChangeset(pullRequest: GitHubThread): Changeset {
    return {
      '@type': 'Changeset',
      '@key': THREAD_KEY,
      source: SOURCE,
      handle: String(pullRequest.number),
      url: pullRequest.url,
      name: pullRequest.title,
      ...(pullRequest.body && { body: pullRequest.body }),
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
      about: [this.ref(thread)],
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
  /** An issue or pull request named by its key alone: its repository and number. */
  private ref(thread: GitHubThread) {
    return {
      '@type': thread.__typename === 'PullRequest' ? ('Changeset' as const) : ('Task' as const),
      '@key': THREAD_KEY,
      source: SOURCE,
      handle: String(thread.number),
      isPartOf: [this.buildRepository(thread.repository)],
    };
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
