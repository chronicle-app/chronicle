import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GitHubGistsExtractor,
  GitHubResolutionsExtractor,
  GitHubStarsExtractor,
  GitHubTransformer,
} from '../dist/index.js';
import {
  ACTORS,
  GLAZE,
  MOLD,
  RYE,
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
    const readAt = records[0]?.extraction.assertedAt;
    return { keys: records.map(r => extractor.keyOf(r)), actions, notices, readAt };
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
const repositories = { R_bakery: bakery, R_trails: trails };

/** An issue is a Task; `body` only where the issue itself is the record. */
/** A commit named by its hash alone, shared across sources. */
const revision = oid => ({ '@type': 'Revision', '@key': ['@type', 'sourceId'], sourceId: oid });
const threadKey = ['@type', 'source', 'isPartOf.creator.sourceId', 'isPartOf.name', 'handle'];
const task = (t, { withBody = false } = {}) => ({
  '@type': 'Task',
  '@key': threadKey,
  source,
  handle: String(t.number),
  url: t.url,
  name: t.title,
  ...(withBody && t.body && { body: t.body }),
  isPartOf: [repositories[t.repository.id]],
});
const changeset = (t, { withBody = false } = {}) => ({
  '@type': 'Changeset',
  '@key': threadKey,
  source,
  handle: String(t.number),
  url: t.url,
  name: t.title,
  ...(withBody && t.body && { body: t.body }),
  author: [person(t.author)],
  isPartOf: [repositories[t.repository.id]],
  visibility: repositories[t.repository.id].visibility,
});

/** An action on an issue or pull request, dated `at`; Sam's unless `by` says whose. */
const action = (type, sourceId, at, object, by = sam) => ({
  '@type': type,
  '@key': key,
  source,
  sourceId,
  timestamp: date(at),
  agent: by,
  object,
});
const { oven, crust, flour } = THREADS;

test('resolutions: how issues and pull requests ended, by you or for your pull requests', async t => {
  await fakeGitHub(t);
  const before = new Date();
  const { keys, actions, readAt } = await extract(GitHubResolutionsExtractor);

  // Riley merged your timer: someone else's decision, on your pull request.
  // A merge also closes, so CE_oven and CE_rye add nothing. Your rye issue,
  // read from your issues and your bakery, counts once; Riley's close of the
  // mold report isn't yours.
  assert.deepEqual(keys, ['ME_oven', 'CE_flour', 'ME_rye', 'CE_mold_sam', 'CE_glaze', 'CE_crust']);
  const riley = agent(ACTORS.riley);
  // GitHub answers with how things are now, so every record is observed when
  // it's read, not when it happened.
  assert.ok(new Date(readAt) >= before && new Date(readAt) <= new Date());
  const observed = actions.map(({ '@assertedAt': assertedAt, ...rest }) => {
    assert.equal(assertedAt, readAt);
    return rest;
  });
  assert.deepEqual(observed, [
    {
      ...action('AcceptAction', 'ME_oven', '2025-03-12T00:00:00Z', changeset(oven), riley),
      result: revision('a2a2a2'),
    },
    action('CompleteAction', 'CE_flour', '2025-03-01T00:00:00Z', task(flour)),
    {
      ...action('AcceptAction', 'ME_rye', '2025-02-25T10:00:00Z', changeset(RYE)),
      result: revision('a3a3a3'),
    },
    action('CancelAction', 'CE_mold_sam', '2025-02-15T10:00:00Z', task(MOLD)),
    // Closed unmerged by someone else: declined.
    action('RejectAction', 'CE_glaze', '2025-02-12T10:00:00Z', changeset(GLAZE)),
    // Closed unmerged by its own author: withdrawn.
    action('CancelAction', 'CE_crust', '2024-11-03T00:00:00Z', changeset(crust)),
  ]);
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

test('a missing scope names the gh command that adds it', async t => {
  await fakeGitHub(t, { ghToken: TOKENS.scopeless });
  await assert.rejects(extract(GitHubGistsExtractor), {
    name: 'PermissionDenied',
    hint: /gh auth refresh -s gist/,
  });
});
