import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GitHubClosesExtractor,
  GitHubCommentsExtractor,
  GitHubDefaultExtractor,
  GitHubGistsExtractor,
  GitHubIssuesExtractor,
  GitHubPullRequestsExtractor,
  GitHubRepliesExtractor,
  GitHubStarsExtractor,
  GitHubTransformer,
} from '../dist/index.js';
import {
  ACTORS,
  COMMENTS,
  MOLD,
  THREADS,
  TOKEN,
  TOKENS,
  fakeGitHub,
} from './fixture.test-helper.js';

async function extract(Extractor, config = {}) {
  const extractor = new Extractor(config);
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new GitHubTransformer();
    const actions = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) actions.push(node.data);
    }
    const notices = events.filter(e => e.kind === 'notice').map(e => e.message);
    return { keys: records.map(r => extractor.keyOf(r)), actions, notices };
  } finally {
    await extractor.teardown();
  }
}

const source = 'github';
const key = ['@type', 'source', 'sourceId'];
const repositoryKey = ['@type', 'source', 'creator.sourceId', 'name'];
const date = iso => new Date(iso);

const sam = {
  '@type': 'Person',
  source,
  sourceId: '1001',
  handle: 'sam',
  name: 'Sam Rivera',
  '@key': key,
  sameAs: ['@me'],
  url: 'https://github.com/sam',
};
const agent = actor => ({
  '@type': { User: 'Person', Organization: 'Organization', Bot: 'SoftwareAgent' }[actor.__typename],
  '@key': key,
  sourceId: String(actor.databaseId),
  source,
  handle: actor.login,
  ...(actor.name && { name: actor.name }),
  url: actor.url,
});
const alex = agent(ACTORS.alex);
const person = actor => (actor === ACTORS.sam ? sam : agent(actor));

const bakery = {
  '@type': 'Repository',
  '@key': repositoryKey,
  source,
  url: 'https://github.com/sam/bakery',
  name: 'bakery',
  description: 'Bread recipes',
  references: [{ '@type': 'Entity', '@key': ['url'], url: 'https://bakery.example.com' }],
  tags: ['bread', 'recipes'],
  creator: [sam],
  visibility: 'public',
};
const trails = {
  '@type': 'Repository',
  '@key': repositoryKey,
  source,
  url: 'https://github.com/trailco/trails',
  name: 'trails',
  creator: [agent(ACTORS.trailco)],
  visibility: 'private',
};
const kiln = {
  '@type': 'Repository',
  '@key': repositoryKey,
  source,
  url: 'https://github.com/alex/kiln',
  name: 'kiln',
  creator: [alex],
  visibility: 'public',
};
const repositories = { R_bakery: bakery, R_trails: trails, R_kiln: kiln };

/** An issue is a Task; `body` only where the issue itself is the record. */
const task = (t, { withBody = false } = {}) => ({
  '@type': 'Task',
  '@key': key,
  source,
  sourceId: t.id,
  url: t.url,
  name: t.title,
  ...(withBody && t.body && { body: t.body }),
  isPartOf: [repositories[t.repository.id]],
});
const pullRequest = (t, { withBody = false } = {}) => ({
  '@type': 'PullRequest',
  '@key': key,
  source,
  sourceId: t.id,
  url: t.url,
  name: t.title,
  ...(withBody && t.body && { body: t.body }),
  datePublished: date(t.createdAt),
  author: [person(t.author)],
  isPartOf: [repositories[t.repository.id]],
  visibility: repositories[t.repository.id].visibility,
});
const thread = t => (t.__typename === 'Issue' ? task(t) : pullRequest(t));
const ref = (type, id) => ({ '@type': type, '@key': key, source, sourceId: id });

/** An action of Sam's on an issue or pull request, dated `at`. */
const action = (type, sourceId, at, object) => ({
  '@type': type,
  '@key': key,
  source,
  sourceId,
  timestamp: date(at),
  '@assertedAt': date(at),
  agent: sam,
  object,
});

/** A RespondAction for a comment on an issue or pull request. */
const respond = (c, on) => ({
  '@type': 'RespondAction',
  '@key': key,
  source,
  sourceId: c.id,
  timestamp: date(c.createdAt),
  '@assertedAt': date(c.createdAt),
  agent: person(c.author),
  object: thread(on),
  result: {
    '@type': 'Comment',
    '@key': key,
    source,
    sourceId: c.id,
    url: c.url,
    body: c.body,
    author: [person(c.author)],
    about: [ref(on.__typename === 'Issue' ? 'Task' : 'PullRequest', on.id)],
    visibility: repositories[on.repository.id].visibility,
  },
});

const like = (starredAt, object) => ({
  '@type': 'LikeAction',
  '@key': ['@type', 'source', 'object.creator.sourceId', 'object.name'],
  source,
  timestamp: date(starredAt),
  '@assertedAt': date(starredAt),
  agent: sam,
  object,
});

const gist = (id, createdAt, fields) => ({
  '@type': 'PublishAction',
  '@key': key,
  source,
  sourceId: id,
  timestamp: date(createdAt),
  '@assertedAt': date(createdAt),
  agent: sam,
  object: {
    '@type': 'SoftwareSourceCode',
    '@key': key,
    source,
    sourceId: id,
    datePublished: date(createdAt),
    author: [sam],
    ...fields,
  },
});

const { oven, crust, map, flour, signs } = THREADS;

test('pull requests you opened become PublishActions, a page at a time', async t => {
  const { requests } = await fakeGitHub(t);
  const { keys, actions, notices } = await extract(GitHubPullRequestsExtractor);

  assert.deepEqual(keys, ['PR_oven', 'PR_crust']);
  assert.deepEqual(actions, [
    action('PublishAction', 'PR_oven', oven.createdAt, pullRequest(oven, { withBody: true })),
    // An empty description is no body.
    action('PublishAction', 'PR_crust', crust.createdAt, pullRequest(crust)),
  ]);
  assert.deepEqual(
    requests.map(r => r.operation),
    ['Viewer', 'Viewer_pullRequests', 'Viewer_pullRequests']
  );
  assert.deepEqual(notices, ['Using GitHub credentials from gh CLI']);
});

test('`since` ends the walk at the first older pull request', async t => {
  const { requests } = await fakeGitHub(t);
  const { keys } = await extract(GitHubPullRequestsExtractor, { since: date('2025-01-01') });
  assert.deepEqual(keys, ['PR_oven']);
  assert.equal(requests.filter(r => r.operation === 'Viewer_pullRequests').length, 2);
});

test('an issue you opened is a Task you planned', async t => {
  await fakeGitHub(t);
  const { actions } = await extract(GitHubIssuesExtractor);
  assert.deepEqual(actions, [
    action('PlanAction', 'I_flour', flour.createdAt, task(flour, { withBody: true })),
  ]);
});

test('issues you closed are done or cancelled, by why you closed them', async t => {
  await fakeGitHub(t);
  const { keys, actions } = await extract(GitHubClosesExtractor);

  // Your rye issue, read from both your issues and your bakery, counts once;
  // Riley's earlier close of the mold report isn't yours.
  assert.deepEqual(keys, ['CE_flour', 'CE_mold_sam']);
  assert.deepEqual(actions, [
    action('CompleteAction', 'CE_flour', '2025-03-01T00:00:00Z', task(flour)),
    action('CancelAction', 'CE_mold_sam', '2025-02-15T10:00:00Z', task(MOLD)),
  ]);
});

test('`since` ends each walk for closes at the first quiet issue', async t => {
  await fakeGitHub(t);
  const { keys } = await extract(GitHubClosesExtractor, { since: date('2025-02-20') });
  assert.deepEqual(keys, ['CE_flour']);
});

test('your comments respond to their issue or pull request', async t => {
  await fakeGitHub(t);
  const { keys, actions } = await extract(GitHubCommentsExtractor);

  assert.deepEqual(keys, ['IC_s3', 'IC_s1', 'IC_s2', 'IC_s0']);
  // A comment on a pull request is on the pull request, not the issue behind it.
  assert.deepEqual(actions, [
    respond(COMMENTS.s3, oven),
    respond(COMMENTS.s1, signs),
    respond(COMMENTS.s2, map),
    respond(COMMENTS.s0, flour),
  ]);
});

test('`since` keeps comments written since then, though GitHub lists them by edit', async t => {
  const { requests } = await fakeGitHub(t);
  const { keys } = await extract(GitHubCommentsExtractor, { since: date('2025-02-01') });

  // IC_s1 was edited in February but written in January.
  assert.deepEqual(keys, ['IC_s3', 'IC_s2']);
  // The walk stops at IC_s0, the first comment last edited before `since`.
  assert.equal(requests.filter(r => r.operation === 'Viewer_issueComments').length, 4);
});

test('replies are what others said to you, newest first', async t => {
  await fakeGitHub(t);
  const { keys, actions } = await extract(GitHubRepliesExtractor);

  assert.deepEqual(keys, [
    // On Sam's timer PR.
    'IC_r1',
    // On Riley's map after Sam first commented; Alex's earlier "First!" isn't.
    'IC_b1',
    'IC_r2',
    // On Sam's own issue, and on Alex's issue after Sam spoke.
    'IC_a2',
    'IC_r3',
  ]);
  assert.deepEqual(actions, [
    respond(COMMENTS.r1, oven),
    // A bot is a SoftwareAgent.
    respond(COMMENTS.b1, map),
    respond(COMMENTS.r2, map),
    respond(COMMENTS.a2, flour),
    respond(COMMENTS.r3, signs),
  ]);
});

test('replies skip threads quiet since `since`', async t => {
  const { requests } = await fakeGitHub(t);
  const { keys } = await extract(GitHubRepliesExtractor, { since: date('2025-03-01') });

  assert.deepEqual(keys, ['IC_r1']);
  const read = requests.filter(r => r.operation === 'Discussions').flatMap(r => r.variables.ids);
  assert.deepEqual(read.sort(), ['I_flour', 'PR_map', 'PR_oven']);
});

test('stars are LikeActions on the repository, dated when you starred it', async t => {
  await fakeGitHub(t);
  const { keys, actions } = await extract(GitHubStarsExtractor);

  assert.deepEqual(keys, ['alex/kiln', 'trailco/trails']);
  assert.deepEqual(actions, [
    like('2025-03-20T10:00:00Z', kiln),
    like('2024-06-01T10:00:00Z', trails),
  ]);
});

test('gists are published source code; a secret gist is unlisted', async t => {
  await fakeGitHub(t);
  const { actions } = await extract(GitHubGistsExtractor);

  assert.deepEqual(actions, [
    gist('G_hydration', '2025-02-14T10:00:00Z', {
      url: 'https://gist.github.com/a1b2',
      name: 'Dough hydration calculator',
      visibility: 'public',
    }),
    // No description: named after its first file.
    gist('G_notes', '2024-12-01T10:00:00Z', {
      url: 'https://gist.github.com/c3d4',
      name: 'notes.txt',
      visibility: 'unlisted',
    }),
  ]);
});

test('a bare run reads every record type newest first, signing in once', async t => {
  const { requests } = await fakeGitHub(t);
  const { keys, notices } = await extract(GitHubDefaultExtractor, { since: date('2025-03-01') });

  assert.deepEqual(keys, ['alex/kiln', 'IC_s3', 'IC_r1', 'PR_oven', 'CE_flour']);
  assert.deepEqual(notices, ['Using GitHub credentials from gh CLI']);
  assert.equal(requests.filter(r => r.operation === 'Viewer').length, 1);
});

test('credentials: --token, then stored, GH_TOKEN, GITHUB_TOKEN, then gh', async t => {
  const cases = [
    [{ config: { token: 'flag-token' } }, 'flag-token', '--token'],
    [{ stored: 'stored-token' }, 'stored-token', 'chronicle auth'],
    [{ env: { GH_TOKEN: 'gh-env', GITHUB_TOKEN: 'github-env' } }, 'gh-env', 'GH_TOKEN'],
    [{ env: { GITHUB_TOKEN: 'github-env' } }, 'github-env', 'GITHUB_TOKEN'],
    [{}, TOKEN, 'gh CLI'],
  ];
  for (const [{ config = {}, stored, env }, token, label] of cases) {
    await t.test(label, async t => {
      const { requests } = await fakeGitHub(t, { env, stored });
      const { notices } = await extract(GitHubStarsExtractor, config);
      assert.deepEqual(notices, [`Using GitHub credentials from ${label}`]);
      assert.ok(requests.every(r => r.token === token));
    });
  }
});

test('--no-gh leaves gh alone and asks for a token', async t => {
  await fakeGitHub(t);
  await assert.rejects(extract(GitHubStarsExtractor, { gh: false }), {
    name: 'AuthRequired',
    hint: 'run `chronicle auth set github` with a personal access token, or set GH_TOKEN',
  });
});

test('with no token anywhere, the hint names gh', async t => {
  await fakeGitHub(t, { ghToken: null });
  await assert.rejects(extract(GitHubStarsExtractor), {
    name: 'AuthRequired',
    message: 'No GitHub credentials found',
    hint: 'run `gh auth login`, or `chronicle auth set github` with a personal access token',
  });
});

test('a missing scope names the gh command that adds it', async t => {
  await fakeGitHub(t, { ghToken: TOKENS.scopeless });
  await assert.rejects(extract(GitHubGistsExtractor), {
    name: 'PermissionDenied',
    hint: 'run `gh auth refresh -s gist`',
  });
});

test('a missing scope on your own token says which scope to add', async t => {
  await fakeGitHub(t, { env: { GH_TOKEN: TOKENS.scopeless } });
  await assert.rejects(extract(GitHubGistsExtractor), {
    name: 'PermissionDenied',
    hint: 'give the GH_TOKEN token the gist scope',
  });
});

test('a rejected token asks for a new one where it came from', async t => {
  await fakeGitHub(t, { ghToken: TOKENS.revoked });
  await assert.rejects(extract(GitHubStarsExtractor), {
    name: 'AuthRequired',
    message: 'GitHub rejected the token from gh CLI',
    hint: 'run `gh auth login`',
  });
});

test('GitHub’s 403 rate limit is a RateLimited error', async t => {
  await fakeGitHub(t, { env: { GITHUB_TOKEN: TOKENS.limited } });
  await assert.rejects(extract(GitHubStarsExtractor), error => {
    assert.equal(error.name, 'RateLimited');
    assert.ok(error.retryAfter > 0 && error.retryAfter <= 60);
    return true;
  });
});
