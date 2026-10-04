import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleContactsExtractor } from '../dist/index.js';
import { TOKEN, fakePeople } from './fixture.test-helper.js';

// Every run gets the token outright, so no test reads stored credentials.
async function extract(config = {}) {
  const extractor = new GoogleContactsExtractor({ accessToken: TOKEN, quiet: true, ...config });
  await extractor.setup();
  const records = [];
  for await (const record of extractor.extract()) records.push(record);
  const transformer = extractor.instantiateDefaultTransformer();
  const actions = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) actions.push(node.data);
  }
  return { extractor, records, actions };
}

// A snapshot marks each node it states as complete (`@asserts`).
const identity = (source, handle) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source,
  handle,
  '@asserts': ['*'],
});

test('contacts become people, linked to the addresses and numbers others know them by', async t => {
  const requests = await fakePeople(t);
  const { extractor, records, actions } = await extract();

  assert.deepEqual(
    records.map(record => extractor.keyOf(record)),
    ['people/c111', 'people/c222']
  );
  const list = requests.find(r => r.path === '/people/me/connections');
  assert.equal(list.query.sortOrder, 'LAST_MODIFIED_DESCENDING');
  assert.match(list.query.personFields, /emailAddresses/);

  const [ada, bo] = actions;
  // Carried by your last edit to it: the one date Google keeps.
  assert.equal(ada['@type'], 'UpdateAction');
  assert.deepEqual(ada.timestamp, new Date('2025-03-01T10:00:00Z'));
  assert.deepEqual(ada.agent.sameAs, ['@me']);
  const person = ada.object;
  assert.equal(person.name, 'Ada Example');
  assert.equal(person.sourceId, 'c111');
  assert.equal(person.url, 'https://contacts.google.com/person/c111');
  // HTML notes as Markdown; only the current organization; your labels by name.
  assert.equal(person.description, 'Met at **the conference**.');
  assert.deepEqual(
    person.memberOf.map(organization => organization.name),
    ['Example Co']
  );
  assert.deepEqual(person.tags, ['Starred', 'Book club']);
  assert.equal(person.emblem.url, 'https://photos.example/ada.jpg');
  // The identities mail, calendars, and messages key people by.
  assert.deepEqual(person.sameAs, [
    identity('email', 'ada@example.com'),
    identity('email', 'ada@work.example'),
    identity('phone', '+14165550100'),
  ]);

  // A default photo is no photo; a number Google didn't normalize still is.
  assert.equal(bo.object.emblem, undefined);
  assert.deepEqual(bo.object.sameAs, [identity('phone', '+14165550199')]);
});

test('--since stops at the first contact last edited before it', async t => {
  await fakePeople(t);
  const { records } = await extract({ since: new Date('2025-02-15T00:00:00Z') });
  assert.deepEqual(
    records.map(record => record.data.person.resourceName),
    ['people/c111']
  );
});

test('a rejected token says to sign in again', async t => {
  await fakePeople(t);
  await assert.rejects(extract({ accessToken: 'stale' }), { code: 'auth-required' });
});
