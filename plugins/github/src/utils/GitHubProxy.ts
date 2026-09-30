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
  primaryLanguage: { name: string } | null;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  owner: GitHubActor;
}

/** An issue or pull request, as the target of a comment or review. */
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

export interface GitHubReviewComment extends GitHubComment {
  replyTo: { id: string } | null;
  pullRequestReview: { id: string } | null;
}

export interface GitHubReview {
  id: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string;
  url: string;
  submittedAt: string | null;
  createdAt: string;
  author: GitHubActor | null;
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
  files: { name: string; language: { name: string } | null }[] | null;
}

export interface GitHubViewer {
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
  primaryLanguage { name }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  owner { __typename login url ... on User { databaseId name } ... on Organization { databaseId name } }`;

const THREAD_FIELDS = `id number title url createdAt updatedAt
  author { ${ACTOR} } repository { ${REPOSITORY} }`;

/** An issue or pull request when it is only the target of something. */
const THREAD = `__typename ${THREAD_FIELDS}`;

const COMMENT = `id body url createdAt author { ${ACTOR} }`;

const REVIEW_COMMENT = `${COMMENT} replyTo { id } pullRequestReview { id }`;

const REVIEW = `id state body url submittedAt createdAt author { ${ACTOR} }`;

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

/** Pages of a connection: the first comes with its parent, later ones by node id. */
export const COMMENTS_PER_THREAD = 50;
export const REVIEWS_PER_PULL_REQUEST = 30;
export const THREADS_PER_PULL_REQUEST = 30;
export const COMMENTS_PER_REVIEW_THREAD = 30;
/** Threads read in one query: small enough to stay inside GitHub's timeouts. */
export const THREADS_PER_BATCH = 10;

/** A thread with the replies-extractor's view of its discussion. */
export interface DiscussedThread extends GitHubThread {
  comments: Page<GitHubComment>;
  reviews?: Page<GitHubReview>;
  reviewThreads?: Page<{ id: string; comments: Page<GitHubReviewComment> }>;
}

const DISCUSSION = `comments(first: ${COMMENTS_PER_THREAD}) { ${PAGE_INFO} nodes { ${COMMENT} } }`;
const PULL_REQUEST_DISCUSSION = `${DISCUSSION}
  reviews(first: ${REVIEWS_PER_PULL_REQUEST}) { ${PAGE_INFO} nodes { ${REVIEW} } }
  reviewThreads(first: ${THREADS_PER_PULL_REQUEST}) { ${PAGE_INFO} nodes { id
    comments(first: ${COMMENTS_PER_REVIEW_THREAD}) { ${PAGE_INFO} nodes { ${REVIEW_COMMENT} } } } }`;

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
      files(limit: 100) { name language { name } } }`,
  },
} as const;

export type ViewerConnection = keyof typeof VIEWER_CONNECTIONS;

export interface GitHubIssueComment extends GitHubComment {
  updatedAt: string;
  issue: GitHubThread;
  pullRequest: GitHubThread | null;
}

export interface ReviewContribution {
  occurredAt: string;
  pullRequestReview: GitHubReview & { comments: Page<GitHubReviewComment> };
  pullRequest: GitHubThread;
}

/** Contributions are windowed; GitHub allows at most a year per query. */
export const CONTRIBUTION_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

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
      'query Viewer { viewer { databaseId login name url createdAt } }'
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

  /** The viewer's submitted reviews in one window of at most a year, newest first. */
  public async *reviewContributions(from: Date, to: Date): AsyncGenerator<ReviewContribution> {
    const operation = 'ReviewContributions';
    const query = `query ${operation}($from: DateTime!, $to: DateTime!, $after: String) {
      viewer { contributionsCollection(from: $from, to: $to) {
        pullRequestReviewContributions(first: 50, after: $after, orderBy: {direction: DESC}) {
          ${PAGE_INFO}
          nodes { occurredAt
            pullRequestReview { ${REVIEW}
              comments(first: 50) { ${PAGE_INFO} nodes { ${REVIEW_COMMENT} } } }
            pullRequest { ${THREAD} } } } } } }`;
    let after: string | null = null;
    for (;;) {
      const data: {
        viewer: {
          contributionsCollection: { pullRequestReviewContributions: Page<ReviewContribution> };
        };
      } = await this.graphql(operation, query, {
        from: from.toISOString(),
        to: to.toISOString(),
        after,
      });
      const page = data.viewer.contributionsCollection.pullRequestReviewContributions;
      yield* page.nodes;
      if (!page.pageInfo.hasNextPage) return;
      after = page.pageInfo.endCursor;
    }
  }

  /** Issues and pull requests with their comments, reviews, and review threads. */
  public async discussions(ids: string[]): Promise<DiscussedThread[]> {
    const operation = 'Discussions';
    const query = `query ${operation}($ids: [ID!]!) { nodes(ids: $ids) {
      __typename
      ... on Issue { ${THREAD_FIELDS} ${DISCUSSION} }
      ... on PullRequest { ${THREAD_FIELDS} ${PULL_REQUEST_DISCUSSION} } } }`;
    const data = await this.graphql<{ nodes: (DiscussedThread | null)[] }>(operation, query, {
      ids,
    });
    // A thread deleted since it was listed comes back null.
    return data.nodes.filter((node): node is DiscussedThread => node !== null);
  }

  /**
   * Every node of a connection whose first page came nested in a larger
   * query: that page, then the rest read from its parent by node id.
   */
  public async all<T>(
    parent: { type: string; id: string },
    field: 'comments' | 'reviews' | 'reviewThreads',
    page: Page<T>
  ): Promise<T[]> {
    const selection = {
      comments: parent.type === 'Issue' || parent.type === 'PullRequest' ? COMMENT : REVIEW_COMMENT,
      reviews: REVIEW,
      reviewThreads: `id comments(first: ${COMMENTS_PER_REVIEW_THREAD}) { ${PAGE_INFO} nodes { ${REVIEW_COMMENT} } }`,
    }[field];
    const operation = `More_${field}`;
    const query = `query ${operation}($id: ID!, $after: String) { node(id: $id) {
      ... on ${parent.type} { ${field}(first: 100, after: $after) { ${PAGE_INFO} nodes { ${selection} } } } } }`;
    const nodes = [...page.nodes];
    let current = page;
    while (current.pageInfo.hasNextPage) {
      const data: { node: Record<string, Page<T>> | null } = await this.graphql(operation, query, {
        id: parent.id,
        after: current.pageInfo.endCursor,
      });
      if (!data.node) break;
      current = data.node[field];
      nodes.push(...current.nodes);
    }
    return nodes;
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
