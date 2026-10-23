import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  checkConditions,
  evaluate,
  findExports,
  findExportsIn,
  openExport,
  writeZip,
} from '../dist/index.js';

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

test('an export lists a folder, and gives a reader outside it a file on disk', async t => {
  const dir = exportFiles(t);
  const folder = await openExport(join(dir, 'twitter-2022-11-04'));
  t.after(() => folder.close());
  assert.deepEqual(await folder.children(''), ['assets/', 'data/']);
  assert.deepEqual(await folder.children('data/'), ['account.js', 'tweets.js']);
  assert.deepEqual(await folder.children('nothing'), []);
  // In a folder, the file itself.
  assert.equal(
    await folder.localPath('data/tweets.js'),
    join(dir, 'twitter-2022-11-04', 'data', 'tweets.js')
  );

  const zip = await openExport(join(dir, 'takeout-20250101T000000Z-001.zip'));
  assert.deepEqual(await zip.children('Takeout'), ['Mail/', 'YouTube and YouTube Music/']);
  // In a zip, a copy, until the export is closed.
  const copy = await zip.localPath('Takeout/YouTube and YouTube Music/history/watch-history.html');
  assert.equal(readFileSync(copy, 'utf8'), '<html/>');
  assert.equal(await zip.localPath('Takeout/missing.html'), null);
  await zip.close();
  assert.equal(existsSync(copy), false);

  // A reader names its export in the message for one that isn't there.
  await assert.rejects(openExport(join(dir, 'gone'), 'Twitter archive'), {
    message: 'No Twitter archive found',
  });
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

const SAFARI = {
  source: 'safari',
  strategy: 'app-db',
  layouts: [],
  files: [
    {
      names: ['History.db'],
      match: [{ sqlite: { tables: ['history_items', 'history_visits'] } }],
      requires: [
        {
          sqlite: {
            columns: { history_items: ['id', 'url'], history_visits: ['id', 'visit_time'] },
          },
        },
      ],
    },
  ],
};

function database(path, sql, { wal = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (wal) db.exec('PRAGMA journal_mode = WAL');
  db.exec(sql);
  db.close();
}

const HISTORY =
  'CREATE TABLE history_items (id, url); CREATE TABLE history_visits (id, visit_time, origin);';

test('a database is found by its schema, and read without writing beside it', async t => {
  const dir = join(scratch(t), 'data');
  database(join(dir, 'safari/History.db'), HISTORY, { wal: true });
  // Without a column it does without, it's still read; without one it needs, it's a version it can't read.
  database(join(dir, 'safari/2026-08-06/History.db'), HISTORY.replace(', origin', ''));
  database(join(dir, 'safari/2019/History.db'), HISTORY.replace(', visit_time', ''));
  // Named otherwise, the walk doesn't open it; with only one of its tables, it isn't one.
  database(join(dir, 'safari/History copy.db'), HISTORY);
  database(join(dir, 'other/History.db'), 'CREATE TABLE history_items (id, url);');
  plant(dir, {
    'notes/History.db': 'not a database',
    'safari/encrypted/History.db': `SQLite format 3\0${'x'.repeat(200)}`,
  });
  const before = readdirSync(dir, { recursive: true }).sort();

  const found = await findExports(dir, [SAFARI]);
  assert.deepEqual(
    found.exports.map(e => [e.root.slice(dir.length + 1), e.file, e.matches[0].unmet]),
    [
      ['safari/2019/History.db', true, ['history_visits.visit_time']],
      ['safari/2026-08-06/History.db', true, undefined],
      ['safari/History.db', true, undefined],
    ]
  );
  assert.deepEqual(found.refused, [
    { path: join(dir, 'safari/encrypted/History.db'), code: 'EDB' },
  ]);
  assert.deepEqual(found.unrecognized, ['notes', 'other']);
  // Not even a -shm beside the one in WAL mode.
  assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), before);

  // Passed as the path, a database is opened whatever its name.
  const copy = await findExports(join(dir, 'safari/History copy.db'), [SAFARI]);
  assert.deepEqual(
    copy.exports.map(e => e.root),
    [join(dir, 'safari/History copy.db')]
  );
  const notOne = await findExports(join(dir, 'notes/History.db'), [SAFARI]);
  assert.deepEqual(notOne.unrecognized, ['History.db']);
});

const GOODREADS = {
  source: 'goodreads',
  strategy: 'csv',
  layouts: [],
  files: [
    {
      names: ['*.csv'],
      match: [{ csv: ['Book Id', 'Title', 'Author'] }],
      requires: [{ csv: ['Exclusive Shelf'] }],
    },
  ],
};
const MARVIN = {
  source: 'marvin',
  strategy: 'csv',
  layouts: [],
  files: [
    { names: ['*.csv'], recordTypes: ['annotations'], match: [{ csv: ['ID', 'HighlightText'] }] },
    {
      names: ['*.csv'],
      recordTypes: ['reading-sessions'],
      match: [{ csv: ['Session ID', 'Part Time'] }],
    },
  ],
};
const EMAIL = {
  source: 'email',
  strategy: 'mbox',
  layouts: [],
  files: [{ names: ['*.mbox'], match: [{ head: '^From ' }] }],
};
const GMAIL = {
  source: 'gmail',
  strategy: 'takeout',
  layouts: [],
  files: [{ names: ['*.mbox'], match: [{ headers: ['X-GM-THRID'] }] }],
};
const HEALTH_BY_HEAD = {
  source: 'apple-health',
  strategy: 'archive',
  layouts: [
    {
      files: ['export.xml'],
      name: 'HealthKit {version}',
      match: [
        {
          path: 'export.xml',
          head: '<(?:!DOCTYPE )?HealthData\\b(?:[\\s\\S]{0,200}?HealthKit Export Version: (?<version>\\d+))?',
        },
      ],
      requires: [{ path: 'export.xml', not: { head: 'HealthKit Export Version: [1-9]\\b' } }],
    },
  ],
};

const DOCTYPE =
  '<?xml version="1.0"?>\n<!DOCTYPE HealthData [\n<!-- HealthKit Export Version: 14 -->\n';
const GMAIL_MBOX =
  'From 1@xxx Wed Jun 22 19:27:30 +0000 2016\nX-GM-THRID: 1\nX-Gmail-Labels: Inbox\nSubject: hi\n\nbody\n';

test('a layout says how its files start, captures from them, and what its reader needs', async t => {
  const dir = plant(scratch(t), {
    'health/export.xml': `${DOCTYPE}<HealthData/>`,
    'old-health/export.xml': '<!DOCTYPE HealthData [\n<!-- HealthKit Export Version: 9 -->\n',
    'not-health/export.xml': '<Export/>',
  });
  writeZip(join(dir, 'export.zip'), {
    'apple_health_export/export.xml': `${DOCTYPE}<HealthData/>`,
  });
  const found = await findExports(dir, [HEALTH_BY_HEAD]);
  assert.deepEqual(
    found.exports.map(e => [e.root.slice(dir.length + 1), e.matches[0].name, e.matches[0].unmet]),
    [
      // Inside a zip, a file's start is read from its entry.
      ['export.zip/apple_health_export', 'HealthKit 14', undefined],
      ['health', 'HealthKit 14', undefined],
      ['old-health', 'HealthKit 9', [`not {"head":"HealthKit Export Version: [1-9]\\\\b"}`]],
    ]
  );
  // An export.xml that isn't Health's is no export.
  assert.deepEqual(found.unrecognized, ['not-health']);

  // Without a way to read a file, a condition that would read one doesn't hold.
  const listed = await findExportsIn(['health/export.xml'], [HEALTH_BY_HEAD]);
  assert.deepEqual(listed.exports, []);
  const read = await findExportsIn(['health/export.xml'], [HEALTH_BY_HEAD], {
    head: async () => DOCTYPE,
  });
  assert.deepEqual(
    read.exports.map(e => e.root),
    ['health']
  );
});

test('a file is found by its format: CSV columns, an mbox and its headers', async t => {
  const dir = plant(join(scratch(t), 'data'), {
    'csv/goodreads_library_export.csv': 'Book Id,Title,Author,Exclusive Shelf\n1,"A, B",C,read\n',
    'csv/goodreads-old.csv': 'Book Id,Title,Author\n1,A,C\n',
    'csv/residences.csv': 'Place,From,To\n',
    'marvin/Journal.csv': '﻿ID,Type,Title,HighlightText\n"x",1,T,H\n',
    'marvin/Reading Sessions.csv': 'Session ID, Part ID, Part Time\n"a","b","1"\n',
    'email/All mail.mbox': GMAIL_MBOX,
    'email/sample.mbox': 'From someone Mon Jan 1 00:00:00 2024\nSubject: hi\n\nbody\n',
    // A CSV's columns, under another extension, aren't opened in a walk.
    'email/notes.txt': 'Book Id,Title,Author\n',
  });
  const sets = [GOODREADS, MARVIN, EMAIL, GMAIL];
  const found = await findExports(dir, sets);
  const rows = found.exports.flatMap(e =>
    e.matches.map(m => [e.root.slice(dir.length + 1), m.source, m.recordTypes?.join(','), m.unmet])
  );
  assert.deepEqual(rows, [
    ['csv/goodreads-old.csv', 'goodreads', undefined, ['the file has no Exclusive Shelf column']],
    ['csv/goodreads_library_export.csv', 'goodreads', undefined, undefined],
    // Gmail's mbox is an mbox too, so both read it.
    ['email/All mail.mbox', 'email', undefined, undefined],
    ['email/All mail.mbox', 'gmail', undefined, undefined],
    ['email/sample.mbox', 'email', undefined, undefined],
    ['marvin/Journal.csv', 'marvin', 'annotations', undefined],
    ['marvin/Reading Sessions.csv', 'marvin', 'reading-sessions', undefined],
  ]);

  // Passed as the path, a file is checked whatever its name.
  const direct = await findExports(join(dir, 'email/notes.txt'), sets);
  assert.deepEqual(
    direct.exports.map(e => e.matches[0].source),
    ['goodreads']
  );
});

test('conditions combine, and a manifest’s are checked before they run', async () => {
  const subject = {
    name: 'x.mbox',
    locate: async () => null,
    head: async () => ({ text: GMAIL_MBOX, more: false }),
    columns: async () => null,
  };
  const holds = async conditions => (await evaluate(conditions, subject)).holds;
  assert.equal(await holds([{ name: '*.mbox', headers: ['x-gm-thrid', 'Subject'] }]), true);
  assert.equal(await holds([{ any: [{ head: '^Nope' }, { head: '^From (?<id>\\d+)' }] }]), true);
  assert.deepEqual((await evaluate([{ head: '^From (?<id>\\d+)@' }], subject)).captures, {
    id: '1',
  });
  assert.equal(await holds([{ not: { headers: ['X-GM-THRID'] } }]), false);
  assert.equal(await holds([{ csv: ['From'] }]), false);
  assert.equal(await holds([{ sqlite: { tables: ['t'] } }]), false);
  assert.throws(() => checkConditions([{ heed: 'x' }]), /no condition heed/);
  assert.throws(() => checkConditions([{ head: '(' }]), /Invalid regular expression/);
  assert.throws(() => checkConditions([{}]), /empty condition/);
});
