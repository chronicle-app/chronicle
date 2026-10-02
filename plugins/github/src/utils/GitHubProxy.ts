import {
  ApiProxy,
  AuthRequired,
  ExtractorError,
  PermissionDenied,
  RateLimited,
} from '@chronicle.app/etl';
import { CREDENTIAL_LABELS, CredentialSource, GitHubCredential } from './credentials.js';

// ---------------------------------------------------------------------------
// Shapes, as the queries below select them.

export interface GitHubActor {
  __typename: 'User' | 'Organization' | 'Bot' | 'Mannequin' | 'EnterpriseUserAccount';
  /** GitHub's numeric account id, as in `api.github.com/user/<id>`. */
  databaseId?: number;
  login: string;
  url: string;
  name?: string | null;
}

export interface GitHubRepository {
  id: string;
  /** The repository's own name, without its owner. */
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  homepageUrl: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  owner: GitHubActor;
}

/** An issue or pull request, as the target of a comment. */
export interface GitHubThread {
  __typename: 'Issue' | 'PullRequest';
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: GitHubActor | null;
  repository: GitHubRepository;
  /** Only when the thread itself is the record. */
  body?: string;
}

export interface GitHubComment {
  id: string;
  body: string;
  url: string;
  createdAt: string;
  author: GitHubActor | null;
}

/**
 * An issue or pull request being closed, or a pull request being merged. A
 * closed issue's `stateReason` says whether as done, not planned, or a
 * duplicate.
 */
export interface GitHubResolutionEvent {
  __typename: 'ClosedEvent' | 'MergedEvent';
  id: string;
  createdAt: string;
  stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED' | null;
  actor: GitHubActor | null;
  /** The commit a merge made. */
  commit?: { oid: string } | null;
}

/** A repository with when it was made and, for a fork, what it was copied from. */
export interface GitHubOwnRepository extends GitHubRepository {
  createdAt: string;
  isFork: boolean;
  parent: GitHubRepository | null;
}

/** A commit on a repository's default branch. */
export interface GitHubCommit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  url: string;
  authoredDate: string;
  parents: { nodes: { oid: string }[] };
  /** The pull requests it came in through. */
  associatedPullRequests: { nodes: GitHubThread[] };
}

/** A closed issue or pull request with the times it was closed or merged. */
export interface ResolvedThread extends GitHubThread {
  timelineItems: { nodes: GitHubResolutionEvent[] };
}

export interface GitHubStar {
  starredAt: string;
  node: GitHubRepository;
}

export interface GitHubGist {
  id: string;
  name: string;
  description: string | null;
  url: string;
  createdAt: string;
  isPublic: boolean;
  files: { name: string }[] | null;
}

export interface GitHubViewer {
  /** The global node id, which commit history filters by. */
  id: string;
  databaseId: number;
  login: string;
  name: string | null;
  url: string;
  createdAt: string;
}

export interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

interface GraphQLError {
  type?: string;
  message: string;
  path?: (string | number)[];
}

// ---------------------------------------------------------------------------
// Selections.

const ACTOR = `__typename login url
  ... on User { databaseId name } ... on Organization { databaseId name }
  ... on Bot { databaseId } ... on Mannequin { databaseId }`;

const REPOSITORY = `id name nameWithOwner url description homepageUrl visibility
  repositoryTopics(first: 20) { nodes { topic { name } } }
  owner { __typename login url ... on User { databaseId name } ... on Organization { databaseId name } }`;

const THREAD_FIELDS = `id number title url createdAt updatedAt
  author { ${ACTOR} } repository { ${REPOSITORY} }`;

/** An issue or pull request when it is only the target of something. */
const THREAD = `__typename ${THREAD_FIELDS}`;

const COMMENT = `id body url createdAt author { ${ACTOR} }`;

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

/** Comments read with each thread; the rest are read by the thread's id. */
export const COMMENTS_PER_THREAD = 50;
/** Threads read in one query: small enough to stay inside GitHub's timeouts. */
export const THREADS_PER_BATCH = 10;

/** A thread with its conversation, for the replies extractor. */
export interface DiscussedThread extends GitHubThread {
  comments: Page<GitHubComment>;
}

const DISCUSSION = `comments(first: ${COMMENTS_PER_THREAD}) { ${PAGE_INFO} nodes { ${COMMENT} } }`;

/** A closed thread and how it ended. More than twenty closings of one go unread. */
const RESOLVED = {
  issues: {
    args: 'states: CLOSED, orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: `${THREAD} timelineItems(first: 20, itemTypes: [CLOSED_EVENT]) {
      nodes { __typename ... on ClosedEvent { id createdAt stateReason actor { ${ACTOR} } } } }`,
  },
  pullRequests: {
    args: 'states: [MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: `${THREAD} timelineItems(first: 20, itemTypes: [MERGED_EVENT, CLOSED_EVENT]) {
      nodes { __typename
        ... on MergedEvent { id createdAt actor { ${ACTOR} } commit { oid } }
        ... on ClosedEvent { id createdAt actor { ${ACTOR} } } } }`,
  },
} as const;

export type ResolvedKind = keyof typeof RESOLVED;

/** One page of a viewer connection, newest first. */
const VIEWER_CONNECTIONS = {
  pullRequests: {
    args: 'orderBy: {field: CREATED_AT, direction: DESC}',
    selection: `nodes { ${THREAD_FIELDS} body }`,
  },
  issues: {
    args: 'orderBy: {field: CREATED_AT, direction: DESC}',
    selection: `nodes { ${THREAD_FIELDS} body }`,
  },
  // Threads the viewer opened, most recently active first, for replies.
  pullRequestsByActivity: {
    field: 'pullRequests',
    args: 'orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: `nodes { ${THREAD} }`,
  },
  issuesByActivity: {
    field: 'issues',
    args: 'orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: `nodes { ${THREAD} }`,
  },
  // Closed issues and pull requests the viewer opened, most recently active
  // first, for resolutions.
  closedIssues: {
    field: 'issues',
    args: RESOLVED.issues.args,
    selection: `nodes { ${RESOLVED.issues.selection} }`,
  },
  closedPullRequests: {
    field: 'pullRequests',
    args: RESOLVED.pullRequests.args,
    selection: `nodes { ${RESOLVED.pullRequests.selection} }`,
  },
  // Repositories the viewer created, newest first.
  createdRepositories: {
    field: 'repositories',
    args: 'ownerAffiliations: OWNER, orderBy: {field: CREATED_AT, direction: DESC}',
    selection: `nodes { ${REPOSITORY} createdAt isFork parent { ${REPOSITORY} } }`,
  },
  // Repositories the viewer can commit to, and ones they committed to lately
  // (GitHub lists only recent contributions), for commits.
  committableRepositories: {
    field: 'repositories',
    args: 'affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]',
    selection: 'nodes { id }',
  },
  contributedRepositories: {
    field: 'repositoriesContributedTo',
    args: 'contributionTypes: [COMMIT], includeUserRepositories: true',
    selection: 'nodes { id }',
  },
  // Repositories under the viewer's own account, for resolutions.
  ownedRepositories: {
    field: 'repositories',
    args: 'ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: 'nodes { id }',
  },
  // GitHub orders a user's comments by when they were last edited, never by
  // when they were written.
  issueComments: {
    args: 'orderBy: {field: UPDATED_AT, direction: DESC}',
    selection: `nodes { ${COMMENT} updatedAt issue { ${THREAD} } pullRequest { ${THREAD} } }`,
  },
  starredRepositories: {
    args: 'orderBy: {field: STARRED_AT, direction: DESC}',
    selection: `edges { starredAt node { ${REPOSITORY} } }`,
  },
  gists: {
    args: 'privacy: ALL, orderBy: {field: CREATED_AT, direction: DESC}',
    selection: `nodes { id name description url createdAt isPublic
      files(limit: 1) { name } }`,
  },
} as const;

export type ViewerConnection = keyof typeof VIEWER_CONNECTIONS;

export interface GitHubIssueComment extends GitHubComment {
  updatedAt: string;
  issue: GitHubThread;
  pullRequest: GitHubThread | null;
}

// ---------------------------------------------------------------------------

export default class GitHubProxy extends ApiProxy {
  /** The API origin. Tests point it at a local server. */
  static baseURL = 'https://api.github.com';

  constructor(private readonly credential: GitHubCredential) {
    super({
      baseURL: GitHubProxy.baseURL,
      headers: {
        'User-Agent': 'chronicle',
        // Old objects otherwise answer with legacy global ids, which GitHub is
        // migrating away from; the next-generation ids are the stable ones.
        'X-Github-Next-Global-ID': '1',
      },
    });
    this.setAccessToken(credential.token);
  }

  public async initialize(): Promise<void> {}

  get credentialSource(): CredentialSource {
    return this.credential.source;
  }

  public async viewer(): Promise<GitHubViewer> {
    const data = await this.graphql<{ viewer: GitHubViewer }>(
      'Viewer',
      'query Viewer { viewer { id databaseId login name url createdAt } }'
    );
    return data.viewer;
  }

  /** Every item of a viewer connection, a page at a time, in the connection's order. */
  public async *viewerConnection<T>(name: ViewerConnection): AsyncGenerator<T> {
    const spec = VIEWER_CONNECTIONS[name];
    const field = 'field' in spec ? spec.field : name;
    const operation = `Viewer_${name}`;
    const query = `query ${operation}($after: String) { viewer {
      ${field}(first: 50, after: $after, ${spec.args}) { ${PAGE_INFO} ${spec.selection} } } }`;
    let after: string | null = null;
    for (;;) {
      const data: { viewer: Record<string, Page<T> & { edges?: T[] }> } = await this.graphql(
        operation,
        query,
        { after }
      );
      const page = data.viewer[field];
      yield* page.edges ?? page.nodes;
      if (!page.pageInfo.hasNextPage) return;
      after = page.pageInfo.endCursor;
    }
  }

  /**
   * A repository's closed issues or pull requests, most recently active
   * first, with how each ended.
   */
  public async *resolvedIn(
    repositoryId: string,
    kind: ResolvedKind
  ): AsyncGenerator<ResolvedThread> {
    const operation = `Repository_${kind}`;
    const query = `query ${operation}($id: ID!, $after: String) { node(id: $id) {
      ... on Repository { ${kind}(first: 50, after: $after, ${RESOLVED[kind].args}) {
        ${PAGE_INFO} nodes { ${RESOLVED[kind].selection} } } } } }`;
    let after: string | null = null;
    for (;;) {
      const data: { node: Record<string, Page<ResolvedThread>> | null } = await this.graphql(
        operation,
        query,
        { id: repositoryId, after }
      );
      if (!data.node) return;
      const page = data.node[kind];
      yield* page.nodes;
      if (!page.pageInfo.hasNextPage) return;
      after = page.pageInfo.endCursor;
    }
  }

  /**
   * The commits an author made to a repository's default branch, newest
   * first, between `since` and `until` when given.
   */
  public async *commitsIn(
    repositoryId: string,
    authorId: string,
    { since, until }: { since?: Date; until?: Date } = {}
  ): AsyncGenerator<GitHubCommit & { repository: GitHubRepository }> {
    const operation = 'Repository_commits';
    const query = `query ${operation}($id: ID!, $author: ID!, $since: GitTimestamp, $until: GitTimestamp, $after: String) {
      node(id: $id) { ... on Repository { ${REPOSITORY}
        defaultBranchRef { target { ... on Commit {
          history(first: 50, after: $after, author: {id: $author}, since: $since, until: $until) {
            ${PAGE_INFO} nodes { oid messageHeadline messageBody url authoredDate
              parents(first: 5) { nodes { oid } }
              associatedPullRequests(first: 3) { nodes { ${THREAD} } } } } } } } } } }`;
    let after: string | null = null;
    for (;;) {
      const data: {
        node:
          | (GitHubRepository & {
              defaultBranchRef: { target: { history?: Page<GitHubCommit> } } | null;
            })
          | null;
      } = await this.graphql(operation, query, {
        id: repositoryId,
        author: authorId,
        since: since?.toISOString(),
        until: until?.toISOString(),
        after,
      });
      // An empty repository has no default branch.
      const history = data.node?.defaultBranchRef?.target.history;
      if (!data.node || !history) return;
      const { defaultBranchRef: _, ...repository } = data.node;
      for (const commit of history.nodes) yield { ...commit, repository };
      if (!history.pageInfo.hasNextPage) return;
      after = history.pageInfo.endCursor;
    }
  }

  /** Issues and pull requests with their conversations. */
  public async discussions(ids: string[]): Promise<DiscussedThread[]> {
    const operation = 'Discussions';
    const query = `query ${operation}($ids: [ID!]!) { nodes(ids: $ids) {
      __typename
      ... on Issue { ${THREAD_FIELDS} ${DISCUSSION} }
      ... on PullRequest { ${THREAD_FIELDS} ${DISCUSSION} } } }`;
    const data = await this.graphql<{ nodes: (DiscussedThread | null)[] }>(operation, query, {
      ids,
    });
    // A thread deleted since it was listed comes back null.
    return data.nodes.filter((node): node is DiscussedThread => node !== null);
  }

  /** Every comment on a thread: the page read with it, then the rest by its id. */
  public async allComments(thread: DiscussedThread): Promise<GitHubComment[]> {
    const operation = 'More_comments';
    const query = `query ${operation}($id: ID!, $after: String) { node(id: $id) {
      ... on ${thread.__typename} { comments(first: 100, after: $after) {
        ${PAGE_INFO} nodes { ${COMMENT} } } } } }`;
    const comments = [...thread.comments.nodes];
    let page = thread.comments;
    while (page.pageInfo.hasNextPage) {
      const data: { node: { comments: Page<GitHubComment> } | null } = await this.graphql(
        operation,
        query,
        { id: thread.id, after: page.pageInfo.endCursor }
      );
      if (!data.node) break;
      page = data.node.comments;
      comments.push(...page.nodes);
    }
    return comments;
  }

  /**
   * Run a query. GraphQL reports most failures in a 200 response's `errors`,
   * so those are mapped here; HTTP failures go through `mapError`.
   */
  public async graphql<T>(
    operation: string,
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await this.request<{ data?: T | null; errors?: GraphQLError[] }>({
      url: '/graphql',
      method: 'POST',
      data: { query, variables },
    });
    // A node that vanished between queries is a NOT_FOUND beside the data.
    const errors = (response.errors ?? []).filter(
      error => !(error.type === 'NOT_FOUND' && response.data)
    );
    if (errors.length > 0) throw this.graphqlError(operation, errors);
    return response.data as T;
  }

  private graphqlError(operation: string, errors: GraphQLError[]): Error {
    const [first] = errors;
    if (first.type === 'INSUFFICIENT_SCOPES') {
      const scopes = requiredScopes(first.message);
      return new PermissionDenied('The GitHub token is missing a scope this import needs', {
        hint: scopeHint(this.credential.source, scopes),
        fields: { operation, ...(scopes.length > 0 && { scopes }) },
      });
    }
    if (first.type === 'RATE_LIMITED') {
      return new RateLimited('GitHub rate limit reached', { fields: { operation } });
    }
    return new ExtractorError(`GitHub rejected the ${operation} query: ${first.message}`, {
      code: 'github-query-failed',
      fields: { operation, ...(first.type && { type: first.type }) },
    });
  }

  /** Adds GitHub's 403 rate limits and a credential-specific hint to the base mapping. */
  protected override mapError(error: unknown): unknown {
    const response = (error as { response?: { status?: number; headers?: any } })?.response;
    const status = response?.status;
    const headers = response?.headers ?? {};
    if (status === 401) {
      return new AuthRequired(
        `GitHub rejected the token from ${CREDENTIAL_LABELS[this.credential.source]}`,
        { hint: reauthorizeHint(this.credential.source), cause: error }
      );
    }
    if (status === 403 || status === 429) {
      const retryAfter = Number(headers['retry-after']);
      const reset = Number(headers['x-ratelimit-reset']);
      if (Number.isFinite(retryAfter) && headers['retry-after'] !== undefined) {
        return new RateLimited('GitHub rate limit reached', { retryAfter, cause: error });
      }
      if (headers['x-ratelimit-remaining'] === '0' && Number.isFinite(reset)) {
        const wait = Math.max(0, Math.ceil(reset - Date.now() / 1000));
        return new RateLimited('GitHub rate limit reached', { retryAfter: wait, cause: error });
      }
    }
    return super.mapError(error);
  }
}

/** Scopes named in GitHub's INSUFFICIENT_SCOPES message: `… one of the following scopes: ['gist']`. */
function requiredScopes(message: string): string[] {
  const list = message.match(/following scopes: \[([^\]]*)\]/)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

function scopeHint(source: CredentialSource, scopes: string[]): string {
  const scope = scopes[0];
  if (source === 'gh') {
    return scope ? `run \`gh auth refresh -s ${scope}\`` : 'run `gh auth refresh` with the scope';
  }
  const which = source === 'stored' ? 'stored' : CREDENTIAL_LABELS[source];
  return scope
    ? `give the ${which} token the ${scope} scope`
    : `give the ${which} token the scope GitHub asked for`;
}

function reauthorizeHint(source: CredentialSource): string {
  switch (source) {
    case 'gh': {
      return 'run `gh auth login`';
    }
    case 'stored': {
      return 'run `chronicle auth set github` with a new token';
    }
    case 'flag': {
      return 'pass a valid token to --token';
    }
    default: {
      return `update ${source}, or unset it to use another credential`;
    }
  }
}
