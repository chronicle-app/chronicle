import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContactCache } from '@chronicle.app/icloud';
import { AppleCallHistoryExtractor, CallHistoryTransformer } from '../dist/index.js';
import { writeCallHistoryFixture, writeContactsFixture } from './fixture.test-helper.js';

// An explicit account and a Contacts lookup over a synthetic AddressBook keep the
// host's iCloud account and contacts out of the test.
const account = {
  accountID: 'me@example.com',
  email: 'me@example.com',
  displayName: 'Me',
  dsid: '123',
};

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'call-history-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function extract(input, config = {}) {
  const extractor = new AppleCallHistoryExtractor({ input, limit: 0, ...config });
  try {
    await extractor.setup();
    return {
      records: await Array.fromAsync(extractor.extract()),
      count: await extractor.determineCount(),
    };
  } finally {
    await extractor.teardown();
  }
}

async function actions(dir) {
  const { records } = await extract(writeCallHistoryFixture(dir));
  const cache = new ContactCache([writeContactsFixture(dir)]);
  const transformer = new CallHistoryTransformer({
    account,
    lookupContact: handle => cache.lookupByHandle(handle),
  });
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) out.push(node.data);
  }
  return new Map(out.map(action => [action.sourceId, action]));
}

const key = ['@type', 'source', 'sourceId'];
const partyKey = ['source', 'handle'];
const me = {
  '@type': 'Person',
  '@key': key,
  source: 'icloud',
  sourceId: '123',
  handle: 'me@example.com',
  sameAs: ['@me'],
};
const alexContact = {
  '@type': 'Person',
  '@key': ['source', 'sourceId'],
  source: 'apple-contacts',
  sourceId: 'contact-1',
  name: 'Alex Contact',
};
const party = (source, handle, extra = {}) => ({
  '@type': 'Agent',
  '@key': partyKey,
  source: 'apple-phone',
  handle,
  ...(extra.name && { name: extra.name }),
  sameAs: [{ '@type': 'Agent', '@key': partyKey, source, handle }, ...(extra.sameAs ?? [])],
});
const call = (sourceId, start, end, fields) => ({
  '@type': 'CallAction',
  '@key': key,
  source: 'apple-phone',
  sourceId,
  startTime: start,
  endTime: end,
  '@assertedAt': start,
  ...fields,
});
const session = (sourceId, fields) => ({
  '@type': 'CallSession',
  '@key': key,
  source: 'apple-phone',
  sourceId,
  ...fields,
});

test('calls become schema-valid CallActions, newest first', async t => {
  const byId = await actions(tempDir(t));
  // The call without a ZUNIQUE_ID is left out.
  assert.deepEqual(
    [...byId.keys()],
    ['CALL-GROUP', 'CALL-BLOCKED', 'CALL-MISSED', 'CALL-IN', 'CALL-OUT']
  );

  // Outgoing 1:1: I am the agent; the callee keys on the normalized number,
  // carries ZNAME, and links to the phone handle and the Contacts card.
  assert.deepEqual(
    byId.get('CALL-OUT'),
    call('CALL-OUT', '2025-01-01T00:01:00.000Z', '2025-01-01T00:01:33.000Z', {
      agent: me,
      result: session('CALL-OUT', {
        recipient: [
          party('phone', '+14165551234', { name: 'Alex Example', sameAs: [alexContact] }),
        ],
      }),
    })
  );

  // Incoming 1:1 by email: the caller is the agent, keyed on the lowercased
  // address; I am the recipient.
  assert.deepEqual(
    byId.get('CALL-IN'),
    call('CALL-IN', '2025-01-01T00:02:00.000Z', '2025-01-01T00:02:10.000Z', {
      agent: party('email', 'friend@example.com'),
      result: session('CALL-IN', { recipient: [me] }),
    })
  );

  // A missed call is a zero-length span.
  assert.deepEqual(
    byId.get('CALL-MISSED'),
    call('CALL-MISSED', '2025-01-01T00:03:00.000Z', '2025-01-01T00:03:00.000Z', {
      agent: party('phone', '+14165559999'),
      result: session('CALL-MISSED', { recipient: [me] }),
    })
  );

  // A blocked or private number has no participant.
  assert.deepEqual(
    byId.get('CALL-BLOCKED'),
    call('CALL-BLOCKED', '2025-01-01T00:04:00.000Z', '2025-01-01T00:04:05.000Z', {
      result: session('CALL-BLOCKED'),
    })
  );

  // An incoming group call: the roster is a Channel keyed on the group UUID, the
  // initiator is unknown, and ZNAME is not used for any member.
  assert.deepEqual(
    byId.get('CALL-GROUP'),
    call('CALL-GROUP', '2025-01-01T00:05:00.000Z', '2025-01-01T00:06:30.000Z', {
      result: session('CALL-GROUP', {
        isPartOf: [
          {
            '@type': 'Channel',
            '@key': key,
            source: 'apple-phone',
            sourceId: 'ABCDEF01',
            member: [
              party('phone', '+14165551234', { name: 'Alex Contact', sameAs: [alexContact] }),
              party('email', 'friend@example.com'),
            ],
          },
        ],
        recipient: [me],
      }),
    })
  );
});

test('extraction honours the time range and counts calls with an id', async t => {
  const input = writeCallHistoryFixture(tempDir(t));
  const { records, count } = await extract(input, {
    since: new Date('2025-01-01T00:02:00Z'),
    until: new Date('2025-01-01T00:04:00Z'),
  });
  // Both bounds are exclusive.
  assert.deepEqual(
    records.map(r => r.context.uuid),
    ['CALL-MISSED']
  );
  assert.equal(count, 5);
});
