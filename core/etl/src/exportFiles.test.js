import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { openExport, writeZip } from '../dist/index.js';

// An export's files: JSON with a byte order mark, as Google writes it, and a
// file large enough to arrive in many chunks.
const BIG = 'From sam@example.com Thu Jan 1 00:00:00 2025\n'.repeat(50_000);
const FILES = {
  'Takeout/YouTube/history.json': '﻿[{"title":"Watched a video"}]',
  'Takeout/YouTube/watch.html': '<html><body>Watch history</body></html>',
  'Takeout/Mail/All mail.mbox': BIG,
};

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'export-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFolder(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** The same export as a folder, a zip, a split Takeout by one part, and a folder of its parts. */
function exportsOf(t) {
  const dir = scratch(t);
  const folder = writeFolder(join(dir, 'folder'), FILES);
  const zip = join(dir, 'export.zip');
  writeZip(zip, FILES);

  const parts = join(dir, 'parts');
  mkdirSync(parts);
  const [first, second, third] = Object.keys(FILES);
  writeZip(join(parts, 'takeout-20250101T000000Z-001.zip'), {
    [first]: FILES[first],
    [second]: FILES[second],
  });
  writeZip(join(parts, 'takeout-20250101T000000Z-002.zip'), { [third]: FILES[third] });
  writeFileSync(join(parts, '.DS_Store'), '');

  // A different Takeout's part beside the first isn't part of it.
  const mixed = join(dir, 'mixed');
  mkdirSync(mixed);
  writeZip(join(mixed, 'takeout-20250101T000000Z-001.zip'), { [first]: FILES[first] });
  writeZip(join(mixed, 'takeout-20250101T000000Z-002.zip'), { [second]: FILES[second] });
  writeZip(join(mixed, 'takeout-20240601T000000Z-001.zip'), { 'Takeout/Other/old.json': '{}' });

  return {
    folder,
    zip,
    part: join(parts, 'takeout-20250101T000000Z-002.zip'),
    parts,
    mixed: join(mixed, 'takeout-20250101T000000Z-001.zip'),
  };
}

test('an export reads the same from a folder, a zip, or a split Takeout', async t => {
  const { mixed, ...inputs } = exportsOf(t);
  for (const [kind, input] of Object.entries(inputs)) {
    const files = await openExport(input);
    try {
      assert.deepEqual(await files.list(), Object.keys(FILES).sort(), kind);
      assert.deepEqual(
        await files.list('Takeout/YouTube/'),
        ['Takeout/YouTube/history.json', 'Takeout/YouTube/watch.html'],
        kind
      );
      assert.equal(await files.find('watch.html'), 'Takeout/YouTube/watch.html', kind);
      assert.equal(await files.find('missing.json'), null, kind);
      assert.equal(await files.has('./Takeout/YouTube/watch.html'), true, kind);
      assert.deepEqual(await files.readJson('Takeout/YouTube/history.json'), [
        { title: 'Watched a video' },
      ]);

      // A large file streams in pieces and arrives whole.
      let chunks = 0;
      let text = '';
      for await (const chunk of await files.open('Takeout/Mail/All mail.mbox')) {
        chunks++;
        text += chunk.toString();
      }
      assert.ok(chunks > 1, kind);
      assert.equal(text, BIG, kind);

      await assert.rejects(files.open('Takeout/nothing.txt'), { code: 'input-not-found' });
    } finally {
      await files.close();
    }
  }

  // A folder reads the same however it's written: `./export`, or `export/` as tab completion has it.
  const near = relative(process.cwd(), inputs.folder);
  for (const written of [`./${near}`, `${near}/`]) {
    const files = await openExport(written);
    try {
      assert.deepEqual(await files.list(), Object.keys(FILES).sort(), written);
    } finally {
      await files.close();
    }
  }

  const files = await openExport(mixed);
  t.after(() => files.close());
  assert.deepEqual(await files.list(), [
    'Takeout/YouTube/history.json',
    'Takeout/YouTube/watch.html',
  ]);
});

test('a path that isn’t an export fails with a hint', async t => {
  const dir = scratch(t);
  const text = join(dir, 'notes.txt');
  writeFileSync(text, 'not an export');
  const broken = join(dir, 'broken.zip');
  writeFileSync(broken, 'not a zip');

  for (const input of [join(dir, 'missing'), text, broken]) {
    await assert.rejects(openExport(input), error => {
      assert.equal(error.code, 'input-not-found', input);
      return true;
    });
  }
  await assert.rejects(openExport(broken), error => /--input/.test(error.hint));
});
