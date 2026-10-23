import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findExports, findExportsIn, openExport, writeZip } from '../dist/index.js';

const SETS = [
  {
    source: 'twitter',
    strategy: 'archive',
    layouts: [{ files: ['data/account.js', 'data/tweets.js'] }],
  },
  {
    source: 'instagram',
    strategy: 'archive',
    layouts: [
      {
        files: [
          'personal_information/personal_information/personal_information.json',
          'your_instagram_activity/media/posts.json',
        ],
      },
      { name: '2019', files: ['profile.json', 'media.json'], supported: false },
    ],
  },
  {
    source: 'apple-health',
    strategy: 'archive',
    layouts: [{ files: ['export.xml', 'export_cda.xml'] }],
  },
  {
    source: 'youtube',
    strategy: 'takeout',
    layouts: [{ files: ['YouTube and YouTube Music/history/watch-history.html'] }],
  },
  { source: 'gmail', strategy: 'takeout', layouts: [{ files: ['Mail/{mailbox}.mbox'] }] },
];

const TWITTER = { 'data/account.js': '[]', 'data/tweets.js': '[]', 'assets/app.js': '' };
const INSTAGRAM = {
  'personal_information/personal_information/personal_information.json': '{}',
  'your_instagram_activity/media/posts.json': '[]',
  'media/posts/202401/photo.jpg': '',
};
const HEALTH = {
  'apple_health_export/export.xml': '<HealthData/>',
  'apple_health_export/export_cda.xml': '<ClinicalDocument/>',
};

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'layouts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function plant(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const under = (prefix, files) =>
  Object.fromEntries(
    Object.entries(files).map(([path, content]) => [`${prefix}/${path}`, content])
  );

/** A folder of exports, kept the ways people keep them, beside things that aren't any. */
function exportFiles(t) {
  const dir = join(scratch(t), 'EXPORT_FILES');
  plant(dir, {
    ...under('twitter-2022-11-04', TWITTER),
    ...under('old/laptop/twitter-2019', TWITTER),
    ...under('instagram-andrew', INSTAGRAM),
    ...under('instagram-2019', { 'profile.json': '{}', 'media.json': '{}' }),
    ...under('Photos Library.photoslibrary/resources/twitter', TWITTER),
    ...under('.trash/twitter', TWITTER),
    'misc/notes.txt': 'not an export',
    'loose.txt': 'not a folder',
  });
  writeZip(join(dir, 'instagram-2024.zip'), INSTAGRAM);
  writeZip(join(dir, 'export.zip'), HEALTH);
  writeZip(join(dir, 'takeout-20250101T000000Z-001.zip'), {
    'Takeout/YouTube and YouTube Music/history/watch-history.html': '<html/>',
  });
  writeZip(join(dir, 'takeout-20250101T000000Z-002.zip'), {
    'Takeout/Mail/All mail Including Spam and Trash.mbox': 'From x',
  });
  writeZip(join(dir, 'photos.zip'), { 'IMG_0001.jpg': '' });
  writeFileSync(join(dir, 'broken.zip'), 'not a zip');
  symlinkSync(dir, join(dir, 'loop'));
  return dir;
}

test('a layout matches where its export starts, not the folder holding it', async t => {
  const dir = plant(scratch(t), under('archive', TWITTER));
  const { exports } = await findExports(dir, SETS);
  assert.deepEqual(
    exports.map(e => [e.root, e.matches.map(m => m.source)]),
    [[join(dir, 'archive'), ['twitter']]]
  );
  assert.deepEqual(exports[0].matches[0].files, ['data/account.js', 'data/tweets.js']);

  // The export itself, passed as the path, is found at the path.
  const [itself] = (await findExports(join(dir, 'archive'), SETS)).exports;
  assert.equal(itself.root, join(dir, 'archive'));
});

test('a folder of exports: each found once, where it starts, and what is not one', async t => {
  const dir = exportFiles(t);
  const seen = [];
  const found = await findExports(dir, SETS, { onFolder: looked => seen.push(looked) });
  const roots = found.exports.map(e => [
    e.root.slice(dir.length + 1),
    e.matches.map(m => `${m.source}${m.layout.supported === false ? ' (unsupported)' : ''}`),
  ]);
  assert.deepEqual(roots, [
    ['export.zip/apple_health_export', ['apple-health']],
    ['instagram-2019', ['instagram (unsupported)']],
    ['instagram-2024.zip', ['instagram']],
    ['instagram-andrew', ['instagram']],
    ['old/laptop/twitter-2019', ['twitter']],
    // A split Takeout is one export, which both its products' sources read.
    ['takeout-20250101T000000Z-001.zip/Takeout', ['youtube', 'gmail']],
    ['twitter-2022-11-04', ['twitter']],
  ]);
  const takeout = found.exports.find(e => e.root.includes('takeout'));
  assert.equal(takeout.parts.length, 2);
  assert.deepEqual(takeout.matches[1].options, { mailbox: 'All mail Including Spam and Trash' });

  // Folders and zips with no export in them; not loose files, hidden folders, or links.
  assert.deepEqual(found.unrecognized, ['Photos Library.photoslibrary', 'misc', 'photos.zip']);
  assert.deepEqual(found.refused, [{ path: join(dir, 'broken.zip'), code: 'EZIP' }]);
  assert.equal(seen.at(-1), found.looked);
});

test('a zip or a file passed as the path, and a walk that stops at its depth', async t => {
  const dir = exportFiles(t);
  const zip = await findExports(join(dir, 'export.zip'), SETS);
  assert.deepEqual(
    zip.exports.map(e => e.root),
    [join(dir, 'export.zip/apple_health_export')]
  );
  const notOne = await findExports(join(dir, 'photos.zip'), SETS);
  assert.deepEqual(notOne.unrecognized, ['photos.zip']);

  const shallow = await findExports(dir, SETS, { depth: 1 });
  assert.ok(!shallow.exports.some(e => e.root.endsWith('twitter-2019')));

  // A file is found in the export it's in, however deep.
  const inside = await findExports(join(dir, 'old/laptop/twitter-2019/assets/app.js'), SETS);
  assert.deepEqual(
    inside.exports.map(e => e.root),
    [join(dir, 'old/laptop/twitter-2019')]
  );
  // So is a folder in one.
  const assets = await findExports(join(dir, 'twitter-2022-11-04/assets'), SETS);
  assert.deepEqual(
    [assets.exports.map(e => e.root), assets.unrecognized],
    [[join(dir, 'twitter-2022-11-04')], []]
  );
  const loose = await findExports(join(dir, 'misc/notes.txt'), SETS);
  assert.deepEqual([loose.exports, loose.unrecognized], [[], ['notes.txt']]);
  await assert.rejects(findExports(join(dir, 'gone'), SETS), { code: 'input-not-found' });
});

test('an export opens by a path through its zip, as the walk names it', async t => {
  const dir = exportFiles(t);
  const files = await openExport(join(dir, 'export.zip/apple_health_export'));
  t.after(() => files.close());
  assert.deepEqual(await files.list(), ['export.xml', 'export_cda.xml']);
  assert.equal(await files.readText('export.xml'), '<HealthData/>');
  // What was opened is the zip, which a reader can stat.
  assert.equal(files.location, join(dir, 'export.zip'));

  // A split Takeout's folder brings in its other parts.
  const takeout = await openExport(join(dir, 'takeout-20250101T000000Z-002.zip/Takeout'));
  t.after(() => takeout.close());
  assert.equal((await takeout.list()).length, 2);

  await assert.rejects(openExport(join(dir, 'export.zip/nothing-here')), {
    code: 'input-not-found',
  });
  await assert.rejects(openExport(join(dir, 'gone/inside')), { code: 'input-not-found' });
});

test('a list of paths, as a package manifest lists them, without a disk', async () => {
  const paths = [
    ...Object.keys(under('data/instagram-2024', INSTAGRAM)),
    ...Object.keys(under('data/twitter', TWITTER)),
    ...Object.keys(HEALTH).map(path => `data/${path}`),
    'data/scans/receipt.pdf',
  ];
  const found = await findExportsIn(paths, SETS);
  assert.deepEqual(
    found.exports.map(e => [e.root, e.matches[0].source]),
    [
      ['data/apple_health_export', 'apple-health'],
      ['data/instagram-2024', 'instagram'],
      ['data/twitter', 'twitter'],
    ]
  );
  // At its top is only `data`, which holds exports.
  assert.deepEqual(found.unrecognized, []);
  const whole = await findExportsIn(Object.keys(TWITTER), SETS);
  assert.deepEqual(
    whole.exports.map(e => e.root),
    ['']
  );
});
