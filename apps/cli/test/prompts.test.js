import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

const { confirm, select, multiSelect, input } = await import('../dist/output/prompts.js');

const OPTIONS = [
  { label: 'notes', value: 'notes', description: 'what you wrote' },
  { label: 'tags', value: 'tags' },
  { label: 'links', value: 'links' },
];

const DOWN = '\u001B[B';
const CTRL_C = '\u0003';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A terminal that types `keys` one at a time once asked, and keeps what was drawn. */
function typing(...keys) {
  const input = new PassThrough();
  let drawn = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      drawn += chunk;
      callback();
    },
  });
  // Like stderr, it stays open after a question, for the answer's line.
  output.end = () => output;
  (async () => {
    // The question listens for keys once it's drawn.
    while (!drawn) await pause(1);
    await pause(1);
    for (const key of keys) {
      input.write(key);
      await pause(5);
    }
  })();
  return { terminal: { input, output }, drawn: () => drawn };
}

test('confirm takes y or n, then Enter, and leaves the answer', async () => {
  const { terminal, drawn } = typing('n', '\r');
  const result = await confirm('Go ahead?', { defaultValue: true, terminal });
  assert.deepEqual(result, { confirmed: false, cancelled: false });
  assert.match(drawn(), /Go ahead\? No\n$/);
});

test('select starts at the default and moves with the arrows or j and k', async () => {
  const down = typing(DOWN, '\r');
  assert.deepEqual(await select('Which?', OPTIONS, { defaultValue: 'tags', ...down }), {
    value: 'links',
    cancelled: false,
  });
  // Up from the top wraps to the bottom.
  const up = typing('k', '\r');
  assert.equal((await select('Which?', OPTIONS, up)).value, 'links');
});

test('multiSelect takes the toggled options, or the highlighted one, or the defaults', async () => {
  const toggled = typing(' ', 'j', 'j', ' ', '\r');
  assert.deepEqual((await multiSelect('Which?', OPTIONS, toggled)).values, ['notes', 'links']);
  // The picks stay on screen, filled.
  assert.match(toggled.drawn(), /◉ notes what you wrote\n {2}○ tags\n {2}◉ links\n$/);

  const highlighted = typing('j', '\r');
  assert.deepEqual((await multiSelect('Which?', OPTIONS, highlighted)).values, ['tags']);

  const defaults = typing('d', '\r');
  const picked = await multiSelect('Which?', OPTIONS, {
    defaults: ['links', 'notes'],
    ...defaults,
  });
  assert.deepEqual(picked.values, ['notes', 'links']);
});

test('Ctrl+C cancels a question and leaves nothing of it', async () => {
  const { terminal, drawn } = typing(' ', CTRL_C);
  const result = await multiSelect('Which?', OPTIONS, { terminal });
  assert.deepEqual(result, { values: [], cancelled: true });
  // The question clears itself and shows the cursor again; no answer follows.
  assert.match(drawn(), /\u001B\[\?25h$/);
});

test('input asks again until the answer is valid', async () => {
  const { terminal, drawn } = typing('\r', 'A', 'd', 'a', '\r');
  const result = await input('Your name?', {
    validate: value => (value.trim() ? true : 'A name is required'),
    terminal,
  });
  assert.deepEqual(result, { value: 'Ada', cancelled: false });
  assert.match(drawn(), /A name is required/);
  assert.match(drawn(), /Your name\? Ada\n$/);
});
