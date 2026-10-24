import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countMonth } from '@chronicle.app/etl';
import { ClaudeCodeExtractor, ClaudeCodeTransformer } from '../dist/index.js';

function prompt(uuid = 'prompt-1', timestamp = '2026-01-01T00:00:00Z') {
  return {
    type: 'user',
    origin: { kind: 'human' },
    uuid,
    timestamp,
    cwd: '/fixture/project',
    message: { content: 'Do the thing' },
  };
}
function reply(uuid, id, content, timestamp = '2026-01-01T00:00:01Z') {
  return { type: 'assistant', uuid, timestamp, message: { id, model: 'fixture-model', content } };
}
function fixture(t, lines) {
  const root = mkdtempSync(join(tmpdir(), 'claude-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'session-1.jsonl');
  writeFileSync(
    input,
    lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')
  );
  return { root, input };
}
async function extract(input, config = {}) {
  const extractor = new ClaudeCodeExtractor({ input, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}
const lines = () => [
  prompt(),
  reply('reply-1', 'response-1', [{ type: 'text', text: 'Thinking' }]),
  reply('reply-2', 'response-1', [
    { type: 'text', text: 'More' },
    { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo fixture' } },
  ]),
  reply('reply-3', 'response-2', [{ type: 'text', text: 'Done' }], '2026-01-01T00:00:02Z'),
  { type: 'ai-title', aiTitle: 'AI title' },
  { type: 'custom-title', customTitle: 'My session' },
];
async function survey(input, config = {}, options = {}) {
  const extractor = new ClaudeCodeExtractor({ input, ...config });
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

test('a survey counts the messages a run reads, whatever its limit, and in how many sessions', async t => {
  const { root } = fixture(t, lines());
  writeFileSync(
    join(root, 'session-2.jsonl'),
    JSON.stringify(prompt('prompt-2', '2026-01-03T00:00:00Z'))
  );
  const records = await extract(root, { tools: true });
  const times = records.map(r => Date.parse(r.data.timestamp));
  assert.deepEqual(await survey(root, { tools: true, limit: 1 }), {
    messages: {
      count: records.length,
      earliest: new Date(Math.min(...times)),
      latest: new Date(Math.max(...times)),
      measures: [{ key: 'sessions', label: 'sessions', value: 2 }],
    },
  });
  // By month when asked, in local time.
  const months = {};
  for (const time of times) countMonth(months, new Date(time));
  assert.deepEqual(
    (await survey(root, { tools: true }, { byMonth: true })).messages.byMonth,
    months
  );
  const since = new Date('2026-01-02T00:00:00Z');
  assert.equal(
    (await survey(root, { since })).messages.count,
    (await extract(root, { since })).length
  );
});

test('groups streaming reply blocks and maps messages, authors, model, thread and project', async t => {
  const { input } = fixture(t, lines());
  const records = await extract(input);
  assert.deepEqual(
    records.map(r => r.data.body),
    ['Done', 'Thinking\n\nMore', 'Do the thing']
  );
  const transformer = new ClaudeCodeTransformer({ hostname: 'FIXTURE.local' });
  for (const record of records) {
    const [result] = await transformer.performTransform(record);
    const action = result.data;
    assert.equal(action['@type'], 'MessageAction');
    assert.equal(action.object.isPartOf[0].name, 'My session');
    assert.equal(action.object.isPartOf[0].isPartOf[0].inRealm.handle, 'fixture');
    if (record.data.role === 'human') assert.deepEqual(action.agent.sameAs, ['@me']);
    else {
      assert.equal(action.agent.handle, 'claude');
      assert.equal(action.instrument[0]['@type'], 'AIModel');
      assert.equal(action.instrument[0].handle, 'fixture-model');
    }
  }
});
test('assistant modes and independent tool summaries', async t => {
  const { input } = fixture(t, lines());
  assert.deepEqual(
    (await extract(input, { assistant: 'terse' })).map(r => r.data.body),
    ['Done', 'Do the thing']
  );
  assert.deepEqual(
    (await extract(input, { assistant: 'off' })).map(r => r.data.body),
    ['Do the thing']
  );
  const withTools = await extract(input, { assistant: 'off', tools: true });
  assert.deepEqual(
    withTools.map(r => r.data.uuid),
    ['tool-1', 'prompt-1']
  );
  assert.equal(withTools[0].data.body, 'Bash: echo fixture');
});
test('inclusive windows filter before limits and invalid dates/malformed lines are skipped', async t => {
  const { input } = fixture(t, [...lines(), 'not-json', 'null', prompt('bad-date', 'invalid')]);
  const records = await extract(input, {
    since: new Date('2026-01-01T00:00:01Z'),
    until: new Date('2026-01-01T00:00:01Z'),
    limit: 1,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].data.body, 'Thinking\n\nMore');
  assert.equal((await extract(input, { limit: 0 })).length, 3);
});
test('tool results, meta prompts and synthetic assistant messages are excluded', async t => {
  const { input } = fixture(t, [
    { ...prompt('meta'), isMeta: true },
    {
      ...prompt('tool-result'),
      origin: undefined,
      message: { content: [{ type: 'tool_result', content: 'output' }] },
    },
    prompt(),
    {
      ...reply('synthetic', 'x', [{ type: 'text', text: 'ignore' }]),
      message: { model: '<synthetic>', content: [] },
    },
  ]);
  assert.deepEqual(
    (await extract(input)).map(r => r.data.uuid),
    ['prompt-1']
  );
});
test('project root scans sessions but excludes nested subagent transcripts', async t => {
  const { root } = fixture(t, []);
  const projects = join(root, 'projects');
  mkdirSync(join(projects, 'project', 'session', 'subagents'), { recursive: true });
  writeFileSync(join(projects, 'project', 'one.jsonl'), JSON.stringify(prompt()));
  writeFileSync(
    join(projects, 'project', 'session', 'subagents', 'agent.jsonl'),
    JSON.stringify(prompt('subagent'))
  );
  assert.deepEqual(
    (await extract(projects)).map(r => r.data.uuid),
    ['prompt-1']
  );
});
test('transcript account wins and install metadata enriches only a matching account', async t => {
  const { root } = fixture(t, []);
  const projects = join(root, '.claude', 'projects', 'fixture');
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(root, '.claude.json'),
    JSON.stringify({
      oauthAccount: {
        accountUuid: 'account-1',
        emailAddress: 'me@example.com',
        fullName: 'Fixture',
      },
    })
  );
  const input = join(projects, 'session.jsonl');
  const write = uuid =>
    writeFileSync(
      input,
      [prompt(), { type: 'bridge-session', ownerAccountUuid: uuid }]
        .map(line => JSON.stringify(line))
        .join('\n')
    );
  write('account-1');
  let [record] = await extract(input);
  assert.equal(record.context.account.email, 'me@example.com');
  const [action] = await new ClaudeCodeTransformer({ hostname: 'fixture' }).performTransform(
    record
  );
  assert.equal(action.data.agent.sourceId, 'account-1');
  assert.equal(action.data.agent.sameAs[0].handle, 'me@example.com');
  write('account-2');
  [record] = await extract(input);
  assert.deepEqual(record.context.account, { uuid: 'account-2' });
});
test('missing input errors and empty sessions produce no records', async t => {
  const { input, root } = fixture(t, []);
  assert.deepEqual(await extract(input), []);
  await assert.rejects(extract(join(root, 'missing.jsonl')), /ENOENT/);
});
