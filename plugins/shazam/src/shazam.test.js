import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShazamExtractor, ShazamTransformer } from '../dist/index.js';
import { account, writeShazamFixture } from './fixture.test-helper.js';

// An explicit account keeps the host's iCloud account out of the test, and
// without linkArtists nothing reaches Apple Music.
async function extract(t) {
  const dir = mkdtempSync(join(tmpdir(), 'shazam-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const extractor = new ShazamExtractor({ input: writeShazamFixture(dir), account, limit: 0 });
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

const transformer = new ShazamTransformer();
const transform = async record => (await transformer.performTransform(record))[0].data;

test('each Shazam is extracted once, newest first, as a ListenAction of its song', async t => {
  const { records, count } = await extract(t);
  assert.deepEqual(
    records.map(record => record.data.recognitionID),
    ['SYNC-4', 'RECOGNITION-2', 'RECOGNITION-1']
  );
  assert.equal(count, 3);
  for (const record of records) {
    const action = await transform(record);
    assert.equal(action['@type'], 'ListenAction');
    assert.equal(action.agent.sourceId, account.dsid);
    assert.equal(action.object['@type'], 'MusicRecording');
  }

  // An artist linked on Apple Music is keyed by its ID.
  const linked = { ...records[0], data: { ...records[0].data } };
  linked.data.appleMusicArtist = { id: '4001', name: 'Example Artist' };
  const { object } = await transform(linked);
  assert.deepEqual(
    object.artist.map(artist => [artist.source, artist.sourceId]),
    [['apple-music', '4001']]
  );
});
