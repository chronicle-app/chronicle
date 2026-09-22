import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImessageExtractor, ImessageTransformer } from '../dist/index.js';
import { ContactCache } from '@chronicle.app/icloud';
import { Runner, JsonLoader } from '@chronicle.app/etl';

const account = {
  accountID: 'me@example.com',
  email: 'me@example.com',
  displayName: 'Me',
  dsid: '123',
};
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'imessage-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'chat.db');
  const attachment = join(dir, 'picture.png');
  writeFileSync(attachment, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const db = new DatabaseSync(input);
  db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, service TEXT, date INTEGER, is_from_me INTEGER, handle_id INTEGER, attributedBody BLOB);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT, uti TEXT, total_bytes INTEGER, transfer_name TEXT, is_outgoing INTEGER);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    INSERT INTO handle VALUES (1, 'Friend@Example.com', 'iMessage');
    INSERT INTO chat VALUES (1);
    INSERT INTO chat_handle_join VALUES (1,1);
    INSERT INTO message VALUES (1,'message-1','Hello','iMessage',800000000000000000,0,1,NULL);
    INSERT INTO message VALUES (2,'message-2',NULL,'SMS',800000001000000001,1,1,X'426C6F622074657874');
    INSERT INTO chat_message_join VALUES (1,1),(1,2);
    INSERT INTO message_attachment_join VALUES (1,1);`);
  db.prepare('INSERT INTO attachment VALUES (1, ?, ?, NULL, NULL, 4, ?, 0)').run(
    'attachment-1',
    attachment,
    'Picture'
  );
  db.close();
  const contacts = join(dir, 'contacts.db');
  const address = new DatabaseSync(contacts);
  address.exec(`CREATE TABLE ZABCDRECORD (Z_PK INTEGER, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT, ZEXTERNALUUID TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (ZOWNER INTEGER, ZADDRESS TEXT);
    CREATE TABLE ZABCDPHONENUMBER (ZOWNER INTEGER, ZFULLNUMBER TEXT);
    INSERT INTO ZABCDRECORD VALUES (1,'Friend','Example',NULL,'contact-1');
    INSERT INTO ZABCDEMAILADDRESS VALUES (1,'friend@example.com'),(1,'friend@work.example');`);
  address.close();
  const cache = new ContactCache([contacts]);
  return { dir, input, lookupContact: handle => cache.lookupByHandle(handle) };
}
async function extract(input, config = {}) {
  const extractor = new ImessageExtractor({ input, account, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}
test('native SQLite preserves large timestamps, BLOB text, chat participants and attachments', async t => {
  const { input, lookupContact } = fixture(t);
  const rows = await extract(input);
  assert.equal(rows[0].data.date, '800000001000000001');
  assert.equal(rows[0].context.attributedBody, 'Blob text');
  assert.equal(rows[1].context.participants[0].id, 'Friend@Example.com');
  assert.equal(rows[1].context.attachments.length, 1);
  assert.doesNotThrow(() => JSON.stringify(rows));
  const [action] = await new ImessageTransformer({ lookupContact }).performTransform(rows[1]);
  assert.equal(action.data.agent.name, 'Friend Example');
  assert.deepEqual(
    action.data.agent.sameAs.map(e => e.handle),
    ['Friend@Example.com', 'friend@work.example']
  );
  assert.equal(action.data.object.contains[0]['@type'], 'ImageObject');
  assert.equal(action.data.object.contains[0].sourceId, 'attachment-1');
});
test('outgoing/SMS identities, no-account fallback and contact opt-out', async t => {
  const { input } = fixture(t);
  const rows = await extract(input, { account: null, includeContactNames: false });
  const transformer = new ImessageTransformer({
    lookupContact() {
      throw new Error('contacts disabled');
    },
  });
  const [outgoing] = await transformer.performTransform(rows[0]);
  assert.deepEqual(outgoing.data.agent.sameAs, ['@me']);
  assert.equal(outgoing.data.object.body, 'Blob text');
  assert.equal(outgoing.data.object.recipient[0].handle, 'Friend@Example.com');
  const [incoming] = await transformer.performTransform(rows[1]);
  assert.equal(incoming.data.agent.name, undefined);
  assert.deepEqual(incoming.data.object.recipient[0].sameAs, ['@me']);
});
test('exclusive time windows and newest-first limits', async t => {
  const { input } = fixture(t);
  const rows = await extract(input);
  const first = new Date(rows[1].context.timestamp);
  const last = new Date(rows[0].context.timestamp);
  assert.equal((await extract(input, { since: first, until: last })).length, 0);
  assert.equal((await extract(input, { limit: 1 }))[0].data.guid, 'message-2');
  assert.equal((await extract(input, { limit: 0 })).length, 2);
});
test('sender absent from roster still has source handle and email identity', async t => {
  const { input, lookupContact } = fixture(t);
  const rows = await extract(input);
  rows[1].context.participants = [];
  const [record] = await new ImessageTransformer({ lookupContact }).performTransform(rows[1]);
  assert.equal(record.data.agent.handle, 'Friend@Example.com');
  assert.equal(record.data.agent.sameAs[0].handle, 'Friend@Example.com');
});
test('complete Messages → contacts → schema → JSON pipeline runs on synthetic fixtures', async t => {
  const { input, dir, lookupContact } = fixture(t);
  const output = join(dir, 'output.json');
  const runner = new Runner({ quiet: true, streamExtraction: true })
    .addExtractor(new ImessageExtractor({ input, account, limit: 1 }))
    .addTransformer(new ImessageTransformer({ lookupContact }))
    .addLoader(new JsonLoader({ output }));
  try {
    await runner.setup();
    for await (const log of runner.run()) {
      assert.equal(log.error, undefined);
      assert.equal(log.validationErrors, undefined);
      assert.ok(log.results.every(result => result.success));
    }
  } finally {
    await runner.teardown();
  }
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).object.body, 'Blob text');
});
