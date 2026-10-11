import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { AppleVoiceMemosExtractor, AppleVoiceMemosTransformer } from '../dist/index.js';
import { account, ids, writeAppleVoiceMemosFixture } from './fixture.test-helper.js';

// An explicit account keeps the host's iCloud account out of the test.
async function extract(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-voice-memos-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeAppleVoiceMemosFixture(dir);
  const extractor = new AppleVoiceMemosExtractor({ input, account, limit: 0 });
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

const transformer = new AppleVoiceMemosTransformer();
const transform = async record =>
  (await transformer.performTransform(record)).map(output => output.data);

test('each recording is extracted newest first, with its file, as a RecordAction', async t => {
  const { records, count } = await extract(t);
  // A recording in Recently Deleted is left out.
  assert.deepEqual(
    records.map(record => record.data.uniqueID),
    [ids.runs, ids.inline, ids.empty, ids.qta, ids.noPath, ids.notDownloaded, ids.old]
  );
  assert.equal(count, 7);

  const actions = new Map();
  for (const record of records) {
    const [action, transcription] = await transform(record);
    assert.equal(action['@type'], 'RecordAction');
    assert.equal(action.sourceId, record.data.uniqueID);
    assert.equal(action.agent.sourceId, account.dsid);
    assert.equal(action.result['@type'], 'AudioObject');
    assert.deepEqual(action.result['@key'], ['@type', 'source', 'sourceId']);
    assert.equal(action.result.sourceId, record.data.uniqueID);
    actions.set(record.data.uniqueID, { record: record.data, action, transcription });
  }

  // The recording spans from when it started to its duration later.
  const { action: runs } = actions.get(ids.runs);
  assert.equal(new Date(runs.endTime) - new Date(runs.startTime), 12_750);
  assert.equal(runs.result.duration, 'PT12S');

  // Only a file that's on this Mac is the recording's content.
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
    [ids.old, 'm4a', 'audio/mp4'],
  ]);

  // Encoder tags differ by device; a .qta file has none.
  assert.match(actions.get(ids.inline).record.encoder, /\(Watch Version /);
  assert.equal(actions.get(ids.qta).record.encoder, null);
});

test("Voice Memos' transcript is a TranscribeAction made when it saved the file", async t => {
  const { records } = await extract(t);
  const memos = new Map();
  for (const record of records) {
    const [, transcription] = await transform(record);
    memos.set(record.data.uniqueID, { record: record.data, transcription });
  }

  // Transcripts read from both kinds of file and both ways of listing runs.
  for (const id of [ids.runs, ids.inline, ids.qta]) {
    const { record, transcription } = memos.get(id);
    assert.equal(record.transcript.text, 'Remember the blue kettle.', id);
    assert.equal(record.transcript.locale, 'en_CA');
    assert.deepEqual(record.transcript.segments.at(-1), { text: 'kettle.', start: 1.3, end: 2.1 });

    assert.equal(transcription['@type'], 'TranscribeAction');
    assert.equal(transcription.sourceId, id);
    assert.equal(transcription.agent.sourceId, account.dsid);
    assert.equal(transcription.instrument.handle, 'com.apple.VoiceMemos');
    assert.equal(transcription.result['@type'], 'Transcript');
    assert.equal(transcription.result.sourceId, id);
    assert.equal(transcription.result.body, 'Remember the blue kettle.');
    assert.deepEqual(transcription.result.isBasedOn, [
      {
        '@type': 'AudioObject',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'apple-voice-memos',
        sourceId: id,
      },
    ]);
  }

  // It's dated when the file was saved: as recording stopped, or later, read
  // from a 32-bit or a 64-bit movie header.
  assert.equal(
    memos.get(ids.runs).transcription.timestamp.toISOString(),
    '2025-01-01T00:10:13.000Z'
  );
  assert.equal(
    memos.get(ids.inline).transcription.timestamp.toISOString(),
    '2025-01-02T00:08:20.000Z'
  );
  assert.equal(memos.get(ids.qta).record.modified, '2025-01-01T00:05:36.000Z');

  // No speech, or no transcript, makes no transcript.
  const empty = memos.get(ids.empty);
  assert.equal(empty.record.transcript.text, '');
  assert.equal(empty.transcription, undefined);
  for (const id of [ids.old, ids.noPath, ids.notDownloaded]) {
    assert.equal(memos.get(id).record.transcript, null, id);
    assert.equal(memos.get(id).transcription, undefined, id);
  }
  assert.equal(memos.get(ids.old).record.modified, null);
});
