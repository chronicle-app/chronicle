import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The library's local user key and zotero.org user id. */
export const LOCAL_USER_KEY = 'LuK3xAmp';
export const USER_ID = '7654321';

/** The database file's mtime, which is the "as of" time of every snapshot record. */
export const DB_MTIME = new Date('2025-06-01T00:00:00.000Z');

/** Unix seconds for 2025-03-01T12:00:00Z and 2025-03-02T12:00:00Z. */
export const READ_1 = 1_740_830_400;
export const READ_2 = 1_740_916_800;

const FIELDS = [
  'title',
  'abstractNote',
  'date',
  'url',
  'DOI',
  'ISBN',
  'ISSN',
  'publicationTitle',
  'publisher',
  'numPages',
  'extra',
  'series',
  'bookTitle',
  'archiveID',
  'repository',
];
const ITEM_TYPES = [
  'journalArticle',
  'book',
  'bookSection',
  'preprint',
  'attachment',
  'annotation',
  'note',
];
const CREATOR_TYPES = ['author', 'editor', 'seriesEditor'];

/**
 * A synthetic Zotero data directory: `zotero.sqlite` with only the tables the
 * extractor reads, plus a few files under `storage/`. Returns the directory.
 */
export function writeZoteroFixture(dir) {
  const storage = (key, name, content) => {
    mkdirSync(join(dir, 'storage', key), { recursive: true });
    writeFileSync(join(dir, 'storage', key, name), content);
  };
  storage('ATTPDF01', 'erosion.pdf', 'PDF-A');
  // Two different works carry a file with the same bytes.
  storage('BOOKATT1', 'collected.pdf', 'SHARED');
  storage('SECATT01', 'chapter.pdf', 'SHARED');

  const dbPath = join(dir, 'zotero.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE settings (setting TEXT, key TEXT, value);
    CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT);
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, libraryID INTEGER,
      key TEXT, dateAdded TEXT, dateModified TEXT);
    CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
    CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT,
      fieldMode INTEGER);
    CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
    CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER,
      orderIndex INTEGER);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER, type INTEGER);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT,
      parentCollectionID INTEGER, libraryID INTEGER, key TEXT);
    CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
    CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INTEGER,
      linkMode INTEGER, contentType TEXT, path TEXT, lastRead INTEGER);
    CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, type INTEGER,
      authorName TEXT, text TEXT, comment TEXT, color TEXT, pageLabel TEXT, sortIndex TEXT,
      position TEXT, isExternal INTEGER);
    CREATE TABLE itemNotes (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, note TEXT,
      title TEXT);
  `);

  const run = (sql, ...params) => db.prepare(sql).run(...params);
  run(`INSERT INTO settings VALUES ('account', 'localUserKey', ?)`, LOCAL_USER_KEY);
  run(`INSERT INTO settings VALUES ('account', 'userID', ?)`, Number(USER_ID));
  run(`INSERT INTO libraries VALUES (1, 'user'), (2, 'group')`);
  for (const [i, name] of ITEM_TYPES.entries())
    run(`INSERT INTO itemTypes VALUES (?, ?)`, i + 1, name);
  for (const [i, name] of FIELDS.entries()) run(`INSERT INTO fields VALUES (?, ?)`, i + 1, name);
  for (const [i, name] of CREATOR_TYPES.entries()) {
    run(`INSERT INTO creatorTypes VALUES (?, ?)`, i + 1, name);
  }

  let valueID = 0;
  const item = (itemID, type, key, dateAdded, dateModified, fields = {}, libraryID = 1) => {
    run(
      `INSERT INTO items VALUES (?, ?, ?, ?, ?, ?)`,
      itemID,
      ITEM_TYPES.indexOf(type) + 1,
      libraryID,
      key,
      dateAdded,
      dateModified
    );
    for (const [name, value] of Object.entries(fields)) {
      valueID++;
      run(`INSERT INTO itemDataValues VALUES (?, ?)`, valueID, value);
      run(`INSERT INTO itemData VALUES (?, ?, ?)`, itemID, FIELDS.indexOf(name) + 1, valueID);
    }
  };
  const attachment = (itemID, parentItemID, linkMode, contentType, path, lastRead = null) =>
    run(
      `INSERT INTO itemAttachments VALUES (?, ?, ?, ?, ?, ?)`,
      itemID,
      parentItemID,
      linkMode,
      contentType,
      path,
      lastRead
    );

  // A journal article with every kind of field the transformer maps.
  item(1, 'journalArticle', 'WORKAAAA', '2025-01-10 08:00:00', '2025-02-01 09:00:00', {
    title: 'Trail Erosion in Alpine Meadows',
    abstractNote: 'How foot traffic wears down alpine trails.',
    date: '2024-07-00 7/2024',
    url: 'https://journal.example.org/erosion',
    DOI: 'https://doi.org/10.5555/TRAILS.2024',
    ISSN: '1234-5678, 8765-4321',
    publicationTitle: 'Journal of Trails',
    extra: 'arXiv: 2401.01234 [cs.CL]\nPMID: 12345678\nPMCID: PMC7654321',
  });
  run(
    `INSERT INTO creators VALUES (1, 'Pat', 'Example', 0), (2, NULL, 'Trail Institute', 1),
       (3, 'Alex', 'Example', 0), (4, 'Sam', 'Series', 0)`
  );
  run(`INSERT INTO itemCreators VALUES (1, 4, 3, 3), (1, 3, 2, 2), (1, 1, 1, 0), (1, 2, 1, 1)`);
  run(`INSERT INTO tags VALUES (1, 'hiking'), (2, 'guides')`);
  run(`INSERT INTO itemTags VALUES (1, 1, 0)`);
  run(
    `INSERT INTO collections VALUES (1, 'Research', NULL, 1, 'COLLROOT'),
       (2, 'Fieldwork', 1, 1, 'COLLCHLD'), (3, 'Group Shelf', NULL, 2, 'COLLGRP1')`
  );
  run(`INSERT INTO collectionItems VALUES (2, 1)`);
  // Its PDF, opened in the reader; its web snapshot, never opened.
  item(2, 'attachment', 'ATTPDF01', '2025-01-10 08:01:00', '2025-01-10 08:01:00', {
    title: 'Full Text PDF',
  });
  attachment(2, 1, 0, 'application/pdf', 'storage:erosion.pdf', READ_1);
  item(3, 'attachment', 'ATTSNAP1', '2025-01-10 08:02:00', '2025-01-10 08:02:00', {
    title: 'Snapshot',
    url: 'https://journal.example.org/erosion',
  });
  attachment(3, 1, 1, 'text/html', 'storage:erosion.html');

  // A book and one of its chapters, each with a copy of the same file.
  item(10, 'book', 'BOOKAAAA', '2024-11-05 10:00:00', '2024-11-05 10:00:00', {
    title: 'Collected Trails',
    ISBN: '0-306-40615-2',
    numPages: '320',
    publisher: 'Example Press',
    date: '2019',
  });
  item(11, 'attachment', 'BOOKATT1', '2024-11-05 10:01:00', '2024-11-05 10:01:00');
  attachment(11, 10, 0, 'application/pdf', 'storage:collected.pdf', READ_2);
  item(12, 'bookSection', 'SECTION1', '2024-11-06 10:00:00', '2024-11-06 10:00:00', {
    title: 'The Ridge Route',
    bookTitle: 'Collected Trails',
    ISBN: '9780306406157',
  });
  item(13, 'attachment', 'SECATT01', '2024-11-06 10:01:00', '2024-11-06 10:01:00');
  attachment(13, 12, 0, 'application/pdf', 'storage:chapter.pdf');

  // Highlights and notes made in the reader on the article's PDF.
  const annotation = (itemID, parent, type, text, comment, pageLabel, position) =>
    run(
      `INSERT INTO itemAnnotations VALUES (?, ?, ?, NULL, ?, ?, '#ffd400', ?, '00011|000100|00200', ?, 0)`,
      itemID,
      parent,
      type,
      text,
      comment,
      pageLabel,
      position
    );
  item(20, 'annotation', 'ANNOPDF1', '2025-01-11 09:00:00', '2025-01-11 09:00:00');
  annotation(
    20,
    2,
    1,
    'Erosion doubles on wet days.',
    'Check the 2023 data.',
    '12',
    '{"pageIndex":11,"rects":[[1,2,3,4]]}'
  );
  item(21, 'annotation', 'ANNONOTE', '2025-01-11 09:05:00', '2025-01-11 09:05:00');
  annotation(21, 2, 2, null, 'Compare with the ridge study.', '13', '{"pageIndex":12}');
  // An image annotation has no text or comment, so it produces nothing.
  item(22, 'annotation', 'ANNOIMG1', '2025-01-11 09:10:00', '2025-01-11 09:10:00');
  annotation(22, 2, 3, null, null, '14', '{"pageIndex":13}');

  // A standalone EPUB with no parent work, highlighted once.
  item(30, 'attachment', 'ORPHAN01', '2025-01-20 12:00:00', '2025-01-21 12:00:00', {
    title: 'EPUB',
  });
  attachment(30, null, 0, 'application/epub+zip', 'storage:field-guide.epub', READ_1);
  run(`INSERT INTO itemTags VALUES (30, 2, 1)`);
  run(`INSERT INTO collectionItems VALUES (1, 30)`);
  item(31, 'annotation', 'ANNOEPUB', '2025-01-22 07:30:00', '2025-01-22 07:30:00');
  annotation(
    31,
    30,
    5,
    'Carry more water than you think.',
    null,
    null,
    '{"type":"FragmentSelector","value":"epubcfi(/6/4!/4/2/1:0)"}'
  );

  // A note on the article, and a standalone note.
  item(40, 'note', 'NOTE0001', '2025-01-12 18:00:00', '2025-01-12 18:30:00');
  run(
    `INSERT INTO itemNotes VALUES (40, 1, ?, 'Reading notes')`,
    '<div data-schema-version="9"><p>Reading notes</p><p>Useful for the talk.</p></div>'
  );
  item(41, 'note', 'NOTE0002', '2025-01-13 18:00:00', '2025-01-13 18:00:00');
  run(`INSERT INTO itemNotes VALUES (41, NULL, '<p>Buy a new map.</p>', NULL)`);

  // Trashed items, and anything under them, are left out.
  item(50, 'book', 'TRASHED1', '2025-01-01 00:00:00', '2025-01-01 00:00:00', { title: 'Old' });
  item(51, 'note', 'TRASHNOT', '2025-01-01 00:00:00', '2025-01-01 00:00:00');
  run(`INSERT INTO itemNotes VALUES (51, 50, '<p>Gone</p>', 'Gone')`);
  run(`INSERT INTO deletedItems VALUES (50)`);
  // Group libraries are out of scope.
  item(60, 'book', 'GROUPWRK', '2025-01-01 00:00:00', '2025-01-01 00:00:00', {}, 2);

  db.close();
  utimesSync(dbPath, DB_MTIME, DB_MTIME);
  return dir;
}
