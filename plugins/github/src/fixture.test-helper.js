import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import GitHubProxy from '../dist/utils/GitHubProxy.js';

// A fake GitHub GraphQL API on 127.0.0.1, so no test reaches the network, and
// a fake `gh` on PATH, so no test reads the host's GitHub login.

export const TOKEN = 'fixture-token';

// The credential store keeps the first config directory it reads, so the whole
// test process shares one, empty unless a test stores a token.
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'chronicle-github-config-'));
process.env.CHRONICLE_CONFIG_DIR = CONFIG_DIR;
process.on('exit', () => rmSync(CONFIG_DIR, { recursive: true, force: true }));

const user = (databaseId, login, name) => ({
  __typename: 'User',
  databaseId,
  login,
  url: `https://github.com/${login}`,
  name,
});
export const ACTORS = {
  sam: user(1001, 'sam', 'Sam Rivera'),
  riley: user(1002, 'riley', 'Riley Chen'),
  alex: user(1003, 'alex', null),
  bot: {
    __typename: 'Bot',
    databaseId: 2001,
    login: 'ci-bot',
    url: 'https://github.com/apps/ci-bot',
  },
  trailco: {
    __typename: 'Organization',
    databaseId: 3001,
    login: 'trailco',
    url: 'https://github.com/trailco',
    name: 'Trail Co',
  },
};
const { sam, riley, alex, bot, trailco } = ACTORS;

export const VIEWER = {
  databaseId: sam.databaseId,
  login: 'sam',
  name: 'Sam Rivera',
  url: 'https://github.com/sam',
  createdAt: '2022-06-01T00:00:00Z',
};

const repository = (id, nameWithOwner, owner, fields = {}) => ({
  id,
  name: nameWithOwner.split('/')[1],
  nameWithOwner,
  url: `https://github.com/${nameWithOwner}`,
  description: null,
  homepageUrl: null,
  visibility: 'PUBLIC',
  repositoryTopics: { nodes: [] },
  owner,
  ...fields,
});
export const REPOSITORIES = {
  bakery: repository('R_bakery', 'sam/bakery', sam, {
    description: 'Bread recipes',
    homepageUrl: 'https://bakery.example.com',
    repositoryTopics: { nodes: [{ topic: { name: 'bread' } }, { topic: { name: 'recipes' } }] },
  }),
  trails: repository('R_trails', 'trailco/trails', trailco, { visibility: 'PRIVATE' }),
  kiln: repository('R_kiln', 'alex/kiln', alex),
};
const { bakery, trails, kiln } = REPOSITORIES;

const thread = (__typename, id, repo, number, title, author, createdAt, updatedAt, body) => ({
  __typename,
  id,
  number,
  title,
  url: `${repo.url}/${__typename === 'Issue' ? 'issues' : 'pull'}/${number}`,
  createdAt,
  updatedAt,
  author,
  repository: repo,
  body,
});
export const THREADS = {
  oven: thread(
    'PullRequest',
    'PR_oven',
    bakery,
    3,
    'Add an oven timer',
    sam,
    '2025-03-10T10:00:00Z',
    '2025-03-12T00:00:00Z',
    'Counts down.'
  ),
  crust: thread(
    'PullRequest',
    'PR_crust',
    bakery,
    1,
    'Crispier crust',
    sam,
    '2024-11-02T10:00:00Z',
    '2024-11-03T00:00:00Z',
    ''
  ),
  map: thread(
    'PullRequest',
    'PR_map',
    trails,
    7,
    'Draw the ridge trail',
    riley,
    '2025-02-01T10:00:00Z',
    '2025-03-05T00:00:00Z',
    'Adds the ridge.'
  ),
  flour: thread(
    'Issue',
    'I_flour',
    bakery,
    2,
    'Rye flour runs out',
    sam,
    '2025-01-15T10:00:00Z',
    '2025-03-01T00:00:00Z',
    'We need a bigger bin.'
  ),
  signs: thread(
    'Issue',
    'I_signs',
    trails,
    4,
    'Trail signs are faded',
    alex,
    '2025-01-05T10:00:00Z',
    '2025-02-20T00:00:00Z',
    'Hard to read.'
  ),
};
const { oven, crust, map, flour, signs } = THREADS;

/** A thread as the target of a comment or review: no body. */
export const ref = ({ body: _, ...rest }) => rest;

const comment = (id, author, body, createdAt, on) => ({
  id,
  body,
  url: `${on.url}#issuecomment-${id}`,
  createdAt,
  author,
});
const reviewComment = (id, author, body, createdAt, on, review, replyTo = null) => ({
  ...comment(id, author, body, createdAt, on),
  url: `${on.url}#discussion_${id}`,
  replyTo: replyTo && { id: replyTo },
  pullRequestReview: { id: review },
});
const review = (id, author, state, body, submittedAt, on) => ({
  id,
  state,
  body,
  url: `${on.url}#pullrequestreview-${id}`,
  submittedAt,
  createdAt: submittedAt,
  author,
});

export const COMMENTS = {
  s0: comment('IC_s0', sam, 'Ordered more.', '2025-01-16T10:00:00Z', flour),
  s1: comment('IC_s1', sam, 'I can repaint them.', '2025-01-06T10:00:00Z', signs),
  s2: comment('IC_s2', sam, 'Looks good once the legend is in.', '2025-02-03T10:00:00Z', map),
  s3: comment('IC_s3', sam, 'Thanks!', '2025-03-11T12:00:00Z', oven),
  r1: comment('IC_r1', riley, 'Nice timer.', '2025-03-11T08:00:00Z', oven),
  r2: comment('IC_r2', riley, 'Legend added.', '2025-02-04T10:00:00Z', map),
  r3: comment('IC_r3', riley, 'Paint is in the shed.', '2025-01-07T10:00:00Z', signs),
  a1: comment('IC_a1', alex, 'First!', '2025-02-02T10:00:00Z', map),
  a2: comment('IC_a2', alex, 'Try the co-op.', '2025-01-17T10:00:00Z', flour),
  b1: comment('IC_b1', bot, 'Preview deployed.', '2025-02-05T10:00:00Z', map),
};
const C = COMMENTS;

export const REVIEWS = {
  // Riley asks for changes on Sam's timer, with one inline comment.
  r1: review('PRR_r1', riley, 'CHANGES_REQUESTED', 'Needs a snooze.', '2025-03-11T09:00:00Z', oven),
  // Sam's reply in that thread, which GitHub files as a review of its own.
  s1: review('PRR_s1', sam, 'COMMENTED', '', '2025-03-11T10:00:00Z', oven),
  // Sam approves Riley's map, starting a review thread Riley answers.
  s2: review('PRR_s2', sam, 'APPROVED', 'Ship it.', '2025-02-06T08:00:00Z', map),
  r3: review('PRR_r3', riley, 'COMMENTED', '', '2025-02-06T12:00:00Z', map),
};
const R = REVIEWS;

export const REVIEW_COMMENTS = {
  r1: reviewComment('PRRC_r1', riley, 'Why 60?', '2025-03-11T09:00:00Z', oven, 'PRR_r1'),
  s1: reviewComment(
    'PRRC_s1',
    sam,
    'A sane default.',
    '2025-03-11T10:00:00Z',
    oven,
    'PRR_s1',
    'PRRC_r1'
  ),
  s2: reviewComment('PRRC_s2', sam, 'Steep here?', '2025-02-06T08:00:00Z', map, 'PRR_s2'),
  r2: reviewComment(
    'PRRC_r2',
    riley,
    'Yes, 30%.',
    '2025-02-06T12:00:00Z',
    map,
    'PRR_r3',
    'PRRC_s2'
  ),
};
const RC = REVIEW_COMMENTS;

const pageOf = nodes => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });

/** Each thread's discussion, as `nodes(ids:)` returns it. */
const DISCUSSIONS = {
  PR_oven: {
    comments: [C.r1, C.s3],
    reviews: [R.r1, R.s1],
    reviewThreads: [{ id: 'PRRT_oven', comments: [RC.r1, RC.s1] }],
  },
  PR_crust: { comments: [], reviews: [], reviewThreads: [] },
  PR_map: {
    comments: [C.a1, C.s2, C.r2, C.b1],
    reviews: [R.s2, R.r3],
    reviewThreads: [{ id: 'PRRT_map', comments: [RC.s2, RC.r2] }],
  },
  I_flour: { comments: [C.s0, C.a2] },
  I_signs: { comments: [C.s1, C.r3] },
};

function discussion(id) {
  const found = Object.values(THREADS).find(t => t.id === id);
  if (!found) return null;
  const { comments, reviews, reviewThreads } = DISCUSSIONS[id];
  return {
    ...ref(found),
    comments: pageOf(comments),
    ...(reviews && {
      reviews: pageOf(reviews),
      reviewThreads: pageOf(reviewThreads.map(t => ({ id: t.id, comments: pageOf(t.comments) }))),
    }),
  };
}

/** Sam's comments, most recently edited first; Sam edited IC_s1 in February. */
const ISSUE_COMMENTS = [
  {
    ...C.s3,
    updatedAt: C.s3.createdAt,
    issue: { ...ref(oven), __typename: 'Issue', id: 'I_oven' },
    pullRequest: ref(oven),
  },
  { ...C.s1, updatedAt: '2025-02-10T10:00:00Z', issue: ref(signs), pullRequest: null },
  {
    ...C.s2,
    updatedAt: C.s2.createdAt,
    issue: { ...ref(map), __typename: 'Issue', id: 'I_map' },
    pullRequest: ref(map),
  },
  { ...C.s0, updatedAt: C.s0.createdAt, issue: ref(flour), pullRequest: null },
];

export const STARS = [
  { starredAt: '2025-03-20T10:00:00Z', node: kiln },
  { starredAt: '2024-06-01T10:00:00Z', node: trails },
];

export const GISTS = [
  {
    id: 'G_hydration',
    name: 'a1b2',
    description: 'Dough hydration calculator',
    url: 'https://gist.github.com/a1b2',
    createdAt: '2025-02-14T10:00:00Z',
    isPublic: true,
    files: [{ name: 'hydration.py' }],
  },
  {
    id: 'G_notes',
    name: 'c3d4',
    description: '',
    url: 'https://gist.github.com/c3d4',
    createdAt: '2024-12-01T10:00:00Z',
    isPublic: false,
    files: [{ name: 'notes.txt' }],
  },
];

/** Sam's reviews; each carries its inline comments. */
const CONTRIBUTIONS = [
  { review: R.s1, comments: [RC.s1], pullRequest: oven },
  { review: R.s2, comments: [RC.s2], pullRequest: map },
].map(({ review: r, comments, pullRequest }) => ({
  occurredAt: r.submittedAt,
  pullRequestReview: { ...r, comments: pageOf(comments) },
  pullRequest: ref(pullRequest),
}));

const CONNECTIONS = {
  pullRequests: [oven, crust],
  issues: [flour],
  // Most recently active first.
  pullRequestsByActivity: [ref(oven), ref(crust)],
  issuesByActivity: [ref(flour)],
  issueComments: ISSUE_COMMENTS,
  starredRepositories: STARS,
  gists: GISTS,
};

/** The connection each by-activity walk reads. */
const ACTIVITY_FIELDS = { pullRequestsByActivity: 'pullRequests', issuesByActivity: 'issues' };

/** One item a page, so every walk pages. */
function page(items, after, edges = false) {
  const start = after ? Number(after) : 0;
  const slice = items.slice(start, start + 1);
  const hasNextPage = start + 1 < items.length;
  return {
    pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + 1) : null },
    ...(edges ? { edges: slice } : { nodes: slice }),
  };
}

/** Tokens the fake API treats specially. */
export const TOKENS = {
  revoked: 'revoked-token',
  limited: 'limited-token',
  scopeless: 'scopeless-token',
};

function respond(token, { query, variables }) {
  if (token === TOKENS.revoked) return [401, { message: 'Bad credentials' }];
  if (token === TOKENS.limited) {
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    return [
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
    ];
  }
  const operation = query.match(/query (\w+)/)[1];
  if (operation === 'Viewer') return [200, { data: { viewer: VIEWER } }];
  const viewerField = operation.match(/^Viewer_(\w+)$/)?.[1];
  if (viewerField === 'gists' && token === TOKENS.scopeless) {
    return [
      200,
      {
        data: null,
        errors: [
          {
            type: 'INSUFFICIENT_SCOPES',
            message:
              "Your token has not been granted the required scopes to execute this query. The 'gists' field requires one of the following scopes: ['gist'], but your token has only been granted the: ['repo'] scopes.",
          },
        ],
      },
    ];
  }
  if (viewerField) {
    const items = CONNECTIONS[viewerField];
    const name = ACTIVITY_FIELDS[viewerField] ?? viewerField;
    return [
      200,
      {
        data: {
          viewer: { [name]: page(items, variables.after, viewerField === 'starredRepositories') },
        },
      },
    ];
  }
  if (operation === 'ReviewContributions') {
    const [from, to] = [Date.parse(variables.from), Date.parse(variables.to)];
    const inWindow = CONTRIBUTIONS.filter(c => {
      const at = Date.parse(c.occurredAt);
      return at >= from && at <= to;
    });
    return [
      200,
      {
        data: {
          viewer: {
            contributionsCollection: {
              pullRequestReviewContributions: page(inWindow, variables.after),
            },
          },
        },
      },
    ];
  }
  if (operation === 'Discussions') {
    return [200, { data: { nodes: variables.ids.map(id => discussion(id)) } }];
  }
  return [200, { errors: [{ message: `The fake API has no ${operation}` }] }];
}

/**
 * Start the fake API and point every proxy at it, with `stored` as the only
 * stored credential, no GH_TOKEN or GITHUB_TOKEN unless `env` sets them, and
 * a `gh` that answers `ghToken` (or is logged out when it's null). Returns
 * the requests, in order, as `{ operation, variables, token }`.
 */
export async function fakeGitHub(t, { ghToken = TOKEN, env = {}, stored } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body);
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      requests.push({
        operation: payload.query.match(/query (\w+)/)[1],
        variables: payload.variables,
        token,
      });
      const [status, json, headers = {}] = respond(token, payload);
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(json));
    });
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { baseURL } = GitHubProxy;
  GitHubProxy.baseURL = `http://127.0.0.1:${server.address().port}`;

  const dir = mkdtempSync(join(tmpdir(), 'chronicle-github-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const credentials = join(CONFIG_DIR, 'credentials.json');
  if (stored) {
    const github = [{ accessToken: stored, tokenType: 'static', createdAt: Date.now() }];
    writeFileSync(credentials, JSON.stringify({ github }));
  }
  const gh = join(bin, 'gh');
  writeFileSync(
    gh,
    ghToken === null
      ? '#!/bin/sh\necho "not logged in" >&2\nexit 1\n'
      : `#!/bin/sh\n[ "$1 $2 $3 $4" = "auth token --hostname github.com" ] && echo "${ghToken}"\n`
  );
  chmodSync(gh, 0o755);

  const saved = {};
  const setEnv = values => {
    for (const [name, value] of Object.entries(values)) {
      if (!(name in saved)) saved[name] = process.env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  setEnv({
    GH_TOKEN: undefined,
    GITHUB_TOKEN: undefined,
    PATH: `${bin}:/usr/bin:/bin`,
    ...env,
  });

  t.after(async () => {
    GitHubProxy.baseURL = baseURL;
    setEnv(saved);
    rmSync(dir, { recursive: true, force: true });
    rmSync(credentials, { force: true });
    await new Promise(resolve => {
      server.close(resolve);
    });
  });
  return { requests };
}
