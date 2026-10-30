import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

// `node --test` at a terminal sets FORCE_COLOR; these tests read plain text.
delete process.env.FORCE_COLOR;
process.env.NO_COLOR = '1';

const { awaitEnter, awaitKey, confirm, proceed, select, multiSelect, input } =
  await import('../dist/output/prompts.js');

const OPTIONS = [
  { label: 'notes', value: 'notes', description: 'what you wrote' },
  { label: 'tags', value: 'tags' },
  { label: 'links', value: 'links' },
];

const DOWN = '\u001B[B';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const ESC = '\u001b';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A terminal that types `keys` one at a time once asked, and keeps what was drawn. */
function typing(...keys) {
  const input = new PassThrough();
  let drawn = '';
  const writes = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      drawn += chunk;
      writes.push(String(chunk));
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
  return { terminal: { input, output }, drawn: () => drawn, writes: () => writes };
}

test('confirm takes y or n, then Enter, and leaves the answer', async () => {
  const { terminal, drawn } = typing('n', '\r');
  const result = await confirm('Go ahead?', { defaultValue: true, terminal });
  assert.deepEqual(result, { confirmed: false, cancelled: false });
  assert.match(drawn(), /Go ahead\? No\n$/);
  // Enter alone goes on.
  assert.deepEqual(await proceed('Press Enter to start', typing('\r')), { cancelled: false });
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

test('select can sit inline, under a header and over a body, and be withdrawn', async () => {
  const right = typing('\u001B[C', '\r');
  const options = [
    { label: 'open', value: 'go' },
    { label: 'later', value: 'later' },
  ];
  const later = await select('goodreads', options, {
    inline: true,
    header: () => ['✓ scan'],
    body: ['  1  open the page'],
    ...right,
  });
  assert.equal(later.value, 'later');
  assert.match(right.drawn(), /✓ scan\n\ngoodreads\n {2}1 {2}open the page\n\n❯ open {5}later/);

  // What the highlighted option involves is drawn under the list, and follows the cursor.
  const steps = { go: ['  1  open the page'], later: ['  put off'] };
  const detailed = typing('j', '\r');
  await select('Which way?', options, { detail: value => steps[value], ...detailed });
  assert.match(detailed.writes()[0], /later\n\n {2}1 {2}open the page/);
  assert.match(detailed.drawn(), /later\n\n {2}put off/);

  // Withdrawn, it answers as cancelled, for the caller to tell from Esc by its signal.
  const withdrawn = new AbortController();
  const waiting = select('waiting', options, { signal: withdrawn.signal, ...typing() });
  setTimeout(() => withdrawn.abort(), 20);
  assert.deepEqual(await waiting, { value: '', cancelled: true });

  // Cleared, an answer leaves nothing behind.
  const cleared = typing('\r');
  await multiSelect('Which?', OPTIONS, { clear: true, ...cleared });
  assert.doesNotMatch(cleared.drawn(), /◉ notes what you wrote\n {2}○ tags\n {2}○ links\n$/);
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

  // Some can start selected. With `none`, unselecting them all takes none.
  const initial = typing('j', ' ', '\r');
  const kept = await multiSelect('Which?', OPTIONS, { initial: ['tags', 'links'], ...initial });
  assert.deepEqual(kept.values, ['links']);
  const cleared = typing(' ', '\r');
  const none = await multiSelect('Which?', OPTIONS, { initial: ['notes'], none: true, ...cleared });
  assert.deepEqual(none.values, []);

  // Enter on an action answers with what's selected and it. A description
  // that changes while asked is drawn again when it does.
  let note = 'counting';
  const options = [
    {
      label: 'notes',
      value: 'notes',
      get description() {
        return note;
      },
    },
    { label: 'Look elsewhere', value: 'more', action: true },
  ];
  const acting = typing('k', '\r');
  const acted = await multiSelect('Which?', options, {
    initial: ['notes'],
    subscribe(redraw) {
      setTimeout(() => {
        note = '3 notes';
        redraw();
      });
      return () => {};
    },
    ...acting,
  });
  assert.deepEqual(acted.values, ['notes', 'more']);
  assert.match(acting.drawn(), /notes 3 notes/);

  // A choice that stands alone clears the others, under a rule, and
  // another clears it.
  const apart = [...OPTIONS, { label: 'none of them', value: 'nothing', alone: true }];
  const alone = typing('k', ' ', '\r');
  const nothing = await multiSelect('Which?', apart, { initial: ['notes', 'tags'], ...alone });
  assert.deepEqual(nothing.values, ['nothing']);
  assert.match(alone.drawn(), /○ links\n {2}─+\n {2}◉ none of them\n$/);
  const other = typing(' ', '\r');
  const notes = await multiSelect('Which?', apart, { initial: ['nothing'], ...other });
  assert.deepEqual(notes.values, ['notes']);

  // A key action answers with what's selected and its value; with nothing
  // selected, Enter says it skips.
  const folder = typing(' ', 'f');
  const actions = [{ key: 'f', label: 'add folder', value: 'folder' }];
  const looked = await multiSelect('Which?', OPTIONS, {
    none: true,
    skip: 'skip',
    actions,
    ...folder,
  });
  assert.deepEqual(looked.values, ['notes', 'folder']);
  assert.match(folder.drawn(), /f add folder · enter skip/);

  // One of several steps, ← goes back with what's selected, and → goes on as Enter does.
  const left = typing(' ', '\u001B[D');
  const back = await multiSelect('Which?', OPTIONS, { none: true, back: 'scan', ...left });
  assert.deepEqual(back, { values: ['notes'], cancelled: false, back: true });
  assert.match(left.drawn(), /← scan · enter start/);
  const right = typing('j', ' ', '\u001B[C');
  const on = await multiSelect('Which?', OPTIONS, {
    none: true,
    enter: 'next',
    onward: true,
    ...right,
  });
  assert.deepEqual(on, { values: ['tags'], cancelled: false });
  assert.match(right.drawn(), /enter\/→ next/);
  // Without them, the arrows do nothing.
  const still = typing('\u001B[D', '\u001B[C', '\r');
  assert.deepEqual((await multiSelect('Which?', OPTIONS, still)).values, ['notes']);

  // With no options at all, Enter goes on with none.
  const empty = typing('\r');
  const nothing2 = await multiSelect('Which?', [], { none: true, skip: 'skip', actions, ...empty });
  assert.deepEqual(nothing2.values, []);
  assert.match(empty.drawn(), /f add folder · enter skip · esc cancel/);
});

test('Ctrl+C cancels a question and leaves nothing of it', async () => {
  const { terminal, drawn } = typing(' ', CTRL_C);
  const result = await multiSelect('Which?', OPTIONS, { terminal });
  assert.deepEqual(result, { values: [], cancelled: true });
  // The question clears itself and shows the cursor again; no answer follows.
  assert.match(drawn(), /\u001B\[\?25h$/);
});

test('Ctrl+D cancels any question, as Esc does', async () => {
  // Ctrl+D closes the input; unanswered, the question would leave the CLI's
  // top-level await pending and Node would exit 13.
  assert.deepEqual(await confirm('Go ahead?', typing(CTRL_D)), {
    confirmed: false,
    cancelled: true,
  });
  assert.deepEqual(await select('Which?', OPTIONS, typing('j', CTRL_D)), {
    value: '',
    cancelled: true,
  });
  assert.deepEqual(await multiSelect('Which?', OPTIONS, typing(' ', CTRL_D)), {
    values: [],
    cancelled: true,
  });
  assert.deepEqual(await input('Your name?', typing(CTRL_D)), { value: '', cancelled: true });
  assert.deepEqual(await proceed('Press Enter to start', typing(CTRL_D)), { cancelled: true });
  // A question drawn elsewhere, like the splash's, waits for Enter the same way.
  const terminal = keys => {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => input });
    // It draws nothing, so the keys come once it's listening.
    setTimeout(() => keys.forEach(key => input.write(key)), 5);
    return input;
  };
  assert.equal(await awaitEnter(terminal(['x', '\r'])), true);
  assert.equal(await awaitEnter(terminal([CTRL_C])), false);
  // Its keys answer too, by name; any other does nothing.
  assert.equal(await awaitKey(['g'], terminal(['x', 'g'])), 'g');
  assert.equal(await awaitKey(['g'], terminal(['\r'])), 'enter');
  assert.equal(await awaitKey(['g'], terminal([ESC])), undefined);
});

test('proceed says its keys, and answers with one pressed instead of Enter', async () => {
  const keyed = typing('g');
  const answer = await proceed('Press Enter to carry on', {
    enter: 'carry on',
    actions: [{ key: 'g', label: 'change picks' }],
    ...keyed,
  });
  assert.deepEqual(answer, { cancelled: false, key: 'g' });
  assert.match(keyed.drawn(), /enter carry on · g change picks · esc cancel/);
});

test('multiSelect shows as many options as fit a short terminal, and follows the highlight', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ label: `option${i}`, value: `${i}` }));
  const short = typing('j', 'j', 'j', 'j', 'j', 'j', '\r');
  // Twelve rows: the question, the keys, and the lines around them leave room for seven.
  Object.assign(short.terminal.output, { rows: 12, columns: 80 });
  const picked = await multiSelect('Which?', many, short);
  assert.deepEqual(picked.values, ['6']);
  const drawn = short.drawn();
  assert.match(drawn, /option4\n {2}↓ 5 more/);
  assert.match(drawn, / {2}↑ 2 more\n {2}○ option2/);
  assert.match(drawn, /option6\n {2}↓ 3 more/);
});

test('multiSelect sets groups apart under their headings, and a toggles the highlighted group', async () => {
  const grouped = [
    { label: 'notes', value: 'notes', heading: 'found here' },
    { label: 'tags', value: 'tags' },
    { label: 'links', value: 'links', heading: 'to add' },
    { label: 'pins', value: 'pins' },
  ];
  const all = typing('a', '\r');
  const first = await multiSelect('Which?', grouped, { ...all });
  assert.deepEqual(first.values, ['notes', 'tags']);
  assert.match(all.drawn(), / {2}found here\n❯ ◉ notes\n {2}◉ tags\n\n {2}to add\n {2}○ links/);
  assert.match(all.drawn(), /a group · esc cancel/);
  // In another group, a leaves the first as it was, and again clears its own.
  const second = typing('j', 'j', 'a', 'a', 'a', '\r');
  const kept = await multiSelect('Which?', grouped, { initial: ['notes'], none: true, ...second });
  assert.deepEqual(kept.values, ['notes', 'links', 'pins']);
});

test('keys pressed at a list are not kept as typed text, so redraws stay in place', async () => {
  // Inquirer places the cursor after the text typed so far. Kept, a
  // terminal's width of j's would move every redraw onto the wrong line.
  const { terminal, writes } = typing(...Array.from({ length: 99 }, () => 'j'), '\r');
  await select('Which?', OPTIONS, { terminal });
  const frames = writes().filter(write => write.includes('Which?'));
  // The first option highlighted again after 3 presses and after 99, drawn the same.
  assert.equal(frames.length, 100);
  assert.equal(frames[99], frames[3]);
});

test(
  'a question without a terminal fails instead of waiting for keys',
  { skip: process.stdin.isTTY && process.stderr.isTTY && 'run at a terminal' },
  async () => {
    await assert.rejects(confirm('Go ahead?'), { code: 'no-terminal' });
  }
);

test('input with back goes back on Esc, leaving nothing, and Ctrl+C still cancels', async () => {
  const { terminal, drawn } = typing('A', ESC);
  assert.deepEqual(await input('Path?', { back: true, terminal }), {
    value: '',
    cancelled: false,
    back: true,
  });
  assert.match(drawn(), /esc back/);
  assert.doesNotMatch(drawn(), /Path\? A?\n$/);
  assert.deepEqual(await input('Path?', { back: true, ...typing(CTRL_C) }), {
    value: '',
    cancelled: true,
  });
});

test('input in secret shows a mark for each character, and answers with what was typed', async () => {
  const hidden = typing('a', 'b', 'c', '\r');
  const answer = await input('token', { secret: true, ...hidden });
  assert.deepEqual(answer, { value: 'abc', cancelled: false });
  assert.match(hidden.drawn(), /❯ \*\*\*/);
  assert.doesNotMatch(hidden.drawn(), /abc/);
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
