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
  id: 'U_sam',
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

/** A thread as the target of a comment: no body. */
export const ref = ({ body: _, ...rest }) => rest;

const comment = (id, author, body, createdAt, on) => ({
  id,
  body,
  url: `${on.url}#issuecomment-${id}`,
  createdAt,
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

const pageOf = nodes => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });

/** Each thread's conversation, as `nodes(ids:)` returns it. */
const DISCUSSIONS = {
  PR_oven: [C.r1, C.s3],
  PR_crust: [],
  PR_map: [C.a1, C.s2, C.r2, C.b1],
  I_flour: [C.s0, C.a2],
  I_signs: [C.s1, C.r3],
};

function discussion(id) {
  const found = Object.values(THREADS).find(t => t.id === id);
  return found ? { ...ref(found), comments: pageOf(DISCUSSIONS[id]) } : null;
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

const closed = (id, actor, createdAt, stateReason) => ({
  __typename: 'ClosedEvent',
  id,
  createdAt,
  ...(stateReason && { stateReason }),
  actor,
});
const merged = (id, actor, createdAt, oid) => ({
  __typename: 'MergedEvent',
  id,
  createdAt,
  actor,
  commit: { oid },
});

const bakeryIssue = (id, number, title, author, createdAt, updatedAt) =>
  ref(thread('Issue', id, bakery, number, title, author, createdAt, updatedAt, ''));
const bakeryPull = (id, number, title, author, createdAt, updatedAt) =>
  ref(thread('PullRequest', id, bakery, number, title, author, createdAt, updatedAt, ''));

/** Alex's report on Sam's bakery: Riley closed it, Alex reopened it, Sam closed it for good. */
export const MOLD = bakeryIssue(
  'I_mold',
  5,
  'Mold in the starter',
  alex,
  '2025-02-01T10:00:00Z',
  '2025-02-15T10:00:00Z'
);
/** Alex's pull requests to Sam's bakery: Sam merged one and declined the other. */
export const RYE = bakeryPull(
  'PR_rye',
  6,
  'Add a rye recipe',
  alex,
  '2025-02-20T10:00:00Z',
  '2025-02-25T10:00:00Z'
);
export const GLAZE = bakeryPull(
  'PR_glaze',
  7,
  'Glaze everything',
  alex,
  '2025-02-10T10:00:00Z',
  '2025-02-12T10:00:00Z'
);

/** How each closed thread ended. Merging also closes a pull request, at the same moment. */
export const ENDINGS = {
  I_flour: [closed('CE_flour', sam, '2025-03-01T00:00:00Z', 'COMPLETED')],
  I_mold: [
    closed('CE_mold_riley', riley, '2025-02-10T10:00:00Z', 'COMPLETED'),
    closed('CE_mold_sam', sam, '2025-02-15T10:00:00Z', 'NOT_PLANNED'),
  ],
  // Riley merged Sam's timer; Sam withdrew his crust change.
  PR_oven: [
    merged('ME_oven', riley, '2025-03-12T00:00:00Z', 'a2a2a2'),
    closed('CE_oven', riley, '2025-03-12T00:00:00Z'),
  ],
  PR_crust: [closed('CE_crust', sam, '2024-11-03T00:00:00Z')],
  PR_rye: [
    merged('ME_rye', sam, '2025-02-25T10:00:00Z', 'a3a3a3'),
    closed('CE_rye', sam, '2025-02-25T10:00:00Z'),
  ],
  PR_glaze: [closed('CE_glaze', sam, '2025-02-12T10:00:00Z')],
};
const ended = t => ({ ...ref(t), timelineItems: { nodes: ENDINGS[t.id] } });

/** Closed threads in each repository Sam owns, most recently active first. */
const ENDED_IN = {
  R_bakery: {
    issues: [ended(flour), ended(MOLD)],
    pullRequests: [ended(oven), ended(RYE), ended(GLAZE), ended(crust)],
  },
};

/** Sam's fork of Trail Co's map. */
export const FORK = repository('R_fork', 'sam/trails', sam);

/** The repositories Sam created, newest first. */
const CREATED = [
  { ...FORK, createdAt: '2024-05-01T10:00:00Z', isFork: true, parent: trails },
  { ...bakery, createdAt: '2023-01-01T10:00:00Z', isFork: false, parent: null },
];

const commit = (oid, messageHeadline, authoredDate, parents, pulls = [], messageBody = '') => ({
  oid,
  messageHeadline,
  messageBody,
  url: `https://github.com/commit/${oid}`,
  authoredDate,
  parents: { nodes: parents.map(parent => ({ oid: parent })) },
  associatedPullRequests: { nodes: pulls.map(pull => ref(pull)) },
});
/** Sam's commits on each repository's default branch, newest first. */
export const COMMITS = {
  R_bakery: [
    commit(
      'a1a1a1',
      'Add an oven timer',
      '2025-03-10T09:00:00Z',
      ['a0a0a0'],
      [oven],
      'Counts down.'
    ),
    commit('a0a0a0', 'Start the recipes', '2023-01-02T10:00:00Z', []),
  ],
  // The ridge label reached Sam's fork too, and counts once.
  R_trails: [commit('b1b1b1', 'Label the ridge', '2025-02-03T10:00:00Z', ['b0b0b0'], [map])],
  R_fork: [commit('b1b1b1', 'Label the ridge', '2025-02-03T10:00:00Z', ['b0b0b0'], [map])],
};
const REPOSITORY_BY_ID = { R_bakery: bakery, R_trails: trails, R_fork: FORK };

const CONNECTIONS = {
  pullRequests: [oven, crust],
  issues: [flour],
  // Most recently active first.
  pullRequestsByActivity: [ref(oven), ref(crust)],
  issuesByActivity: [ref(flour)],
  issueComments: ISSUE_COMMENTS,
  // Sam's own closed threads; the bakery is the only repository he owns.
  closedIssues: [ended(flour)],
  closedPullRequests: [ended(oven), ended(crust)],
  ownedRepositories: [{ id: 'R_bakery' }],
  createdRepositories: CREATED,
  // Sam can push to his own repositories; he committed to Trail Co's lately.
  committableRepositories: [{ id: 'R_bakery' }, { id: 'R_fork' }],
  contributedRepositories: [{ id: 'R_trails' }],
  starredRepositories: STARS,
  gists: GISTS,
};

/** The connection each by-activity walk reads. */
const ACTIVITY_FIELDS = {
  pullRequestsByActivity: 'pullRequests',
  issuesByActivity: 'issues',
  closedIssues: 'issues',
  closedPullRequests: 'pullRequests',
  ownedRepositories: 'repositories',
  createdRepositories: 'repositories',
  committableRepositories: 'repositories',
  contributedRepositories: 'repositoriesContributedTo',
};

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
  scopeless: 'scopeless-token',
};

function respond(token, { query, variables }) {
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
  if (operation === 'Repository_commits') {
    const repo = REPOSITORY_BY_ID[variables.id];
    const history = (COMMITS[variables.id] ?? []).filter(
      c => !variables.since || c.authoredDate >= variables.since
    );
    return [
      200,
      {
        data: {
          node: repo && {
            ...repo,
            defaultBranchRef: { target: { history: page(history, variables.after) } },
          },
        },
      },
    ];
  }
  const kind = operation.match(/^Repository_(issues|pullRequests)$/)?.[1];
  if (kind) {
    const threads = ENDED_IN[variables.id]?.[kind];
    return [200, { data: { node: threads ? { [kind]: page(threads, variables.after) } : null } }];
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
