import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// `node --test` at a terminal sets FORCE_COLOR; these tests read plain text.
delete process.env.FORCE_COLOR;
process.env.NO_COLOR = '1';

const { action, exportSteps, gets, order, stepText, todosFor } =
  await import('../dist/setup/todo.js');
const { splitArgs } = await import('../dist/setup/args.js');
const { Steps } = await import('../dist/setup/steps.js');
const { tokens } = await import('../dist/output/index.js');
const { JobRunner, setupFiles } = await import('../dist/setup/jobs.js');

const EXPORT = [
  { open: 'https://www.goodreads.com/review/import' },
  { do: 'click export library' },
  { wait: 'a few minutes', via: 'download' },
];

test('todos sign in once a provider, walk through an app without a client, and come cheapest first', () => {
  const todos = todosFor([
    { source: 'safari', strategy: 'history', need: 'full-disk-access' },
    {
      source: 'youtube',
      strategy: 'takeout',
      need: 'export',
      steps: [{ wait: '1 day', via: 'email' }],
    },
    { source: 'goodreads', strategy: 'csv', need: 'export', steps: EXPORT },
    { source: 'lastfm', strategy: 'api', need: 'sign-in', provider: 'lastfm', client: false },
    { source: 'gmail', strategy: 'api', need: 'sign-in', provider: 'google', client: true },
    {
      source: 'google-calendar',
      strategy: 'api',
      need: 'sign-in',
      provider: 'google',
      client: true,
    },
  ]);
  const sorted = order(todos);
  assert.deepEqual(
    sorted.map(todo => todo.key),
    [
      'sign-in:google',
      'sign-in:lastfm',
      'setup:goodreads:csv',
      'setup:youtube:takeout',
      'full-disk-access',
    ]
  );
  // One sign-in gets both of Google's sources ready.
  assert.deepEqual(
    sorted[0].ways.map(way => way.source),
    ['gmail', 'google-calendar']
  );
  assert.deepEqual(sorted[0].steps, [{ 'sign-in': 'google' }]);
  // Without a client, the steps make one first, and end signing in.
  assert.deepEqual(
    sorted[1].steps.map(step => Object.keys(step)[0]),
    ['do', 'ask', 'ask', 'sign-in']
  );
  assert.equal(sorted[3].what, 'request export');

  // Put off, a todo goes after those that weren't, the longest ago first.
  const later = order(todos, {
    'sign-in:google': '2026-10-02T00:00:00.000Z',
    'setup:goodreads:csv': '2026-10-01T00:00:00.000Z',
  });
  assert.deepEqual(
    later.slice(-2).map(todo => todo.key),
    ['setup:goodreads:csv', 'sign-in:google']
  );
});

test('a todo says its steps and its button tersely', () => {
  assert.deepEqual(EXPORT.map(stepText), [
    'open goodreads.com/review/import',
    'click export library',
    'wait a few minutes for the download',
  ]);
  assert.equal(stepText({ ask: 'client-id' }), 'paste the client id');
  const [goodreads] = todosFor([
    { source: 'goodreads', strategy: 'csv', need: 'export', steps: EXPORT },
  ]);
  assert.equal(action(goodreads), 'open');
  const [google] = todosFor([
    { source: 'gmail', strategy: 'api', need: 'sign-in', provider: 'google', client: true },
  ]);
  assert.equal(action(google), 'sign in');

  // An export with no steps of its plugin's gets plain ones. One asked for
  // before has its steps done, and asks for its path.
  assert.deepEqual(exportSteps('slack').map(stepText), [
    'request your data from slack',
    'wait until it comes',
  ]);
  const [asked] = todosFor([
    {
      source: 'twitter',
      strategy: 'archive',
      need: 'export',
      steps: [],
      requested: '2026-10-28T00:00:00.000Z',
    },
  ]);
  assert.equal(asked.what, 'requested 2026-10-28');
  assert.equal(action(asked), 'give path');
});

test('setup takes sources by name and folders by path, and says what each way in gets', () => {
  const known = ['spotify', 'goodreads'];
  assert.deepEqual(splitArgs(['spotify', '~/Downloads', 'my_spotify_data.zip', 'spotfy'], known), {
    folders: ['~/Downloads', 'my_spotify_data.zip'],
    sources: ['spotify'],
    unknown: ['spotfy'],
  });
  // A bare word is a source, never a folder of that name here: `./spotify` is.
  assert.deepEqual(splitArgs(['./spotify'], known).folders, ['./spotify']);

  assert.equal(
    gets({ summary: 'full listening history', recordTypes: ['listens'] }),
    'full listening history'
  );
  assert.equal(gets({ recordTypes: ['playlist-items', 'likes'] }), 'playlist items, likes');
});

test('the checklist says each step, where it is, and a note', () => {
  const steps = new Steps();
  steps.set('scan', 'done', '21 of 23');
  steps.set('add', 'asking');
  assert.deepEqual(steps.lines(tokens({ stream: 'stderr' }), 80), [
    ' ✓ scan      21 of 23',
    ' ● add',
    ' · extract',
    ' · todo',
  ]);
  assert.equal(steps.working(), false);
  steps.set('extract', 'working', '12/40');
  assert.equal(steps.working(), true);
});

const ACCOUNT = { source: 'spotify', flags: { strategy: 'api', type: ['listens'] } };

/** A folder of extracts, deleted once `body` is through. */
function inFolder(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'chronicle-setup-test-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Write what a finished job leaves: its records, and its target beside them. */
function extracted(root, name, target) {
  writeFileSync(path.join(root, `${name}.jsonl`), '{}\n');
  writeFileSync(path.join(root, `${name}.target.json`), JSON.stringify({ ...target, records: 1 }));
}

test('setup reset deletes only the files setup wrote', () => {
  inFolder(root => {
    extracted(root, 'spotify', ACCOUNT);
    writeFileSync(path.join(root, 'spotify.jsonl.partial'), '');
    // A pick stopped partway leaves only its partial file.
    writeFileSync(path.join(root, 'goodreads.jsonl.partial'), '');
    // Files of the person's own, named alike.
    writeFileSync(path.join(root, 'notes.jsonl'), '{}\n');
    writeFileSync(path.join(root, 'other.jsonl.partial'), '');

    const goodreads = { source: 'goodreads', flags: { strategy: 'csv', type: ['books'] } };
    const files = setupFiles(root, [ACCOUNT, goodreads]).map(file => path.basename(file));
    assert.deepEqual(files.sort(), [
      'goodreads.jsonl.partial',
      'spotify.jsonl',
      'spotify.jsonl.partial',
      'spotify.target.json',
    ]);
  });
});

test('a job writes its records to its stdout, whatever output is set by default', () => {
  const args = JobRunner.prototype.args.call(
    { options: { since: '2025-10-29T00:00:00.000Z' } },
    { target: ACCOUNT }
  );
  assert.deepEqual(args.slice(args.indexOf('--output'), args.indexOf('--output') + 2), [
    '--output',
    'stdout',
  ]);
});
