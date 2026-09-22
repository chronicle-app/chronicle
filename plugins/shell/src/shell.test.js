import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellHistoryExtractor, ShellHistoryTransformer } from '../dist/index.js';

async function extract(t, content, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shell-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'history');
  writeFileSync(input, content);
  const extractor = new ShellHistoryExtractor({ input, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}
for (const [shell, content] of [
  ['zsh', ': 0:0;echo first\n: 2:0;echo second\n'],
  ['bash', '#0\necho first\n#2\necho second\n'],
  ['fish', '- cmd: echo first\n  when: 0\n- cmd: echo second\n  when: 2\n'],
]) {
  test(`${shell} auto-detection, newest-first, epoch zero and schema-valid actions`, async t => {
    const rows = await extract(t, content);
    assert.deepEqual(
      rows.map(r => r.data.command),
      ['echo second', 'echo first']
    );
    assert.equal(rows[0].data.shell, shell);
    const transformer = new ShellHistoryTransformer({
      username: 'fixture',
      hostname: 'HOST.local',
    });
    const transformed = await transformer.performTransform(rows[1]);
    assert.equal(transformed[0].data.timestamp.getTime(), 0);
    assert.equal(transformed[0].data.agent.memberOf[0].handle, 'host');
    assert.equal(transformed[0].data.object.body, 'echo first');
    const filtered = await extract(t, content, {
      since: new Date(0),
      until: new Date(1000),
      limit: 1,
    });
    assert.equal(filtered[0].data.command, 'echo first');
    assert.equal((await extract(t, content, { limit: 0 })).length, 2);
  });
}
test('missing and malformed timestamps do not invent actions or pass date windows', async t => {
  const rows = await extract(t, 'echo unknown\n#not-a-time\necho also unknown\n', {
    shell: 'bash',
  });
  assert.equal(rows.length, 2);
  const transformer = new ShellHistoryTransformer();
  for (const row of rows) assert.deepEqual(await transformer.performTransform(row), []);
  assert.equal((await extract(t, 'echo unknown\n', { since: new Date(0) })).length, 0);
});
test('same-second commands retain distinct command content in action identity', async t => {
  const rows = await extract(t, ': 1:0;echo one\n: 1:0;echo two\n');
  const transformer = new ShellHistoryTransformer({ username: 'fixture', hostname: 'fixture' });
  const actions = await Promise.all(rows.map(r => transformer.performTransform(r)));
  assert.ok(actions[0][0].data['@key'].includes('object.body'));
  assert.notEqual(actions[0][0].data.object.body, actions[1][0].data.object.body);
});
test('missing input fails explicitly', async () => {
  const extractor = new ShellHistoryExtractor({
    input: '/missing/chronicle-fixture-history',
    shell: 'bash',
  });
  await assert.rejects(Array.fromAsync(extractor.extract()), /Failed to read/);
});
