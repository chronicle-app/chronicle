import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThingsTodoExtractor, ThingsTodoTransformer } from '../dist/index.js';
import { localAccountName } from '../dist/connectors/ownerName.js';

/** Stub the OS lookup so tests never read the host account. */
function extractorResolving(name) {
  return class extends ThingsTodoExtractor {
    resolveAgentName() {
      return name;
    }
  };
}

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
async function records(input, config = {}, Extractor = extractorResolving()) {
  const extractor = new Extractor({ input, ...config });
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
test('owner name comes from the local account unless agentName overrides it', async t => {
  const input = fixture(t);
  const [resolved] = await records(input, { limit: 1 }, extractorResolving('Pat Example'));
  assert.equal(resolved.context.agent.name, 'Pat Example');
  const [configured] = await records(
    input,
    { limit: 1, agentName: 'Sam Example' },
    extractorResolving('Pat Example')
  );
  assert.equal(configured.context.agent.name, 'Sam Example');

  const [action] = await new ThingsTodoTransformer().performTransform(resolved);
  assert.deepEqual(action.data.agent, {
    '@type': 'Agent',
    '@key': ['@type', 'source'],
    source: 'things-todo',
    name: 'Pat Example',
    sameAs: ['@me'],
  });
  const [unnamed] = await records(input, { limit: 1 });
  const [anonymous] = await new ThingsTodoTransformer().performTransform(unnamed);
  assert.equal(anonymous.data.agent.name, undefined);
  assert.deepEqual(anonymous.data.agent['@key'], ['@type', 'source']);
});
test('local account name reads the macOS full name and is absent elsewhere', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    return 'Pat Example\n';
  };
  assert.equal(localAccountName({ platform: 'darwin', run }), 'Pat Example');
  assert.deepEqual(calls, [['/usr/bin/id', ['-F']]]);
  assert.equal(localAccountName({ platform: 'darwin', run: () => '  \n' }), undefined);
  assert.equal(
    localAccountName({
      platform: 'darwin',
      run() {
        throw new Error('denied');
      },
    }),
    undefined
  );
  assert.equal(
    localAccountName({
      platform: 'linux',
      run() {
        throw new Error('must not run');
      },
    }),
    undefined
  );
});
