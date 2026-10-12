import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { AppleVoiceMemosExtractor, AppleVoiceMemosTransformer } from '../dist/index.js';
import { account, ids, writeAppleVoiceMemosFixture } from './fixture.test-helper.js';

// An explicit account keeps the host's iCloud account out of the test.
async function extract(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-voice-memos-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeAppleVoiceMemosFixture(dir);
  // A relative path to the library still gives each file's absolute path.
  const relativeInput = relative(process.cwd(), input);
  const extractor = new AppleVoiceMemosExtractor({ input: relativeInput, account, limit: 0 });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  try {
    await extractor.setup();
    return {
      input,
      records: await Array.fromAsync(extractor.extract()),
      count: await extractor.determineCount(),
      events,
    };
  } finally {
    await extractor.teardown();
  }
}

const transformer = new AppleVoiceMemosTransformer();
const transform = async record => (await transformer.performTransform(record))[0].data;

// An instrument as [type, key, name]: an OS release keyed by its tag, or a
// kind of device keyed by its Wikidata entity.
const release = name => ['OperatingSystem', name, name];
const line = (id, name) => ['ProductModel', `http://www.wikidata.org/entity/${id}`, name];

test('each recording is extracted newest first, with its file and transcript, as a RecordAction', async t => {
  const { input, records, count, events } = await extract(t);
  // A recording in Recently Deleted is left out.
  assert.deepEqual(
    records.map(record => record.data.uniqueID),
    [ids.runs, ids.inline, ids.empty, ids.qta, ids.noPath, ids.notDownloaded, ids.iosOnly, ids.old]
  );
  assert.equal(count, 8);

  // Each record is observed as of the library's last change, since a title or
  // transcript can change after the recording is made.
  const libraryChanged = statSync(input).mtime.toISOString();
  const actions = new Map();
  for (const record of records) {
    assert.equal(record.extraction.recordAssertedAt, libraryChanged);
    const action = await transform(record);
    assert.equal(action['@type'], 'RecordAction');
    assert.equal(action.sourceId, record.data.uniqueID);
    assert.equal(action.agent.sourceId, account.dsid);
    assert.equal(action.result['@type'], 'AudioObject');
    assert.deepEqual(action.result['@key'], ['@type', 'source', 'sourceId']);
    assert.equal(action.result.sourceId, record.data.uniqueID);
    actions.set(record.data.uniqueID, { record: record.data, action });
  }

  // It's dated when recording started. When it stopped isn't known, since
  // recording can be paused.
  const { action: runs } = actions.get(ids.runs);
  assert.equal(runs.timestamp.toISOString(), '2025-01-01T00:10:00.000Z');
  assert.equal(runs.startTime, undefined);
  assert.equal(runs.endTime, undefined);
  assert.equal(runs.result.duration, 'PT12S');
  // A recording whose length the library doesn't give has no duration.
  assert.equal(actions.get(ids.notDownloaded).action.result.duration, undefined);

  // Only a file that's on this Mac is the recording's content.
  for (const { action } of actions.values()) {
    if (action.result.contentPath) assert.ok(isAbsolute(action.result.contentPath));
  }
  const files = [...actions.values()].map(({ action }) => [
    action.result.sourceId,
    action.result.contentPath && basename(action.result.contentPath).split('.').pop(),
    action.result.mimeType,
  ]);
  assert.deepEqual(files, [
    [ids.runs, 'm4a', 'audio/mp4'],
    [ids.inline, 'm4a', 'audio/mp4'],
    [ids.empty, 'm4a', 'audio/mp4'],
    [ids.qta, 'qta', 'audio/x-quicktime'],
    [ids.noPath, undefined, undefined],
    [ids.notDownloaded, undefined, undefined],
    [ids.iosOnly, 'm4a', 'audio/mp4'],
    [ids.old, 'm4a', 'audio/mp4'],
  ]);

  // Transcripts read from both kinds of file and both ways of listing runs.
  for (const id of [ids.runs, ids.inline, ids.qta]) {
    const { record, action } = actions.get(id);
    assert.equal(record.transcript.text, 'Remember the blue kettle.', id);
    assert.equal(record.transcript.locale, 'en_CA');
    assert.deepEqual(record.transcript.segments.at(-1), { text: 'kettle.', start: 1.3, end: 2.1 });
    assert.equal(action.result.transcript, 'Remember the blue kettle.');
  }
  // No speech, or no transcript, gives the recording none.
  const empty = actions.get(ids.empty);
  assert.equal(empty.record.transcript.text, ' ');
  assert.equal(empty.action.result.transcript, undefined);
  for (const id of [ids.iosOnly, ids.old, ids.noPath, ids.notDownloaded]) {
    assert.equal(actions.get(id).record.transcript, null, id);
    assert.equal(actions.get(id).action.result.transcript, undefined, id);
  }

  // A transcript that doesn't read is left out, and the run says so.
  const hints = events.filter(event => event.kind === 'hint');
  assert.deepEqual(
    hints.map(hint => hint.message),
    ['1 transcript couldn’t be read, so its memo has none']
  );
  assert.match(hints[0].hint.action, /Update Chronicle/);

  // The encoder tag is kept as written; a .qta file has none.
  assert.match(actions.get(ids.inline).record.encoder, /\(Watch Version /);
  assert.equal(actions.get(ids.qta).record.encoder, null);
});

test('a recording names the OS release and the kind of device its file says it was made on', async t => {
  const { records } = await extract(t);
  const instruments = new Map();
  for (const record of records) {
    const action = await transform(record);
    instruments.set(
      record.data.uniqueID,
      action.instrument?.map(node => [node['@type'], node.sourceId ?? node.url, node.name])
    );
  }
  assert.deepEqual(instruments.get(ids.runs), [
    release('iPhone Version 18.3 (Build 22D63)'),
    line('Q2766', 'iPhone'),
  ]);
  assert.deepEqual(instruments.get(ids.inline), [
    release('Watch Version 11.3 (Build 22S555)'),
    line('Q18010946', 'Apple Watch'),
  ]);
  // A tag that doesn't name the kind of device gives only the release:
  // `iOS` could be an iPhone or an iPad, and `iPad` could be a Mac, whose
  // Voice Memos is the iPad app.
  assert.deepEqual(instruments.get(ids.iosOnly), [release('iOS 13.3.1')]);
  assert.deepEqual(instruments.get(ids.empty), [release('iPad Version 15.2 (Build 24C101)')]);
  // A release newer than the recording is a later rewrite of the file, and
  // a recording with no tag or no file has nothing to say.
  for (const id of [ids.old, ids.qta, ids.noPath, ids.notDownloaded]) {
    assert.equal(instruments.get(id), undefined, id);
  }
});
