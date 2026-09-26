import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WhatsappBackupExtractor, WhatsappExtractor, WhatsappTransformer } from '../dist/index.js';
import { decodeReplyStanzaId } from '../dist/replyTarget.js';
import { PARENT_ID, SELF_NUMBER, writeWhatsappFixture } from './fixture.test-helper.js';

// selfNumber and includeContactNames: false keep the host's contacts and iCloud
// account out of the test.
const hostFree = { selfNumber: SELF_NUMBER, includeContactNames: false };

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'whatsapp-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function actions(Extractor, config) {
  const extractor = new Extractor({ ...hostFree, ...config });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new WhatsappTransformer();
    const out = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    return out;
  } finally {
    await extractor.teardown();
  }
}

const key = ['@type', 'source', 'handle'];
const person = (jid, phone, name) => ({
  '@type': 'Person',
  '@key': key,
  source: 'whatsapp',
  handle: jid,
  ...(name && { name }),
  sameAs: [
    { '@type': 'Person', '@key': key, source: 'phone', handle: phone, ...(name && { name }) },
  ],
});
const me = person('14165550000@s.whatsapp.net', SELF_NUMBER);
me.sameAs.push('@me');
const alex = person('14165551234@s.whatsapp.net', '+14165551234', 'Alex');
const riley = person('555111@lid', '+14165559999', 'Riley');
const channel = {
  '@type': 'Channel',
  '@key': key,
  source: 'whatsapp',
  handle: '120363000000000001@g.us',
  name: 'Hike Club',
};

test('messages become schema-valid MessageActions, newest first', async t => {
  const dir = writeWhatsappFixture(tempDir(t));
  const byId = new Map(
    (await actions(WhatsappExtractor, { input: join(dir, 'ChatStorage.sqlite') })).map(a => [
      a.sourceId,
      a,
    ])
  );
  // The system notice and the status update are left out.
  assert.deepEqual([...byId.keys()], ['G3', 'G2', 'G1', 'A2', PARENT_ID]);

  // A group member known only by LID resolves to a phone through ContactsV2.
  assert.deepEqual(byId.get('G1'), {
    '@type': 'MessageAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'whatsapp',
    sourceId: 'G1',
    // The timestamp stays the ISO string the transformer writes.
    timestamp: '2025-01-01T00:00:03.000Z',
    agent: riley,
    object: {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'whatsapp',
      sourceId: 'G1',
      body: 'On my way',
      recipient: [me],
      isPartOf: [channel],
    },
  });

  // The roster rides on the first message seen for the group; a voice note with no
  // file on disk is a placeholder keyed by its message.
  const g3 = byId.get('G3');
  assert.deepEqual(g3.agent, me);
  assert.equal(g3.object.recipient, undefined);
  assert.deepEqual(g3.object.isPartOf, [
    {
      ...channel,
      member: [person('14165550001@s.whatsapp.net', '+14165550001', 'Sam'), riley],
    },
  ]);
  assert.deepEqual(g3.object.contains, [
    {
      '@type': 'AudioObject',
      '@key': ['@type', 'source', 'sourceId'],
      type: 'AudioObject',
      description: undefined,
      source: 'whatsapp',
      sourceId: 'G3',
    },
  ]);

  // A photo on disk carries its path, and its caption is the message body.
  const g2 = byId.get('G2').object;
  assert.equal(g2.body, 'Summit!');
  assert.equal(g2.contains[0].contentPath, join(dir, 'Message', 'Media', 'photo.jpg'));
  assert.equal(g2.contains[0].mimeType, 'image/jpeg');

  // A quoted reply points at its parent by stanza id; a DM has no Channel.
  const a2 = byId.get('A2');
  assert.deepEqual(a2.object.recipient, [alex]);
  assert.equal(a2.object.isPartOf, undefined);
  assert.deepEqual(a2.object.inReplyTo, [
    {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'whatsapp',
      sourceId: PARENT_ID,
    },
  ]);
  assert.deepEqual(byId.get(PARENT_ID).agent, alex);

  assert.deepEqual(
    (
      await actions(WhatsappExtractor, {
        input: join(dir, 'ChatStorage.sqlite'),
        since: new Date('2025-01-01T00:00:03.500Z'),
      })
    ).map(a => a.sourceId),
    ['G3', 'G2']
  );
});

const DOMAIN = 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared';

/** An unencrypted iPhone backup holding the fixture's files, addressed by SHA1 file id. */
function writeBackup(backupDir, sourceDir) {
  mkdirSync(backupDir, { recursive: true });
  const manifest = new DatabaseSync(join(backupDir, 'Manifest.db'));
  manifest.exec(
    'CREATE TABLE Files (fileID TEXT PRIMARY KEY, domain TEXT, relativePath TEXT, flags INTEGER, file BLOB)'
  );
  const insert = manifest.prepare(
    'INSERT INTO Files (fileID, domain, relativePath, flags) VALUES (?, ?, ?, ?)'
  );
  const files = ['ChatStorage.sqlite', 'ContactsV2.sqlite', 'Message/Media/photo.jpg'];
  insert.run('dir', DOMAIN, 'Message', 2);
  // Listed in the manifest but absent from the backup, so it is skipped.
  insert.run(fileId('Message/Media/gone.jpg'), DOMAIN, 'Message/Media/gone.jpg', 1);
  for (const rel of files) {
    const id = fileId(rel);
    mkdirSync(join(backupDir, id.slice(0, 2)), { recursive: true });
    copyFileSync(join(sourceDir, rel), join(backupDir, id.slice(0, 2), id));
    insert.run(id, DOMAIN, rel, 1);
  }
  manifest.close();
}

function fileId(rel) {
  return createHash('sha1').update(`${DOMAIN}-${rel}`).digest('hex');
}

test('an iPhone backup yields the same messages, with media linked out of the backup', async t => {
  const dir = tempDir(t);
  const source = writeWhatsappFixture(join(dir, 'source'));
  const input = join(dir, 'backup');
  const iosWorkDir = join(dir, 'work');
  writeBackup(input, source);

  const out = await actions(WhatsappBackupExtractor, { input, iosWorkDir });
  assert.deepEqual(
    out.map(a => a.sourceId),
    ['G3', 'G2', 'G1', 'A2', PARENT_ID]
  );
  // ContactsV2 came along, so the LID member still resolves to a phone.
  assert.deepEqual(out[2].agent, riley);

  const photo = out[1].object.contains[0].contentPath;
  assert.equal(photo, join(iosWorkDir, 'Message', 'Media', 'photo.jpg'));
  const backedUp = join(
    input,
    fileId('Message/Media/photo.jpg').slice(0, 2),
    fileId('Message/Media/photo.jpg')
  );
  assert.equal(statSync(photo).ino, statSync(backedUp).ino, 'media is hard-linked');

  await assert.rejects(
    actions(WhatsappBackupExtractor, { input: source, iosWorkDir }),
    /not an iOS backup directory/
  );
  writeFileSync(join(input, 'Manifest.db'), 'not a sqlite file');
  await assert.rejects(actions(WhatsappBackupExtractor, { input, iosWorkDir }), /ENCRYPTED/);
});

test('reply targets decode only from protobuf field 5 with a stanza-shaped id', () => {
  const field = (n, value) => {
    const body = Buffer.from(value, 'latin1');
    return Buffer.concat([Buffer.from([n * 8 + 2, body.length]), body]);
  };
  const id = '318C65F0D5647677E2CF9D9CA3200D78';
  assert.equal(decodeReplyStanzaId(Buffer.concat([field(1, 'other'), field(5, id)])), id);
  assert.equal(decodeReplyStanzaId(field(5, 'https://example.com/x')), null);
  assert.equal(decodeReplyStanzaId(Buffer.from('bplist00\u0000\u0001', 'latin1')), null);
  // A media-key blob: field 68 holding 32 binary bytes, no field 5.
  assert.equal(
    decodeReplyStanzaId(Buffer.concat([Buffer.from([0xa2, 0x04, 0x20]), Buffer.alloc(32, 0xab)])),
    null
  );
  assert.equal(decodeReplyStanzaId(null), null);
});
