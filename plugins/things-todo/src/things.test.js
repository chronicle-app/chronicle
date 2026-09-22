import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThingsTodoExtractor, ThingsTodoTransformer } from '../dist/index.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'things-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'things.db');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE TMTask (uuid TEXT, title TEXT, type INTEGER, status INTEGER,
      creationDate REAL, startDate REAL, stopDate REAL, userModificationDate REAL,
      project TEXT, heading TEXT, area TEXT, notes TEXT, trashed INTEGER);
    CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
    CREATE TABLE TMTag (uuid TEXT, title TEXT, parent TEXT, shortcut TEXT, usedDate REAL);
    CREATE TABLE TMArea (uuid TEXT, title TEXT);
    CREATE TABLE TMAreaTag (areas TEXT, tags TEXT);
    INSERT INTO TMArea VALUES ('area-1', 'Work');
    INSERT INTO TMTag VALUES ('tag-1', 'Focus', NULL, NULL, 100);
    INSERT INTO TMTaskTag VALUES ('task-1', 'tag-1');
    INSERT INTO TMTask VALUES ('project-1','Project',2,0,100,NULL,NULL,100,NULL,NULL,'area-1',NULL,0);
    INSERT INTO TMTask VALUES ('task-1','Task',0,3,100,NULL,300,300,'project-1',NULL,'area-1','Notes',0);
    INSERT INTO TMTask VALUES ('task-2','Cancelled',0,2,100,NULL,400,400,NULL,NULL,NULL,NULL,0);
    INSERT INTO TMTask VALUES ('task-3','Edited',0,0,100,NULL,NULL,500,NULL,NULL,NULL,NULL,1);
  `);
  db.close();
  return input;
}
async function records(input, config = {}) {
  const extractor = new ThingsTodoExtractor({ input, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}
test('reads related projects, areas, tags and maps lifecycle events through schema validation', async t => {
  const input = fixture(t);
  const rows = await records(input);
  assert.equal(rows.length, 4);
  const completed = rows.find(r => r.data.uuid === 'task-1');
  assert.equal(completed.context.timeline.status, 'completed');
  assert.equal(completed.context.project.uuid, 'project-1');
  assert.equal(completed.context.area.uuid, 'area-1');
  assert.equal(completed.context.tags[0].title, 'Focus');
  const transformer = new ThingsTodoTransformer();
  const actions = await transformer.performTransform(completed);
  assert.deepEqual(
    actions.map(r => r.data['@type']),
    ['PlanAction', 'CompleteAction']
  );
  assert.deepEqual(
    actions[0].data.object.isPartOf.map(e => e.sourceId),
    ['project-1', 'area-1']
  );
  assert.equal(actions[0].data.object.about[0].sourceId, 'tag-1');
  assert.equal(actions[0].data.object['@asserts'], undefined);
  const cancelled = await transformer.performTransform(rows.find(r => r.data.uuid === 'task-2'));
  assert.deepEqual(
    cancelled.map(r => r.data['@type']),
    ['PlanAction', 'CancelAction']
  );
  const deleted = await transformer.performTransform(rows.find(r => r.data.uuid === 'task-3'));
  assert.deepEqual(
    deleted.map(r => r.data['@type']),
    ['PlanAction', 'DeleteAction']
  );
  assert.deepEqual(
    await transformer.performTransform(rows.find(r => r.data.uuid === 'project-1')),
    []
  );
});
test('inclusive modification windows and newest-first limits', async t => {
  const input = fixture(t);
  assert.deepEqual(
    (await records(input, { since: new Date(300_000), until: new Date(400_000) })).map(
      r => r.data.uuid
    ),
    ['task-2', 'task-1']
  );
  assert.equal((await records(input, { limit: 1 }))[0].data.uuid, 'task-3');
  assert.equal((await records(input, { limit: 0 })).length, 4);
});
test('independent edits emit an update, missing optional enrichment is valid', async t => {
  const [row] = await records(fixture(t), { limit: 1 });
  row.data.trashed = 0;
  const actions = await new ThingsTodoTransformer().performTransform(row);
  assert.deepEqual(
    actions.map(r => r.data['@type']),
    ['PlanAction', 'UpdateAction']
  );
  assert.equal(actions[1].data.timestamp.getTime(), 500_000);
});
