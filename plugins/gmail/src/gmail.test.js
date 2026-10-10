import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GmailApiExtractor, GmailTakeoutExtractor } from '../dist/index.js';
import { FRIEND, OWNER, THREAD, TOKEN, fakeGmail, takeout } from './fixture.test-helper.js';

// API runs get the token outright, so no test reads stored credentials.
async function extract(Extractor, config = {}) {
  const extractor = new Extractor({ accessToken: TOKEN, quiet: true, ...config });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  await extractor.setup();
  const records = [];
  for await (const record of extractor.extract()) records.push(record);
  const transformer = extractor.instantiateDefaultTransformer();
  const actions = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) actions.push(node.data);
  }
  return { extractor, records, actions, events };
}

const identity = (source, handle) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source,
  handle,
});
// A header's display name is another name the address was shown with.
const person = (handle, name, sameAs = []) => ({
  ...identity('email', handle),
  ...(name && { alternateName: [name] }),
  ...(sameAs.length > 0 && { sameAs }),
});
// The account at the mailbox's address, which you are, and the Google
// account at that address.
const account = identity('email', OWNER);
const you = ['@me', identity('google-account', OWNER)];
const owner = person(OWNER, 'Test Owner', you);
const friend = person(FRIEND, 'Test Friend');
// With --link-contacts, the friend is your contact: the entry by its ID in the
// Google account, named as you saved it, with their other address and number.
const linkedFriend = person(FRIEND, 'Test Friend', [
  {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'inAccount[*].handle', 'sourceId'],
    source: 'google-contacts',
    sourceId: 'c1001',
    inAccount: [identity('google-account', OWNER)],
    name: 'Friend From Contacts',
    sameAs: [identity('email', 'friend@home.example'), identity('phone', '+14165550100')],
  },
]);
// The Google account issued Gmail's thread IDs, which are only unique within it.
const thread = {
  '@type': 'Thread',
  source: 'gmail',
  sourceId: THREAD,
  '@key': ['@type', 'source', 'inAccount[*].handle', 'sourceId'],
  inAccount: [identity('google-account', OWNER)],
};
// The author is the action's agent, written there in full; here, by its key.
const byKey = ({ alternateName: _alternateName, sameAs: _sameAs, ...key }) => key;

test('Gmail messages become emails in their thread, with labels, newest first', async t => {
  const requests = await fakeGmail(t);
  const { extractor, records, actions } = await extract(GmailApiExtractor);

  // Spam and Trash are left out unless asked for.
  assert.deepEqual(
    records.map(record => extractor.keyOf(record)),
    ['<reply@example.com>', '<plans@example.com>', '<sale@example.com>']
  );
  assert.equal(requests.find(r => r.path === '/users/me/messages').query.includeSpamTrash, 'false');

  const [reply, plans, sale] = actions;
  // Yours, in reply to the message before it, in the thread.
  assert.deepEqual(reply, {
    '@type': 'MessageAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'email',
    sourceId: 'reply@example.com',
    timestamp: new Date('2025-03-02T09:00:00Z'),
    '@assertedAt': new Date('2025-03-02T09:00:00Z'),
    agent: owner,
    // Keyed by its Message-ID, without the angle brackets, as every copy is,
    // and held in the account.
    object: {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'email',
      sourceId: 'reply@example.com',
      inAccount: [account],
      name: 'Re: Plans',
      body: 'Saturday works.',
      author: [byKey(owner)],
      recipient: [friend],
      inReplyTo: [
        {
          '@type': 'Message',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'email',
          sourceId: 'plans@example.com',
        },
      ],
      isPartOf: [thread],
      tags: ['Sent'],
    },
  });
  // A quoted-printable body is decoded; you, as a recipient, are you; your
  // labels go by name, and read state isn't one.
  assert.equal(plans.object.body, 'Café this weekend?');
  // No display name in the To header, so no name: only the address.
  assert.deepEqual(plans.object.recipient, [person(OWNER, undefined, you)]);
  assert.deepEqual(plans.agent, friend);
  assert.deepEqual(plans.object.tags, ['Inbox', 'Starred', 'Work', 'Café']);
  assert.deepEqual(plans.object.isPartOf, [thread]);
  // An HTML-only message's text, without the markup.
  assert.equal(sale.object.body, 'Half off');
  assert.deepEqual(sale.object.tags, ['Inbox', 'Category Promotions']);
});

test('--sent and --label go by label ID, --query and the window by search', async t => {
  const requests = await fakeGmail(t);
  const { records } = await extract(GmailApiExtractor, {
    sent: true,
    label: 'work',
    query: 'from:boss has:attachment',
    since: new Date('2025-01-01T00:00:00Z'),
  });
  // Only the sent message has the Sent label; the fake doesn't apply `q`.
  assert.equal(records.length, 0);
  const list = requests.find(r => r.path === '/users/me/messages');
  assert.deepEqual(list.labelIds, ['Label_1', 'SENT']);
  assert.equal(list.query.q, 'from:boss has:attachment after:1735689600');
  assert.equal(list.query.includeSpamTrash, 'false');

  // Starred is a label like any other; naming Spam reads it.
  const starred = await extract(GmailApiExtractor, { label: 'Starred' });
  assert.deepEqual(
    starred.records.map(r => r.data.mail.subject),
    ['Plans']
  );
  const spam = await extract(GmailApiExtractor, { label: 'Spam' });
  assert.deepEqual(
    spam.records.map(r => r.data.mail.subject),
    ['Prize']
  );

  const sent = await extract(GmailApiExtractor, { sent: true });
  assert.deepEqual(
    sent.records.map(r => r.data.mail.subject),
    ['Re: Plans']
  );

  await assert.rejects(extract(GmailApiExtractor, { label: 'Nope' }), error => {
    assert.equal(error.code, 'unknown-label');
    assert.match(error.hint, /Work/);
    return true;
  });
});

test('a Takeout becomes the same messages, threads, and labels', async t => {
  await fakeGmail(t);
  const input = takeout(t);
  const fromApi = await extract(GmailApiExtractor);
  const fromTakeout = await extract(GmailTakeoutExtractor, { input });

  // The mbox is oldest first, as Takeout writes it here; Spam is left out.
  const byKey = actions => Object.fromEntries(actions.map(action => [action.sourceId, action]));
  const api = byKey(fromApi.actions);
  const local = byKey(fromTakeout.actions);
  assert.deepEqual(Object.keys(local).sort(), Object.keys(api).sort());
  // Every message is the same node either way: same thread, same labels, and
  // you are you as a recipient too, by the Takeout's Delivered-To.
  assert.deepEqual(local, api);
  assert.deepEqual(local['plans@example.com'].object.isPartOf, [thread]);
  assert.deepEqual(local['plans@example.com'].object.tags, ['Inbox', 'Starred', 'Work', 'Café']);
});

test('a Takeout never reads your contacts', async t => {
  const requests = await fakeGmail(t);
  const { actions } = await extract(GmailTakeoutExtractor, {
    input: takeout(t),
    sent: true,
    linkContacts: true,
  });
  assert.ok(!requests.some(r => r.path === '/people/me/connections'));
  assert.deepEqual(actions[0].object.recipient, [person(FRIEND, 'Test Friend')]);
});

test('a Takeout run filters each message itself', async t => {
  await fakeGmail(t);
  const input = takeout(t);
  const subjects = async config =>
    (await extract(GmailTakeoutExtractor, { input, ...config })).records.map(
      r => r.data.mail.subject
    );

  assert.deepEqual(await subjects({ sent: true }), ['Re: Plans']);
  assert.deepEqual(await subjects({ label: 'Work,Starred' }), ['Plans']);
  // Spam is left out until it's named.
  assert.deepEqual(await subjects({}), ['Re: Plans', 'Plans', 'Sale']);
  assert.deepEqual(await subjects({ label: 'spam' }), ['Prize']);
  // An encoded label matches by its name.
  assert.deepEqual(await subjects({ label: 'Café' }), ['Plans']);
  assert.deepEqual(await subjects({ since: new Date('2025-03-01T00:00:00Z') }), [
    'Re: Plans',
    'Plans',
  ]);

  await assert.rejects(extract(GmailTakeoutExtractor, { input, query: 'from:me' }), {
    code: 'unsupported-flag',
  });
  await assert.rejects(extract(GmailTakeoutExtractor, {}), { code: 'input-not-found' });
});

test('--link-contacts links people to your contacts; without access, the run says how', async t => {
  const requests = await fakeGmail(t);
  // Off by default: your address book isn't read.
  await extract(GmailApiExtractor, { sent: true });
  assert.ok(!requests.some(r => r.path === '/people/me/connections'));
  const linked = await extract(GmailApiExtractor, { sent: true, linkContacts: true });
  assert.deepEqual(linked.actions[0].object.recipient, [linkedFriend]);
});

test('without Contacts access, linked people go unlinked and the run says how to link them', async t => {
  await fakeGmail(t, { noContacts: true });
  const { actions, events } = await extract(GmailApiExtractor, { sent: true, linkContacts: true });
  assert.deepEqual(actions[0].object.recipient, [person(FRIEND, 'Test Friend')]);
  const hint = events.find(event => event.kind === 'hint');
  assert.match(hint.hint.action, /chronicle auth login google --add contacts/);
});
