import { Record, SystemInfo, assertReadable } from '@chronicle.app/etl';
import { SqliteExtractor, timeRangeConditions, iterateRows } from '@chronicle.app/etl-sqlite';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import ZoteroTransformer from './ZoteroTransformer.js';
import type {
  ZoteroAnnotationRecord,
  ZoteroAttachment,
  ZoteroCollection,
  ZoteroCreator,
  ZoteroNoteRecord,
  ZoteroOrphanAttachmentRecord,
  ZoteroTag,
  ZoteroWorkRecord,
  ZoteroWorkRef,
} from './records.js';

interface WorkRow {
  itemID: number;
  key: string;
  dateAdded: string;
  dateModified: string;
  itemType: string;
}

interface AnnotationRow {
  itemID: number;
  key: string;
  dateAdded: string;
  dateModified: string;
  type: number;
  authorName: string | null;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  sortIndex: string;
  position: string;
  isExternal: number;
  attItemID: number;
  attKey: string;
  attDateAdded: string;
  workItemID: number | null;
  attLinkMode: number;
  attContentType: string | null;
  attPath: string | null;
  attLastRead: number | null;
}

interface AttachmentRow {
  itemID: number;
  key: string;
  dateAdded: string;
  dateModified?: string;
  parentItemID: number | null;
  linkMode: number;
  contentType: string | null;
  path: string | null;
  lastRead: number | null;
}

interface NoteRow {
  itemID: number;
  key: string;
  dateAdded: string;
  dateModified: string;
  parentItemID: number | null;
  note: string;
  title: string | null;
}

interface CollectionRow {
  key: string;
  name: string;
  parentCollectionID: number | null;
}

type CollectionMap = Map<number, CollectionRow>;

/** Zotero's UTC `YYYY-MM-DD HH:MM:SS` form, so string comparison against `dateModified` is correct. */
function toSqliteTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function isSqliteBusy(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    // node:sqlite reports the SQLite result code as `errcode` (possibly an
    // extended code, whose low byte is the primary code); 5 is SQLITE_BUSY.
    ((err as { errcode?: number }).errcode ?? 0) % 256 === 5
  );
}

/**
 * A local Zotero library — works (references), the highlights and notes made
 * on their attachments, standalone attachments filed without a parent work,
 * and note items written on a work or standing alone. Reads `zotero.sqlite`
 * directly; the user library only (group libraries are out of scope),
 * excluding anything in the trash.
 */
export class ZoteroExtractor extends SqliteExtractor<typeof ZoteroExtractor> {
  static override source = 'zotero';
  static override description = 'Works, highlights, notes, and reading activity';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['works', 'annotations', 'attachments', 'notes'];

  static override default = true;
  static override defaultTransformer = ZoteroTransformer;
  // Re-reads the library's current state on every run — fields, tags,
  // collections, and creators are all mutable in place — so attributes are
  // sighted at read time rather than back-dated to dateAdded/dateModified.
  // See Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .describe('Path to the Zotero data directory (contains zotero.sqlite and storage/)')
      .default(join(homedir(), 'Zotero')),
  }) as any;

  private dataDir!: string;
  private localUserKey!: string;
  private library!: string;
  private machine!: string;
  private dbMtime!: Date;
  private extractedCount = 0;
  /** Set when Zotero's lock forced a filesystem-level clone; cleaned up in teardown(). */
  private tempDbPath?: string;
  /** Item keys of child attachments whose carrier (path or content hash) is shared with a different parent work; rebuilt per extract() run. */
  private flaggedAttachmentKeys!: Set<string>;

  /**
   * The item's 8-char Zotero key. Every record type (work, annotation,
   * attachment, note) is an `items` row, and the key is unique across all of
   * them within a library — the same field each transformer keyset uses.
   */
  override keyOf(record: Record): string | null {
    return (record.data as { key?: string }).key ?? null;
  }

  override async setup(): Promise<void> {
    const { input } = this.config;
    this.dataDir = input.endsWith('.sqlite') ? dirname(input) : input;
    const dbPath = input.endsWith('.sqlite') ? input : join(this.dataDir, 'zotero.sqlite');

    // From the ORIGINAL file, even when the busy fallback below reads a
    // freshly-made copy instead — the copy's mtime is just "now" and would
    // defeat the byte-identical-on-unchanged-library property of asOfTime().
    assertReadable(dbPath, 'Zotero database');
    this.dbMtime = statSync(dbPath).mtime;

    // Zotero uses journal_mode=delete, so a plain readonly open reads a
    // consistent snapshot without contending with a running Zotero instance.
    // Never opened read-write: the library must never be disturbed.
    this.db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      this.localUserKey = this.readLocalUserKey(dbPath);
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;

      // Zotero holds the database in exclusive locking mode for its entire
      // run, so a readonly open can never read while it's open (the open
      // itself acquires no lock — the first real query is where this
      // surfaces). Fall back to a filesystem-level clone: with
      // journal_mode=delete the file is consistent except during the brief
      // window of an active write, so a clone of the closed-journal db
      // (instant on APFS via COPYFILE_FICLONE, a plain copy elsewhere) is
      // consistent in practice. The clone is disposable, removed in
      // teardown().
      this.db.close();
      this.tempDbPath = join(tmpdir(), `zotero-${randomUUID()}.sqlite`);
      copyFileSync(dbPath, this.tempDbPath, fsConstants.COPYFILE_FICLONE);
      this.db = new DatabaseSync(this.tempDbPath, { readOnly: true });
      this.localUserKey = this.readLocalUserKey(this.tempDbPath);
    }

    // The zotero.org userID is globally stable and identical on every machine
    // syncing this library, so it wins as the scope handle when present; a
    // library that has never synced has no userID, so the install-local
    // localUserKey is the only handle available and becomes the scope.
    this.library = this.readUserID() ?? this.localUserKey;

    this.machine = (await SystemInfo.getInstance()).getMachineName();
  }

  private readLocalUserKey(dbPath: string): string {
    const row = this.db!.prepare(
      `SELECT value FROM settings WHERE setting = 'account' AND key = 'localUserKey'`
    ).get() as { value: string } | undefined;
    if (!row?.value) {
      throw new Error(
        `No settings.account.localUserKey in ${dbPath} — is this a Zotero data directory? (the key exists even without a zotero.org account)`
      );
    }
    return row.value;
  }

  private readUserID(): string | undefined {
    const row = this.db!.prepare(
      `SELECT value FROM settings WHERE setting = 'account' AND key = 'userID'`
    ).get() as { value: string | number } | undefined;
    return row?.value === null || row?.value === undefined ? undefined : String(row.value);
  }

  override async teardown(): Promise<void> {
    await super.teardown();
    if (this.tempDbPath) {
      rmSync(this.tempDbPath, { force: true });
      this.tempDbPath = undefined;
    }
  }

  // The DB file's own mtime, not the run start: an unchanged library re-reads
  // the same "as of" time on every run, so the emitted records are
  // byte-identical and the store's ingest is a no-op; an edited library moves
  // the mtime forward, and every record is genuinely re-sighted then.
  protected override asOfTime(): Date {
    return this.dbMtime;
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    this.extractedCount = 0;
    this.flaggedAttachmentKeys = this.buildFlaggedAttachmentKeys();
    const collections = this.loadCollections();

    yield* this.iterateWorks(collections);
    yield* this.iterateAnnotations();
    yield* this.iterateOrphanAttachments(collections);
    yield* this.iterateNotes();
  }

  /** The since/until window over a `dateModified` column, as ` AND …` terms appended to each stream's WHERE. */
  private sinceUntilFilter(column: string): {
    clause: string;
    params: SQLInputValue[];
  } {
    const { conditions, values } = timeRangeConditions(column, this.config, {
      convert: toSqliteTimestamp,
      sinceOp: '>=',
      untilOp: '<=',
    });
    return {
      clause: conditions.map(c => ` AND ${c}`).join(''),
      params: values,
    };
  }

  private *iterateWorks(collections: CollectionMap): Generator<Record> {
    const { clause, params } = this.sinceUntilFilter('i.dateModified');
    const sql = `
      SELECT i.itemID AS itemID, i.key AS key, i.dateAdded AS dateAdded, i.dateModified AS dateModified,
             it.typeName AS itemType
      FROM items i
      JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
      JOIN libraries l ON l.libraryID = i.libraryID
      WHERE l.type = 'user'
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
        AND it.typeName NOT IN ('attachment', 'annotation', 'note')${clause}
      ORDER BY i.dateModified DESC`;

    for (const row of iterateRows<WorkRow>(this.db!.prepare(sql), ...params)) {
      if (this.shouldStopExtracting(this.extractedCount)) return;

      const data: ZoteroWorkRecord = {
        key: row.key,
        itemType: row.itemType,
        dateAdded: row.dateAdded,
        dateModified: row.dateModified,
        fields: this.loadFields(row.itemID),
        creators: this.loadCreators(row.itemID),
        collections: this.getItemCollections(row.itemID, collections),
        tags: this.loadTags(row.itemID),
        attachments: this.loadWorkAttachments(row.itemID),
      };

      this.extractedCount++;
      yield this.createRecord(data, {
        recordType: 'works',
        localUserKey: this.localUserKey,
        library: this.library,
        machine: this.machine,
      });
    }
  }

  private *iterateAnnotations(): Generator<Record> {
    const { clause, params } = this.sinceUntilFilter('i.dateModified');
    const sql = `
      SELECT i.itemID AS itemID, i.key AS key, i.dateAdded AS dateAdded, i.dateModified AS dateModified,
             a.type AS type, a.authorName AS authorName, a.text AS text, a.comment AS comment,
             a.color AS color, a.pageLabel AS pageLabel, a.sortIndex AS sortIndex, a.position AS position,
             a.isExternal AS isExternal,
             ai.itemID AS attItemID, ai.key AS attKey, ai.dateAdded AS attDateAdded,
             att.parentItemID AS workItemID, att.linkMode AS attLinkMode, att.contentType AS attContentType,
             att.path AS attPath, att.lastRead AS attLastRead
      FROM itemAnnotations a
      JOIN items i ON i.itemID = a.itemID
      JOIN libraries l ON l.libraryID = i.libraryID
      JOIN itemAttachments att ON att.itemID = a.parentItemID
      JOIN items ai ON ai.itemID = att.itemID
      WHERE l.type = 'user'
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
        AND ai.itemID NOT IN (SELECT itemID FROM deletedItems)
        AND (att.parentItemID IS NULL OR att.parentItemID NOT IN (SELECT itemID FROM deletedItems))${clause}
      ORDER BY i.dateModified DESC`;

    for (const row of iterateRows<AnnotationRow>(this.db!.prepare(sql), ...params)) {
      if (this.shouldStopExtracting(this.extractedCount)) return;

      const attachment = this.buildAttachment({
        itemID: row.attItemID,
        key: row.attKey,
        dateAdded: row.attDateAdded,
        parentItemID: row.workItemID,
        linkMode: row.attLinkMode,
        contentType: row.attContentType,
        path: row.attPath,
        lastRead: row.attLastRead,
      });
      const work = this.loadWorkRef(row.workItemID);

      const data: ZoteroAnnotationRecord = {
        key: row.key,
        type: row.type,
        text: row.text,
        comment: row.comment,
        color: row.color,
        pageLabel: row.pageLabel,
        sortIndex: row.sortIndex,
        position: row.position,
        isExternal: row.isExternal,
        authorName: row.authorName,
        dateAdded: row.dateAdded,
        dateModified: row.dateModified,
        attachment,
        ...(work ? { work } : {}),
      };

      this.extractedCount++;
      yield this.createRecord(data, {
        recordType: 'annotations',
        localUserKey: this.localUserKey,
        library: this.library,
        machine: this.machine,
      });
    }
  }

  private *iterateOrphanAttachments(collections: CollectionMap): Generator<Record> {
    const { clause, params } = this.sinceUntilFilter('i.dateModified');
    const sql = `
      SELECT i.itemID AS itemID, i.key AS key, i.dateAdded AS dateAdded, i.dateModified AS dateModified,
             att.parentItemID AS parentItemID, att.linkMode AS linkMode, att.contentType AS contentType,
             att.path AS path, att.lastRead AS lastRead
      FROM itemAttachments att
      JOIN items i ON i.itemID = att.itemID
      JOIN libraries l ON l.libraryID = i.libraryID
      WHERE l.type = 'user'
        AND att.parentItemID IS NULL
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)${clause}
      ORDER BY i.dateModified DESC`;

    for (const row of iterateRows<AttachmentRow>(this.db!.prepare(sql), ...params)) {
      if (this.shouldStopExtracting(this.extractedCount)) return;

      const data: ZoteroOrphanAttachmentRecord = {
        ...this.buildAttachment(row),
        dateModified: row.dateModified!,
        tags: this.loadTags(row.itemID),
        collections: this.getItemCollections(row.itemID, collections),
      };

      this.extractedCount++;
      yield this.createRecord(data, {
        recordType: 'attachments',
        localUserKey: this.localUserKey,
        library: this.library,
        machine: this.machine,
      });
    }
  }

  private *iterateNotes(): Generator<Record> {
    const { clause, params } = this.sinceUntilFilter('i.dateModified');
    const sql = `
      SELECT i.itemID AS itemID, i.key AS key, i.dateAdded AS dateAdded, i.dateModified AS dateModified,
             n.parentItemID AS parentItemID, n.note AS note, n.title AS title
      FROM items i
      JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
      JOIN itemNotes n ON n.itemID = i.itemID
      JOIN libraries l ON l.libraryID = i.libraryID
      WHERE l.type = 'user'
        AND it.typeName = 'note'
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
        AND (n.parentItemID IS NULL OR n.parentItemID NOT IN (SELECT itemID FROM deletedItems))${clause}
      ORDER BY i.dateModified DESC`;

    for (const row of iterateRows<NoteRow>(this.db!.prepare(sql), ...params)) {
      if (this.shouldStopExtracting(this.extractedCount)) return;

      const work = this.loadWorkRef(row.parentItemID);

      const data: ZoteroNoteRecord = {
        key: row.key,
        title: row.title,
        note: row.note,
        dateAdded: row.dateAdded,
        dateModified: row.dateModified,
        ...(work ? { work } : {}),
      };

      this.extractedCount++;
      yield this.createRecord(data, {
        recordType: 'notes',
        localUserKey: this.localUserKey,
        library: this.library,
        machine: this.machine,
      });
    }
  }

  private buildAttachment(row: AttachmentRow): ZoteroAttachment {
    const fields = this.loadFields(row.itemID);
    const attachment: ZoteroAttachment = {
      key: row.key,
      linkMode: row.linkMode,
      contentType: row.contentType,
      path: row.path,
      dateAdded: row.dateAdded,
    };

    const resolvedPath = this.resolveAttachmentPath(row.key, row.linkMode, row.path);
    if (resolvedPath) attachment.resolvedPath = resolvedPath;
    if (fields.title) attachment.title = fields.title;
    if (fields.url) attachment.url = fields.url;
    if (row.lastRead !== null) attachment.lastRead = row.lastRead;
    // Orphans never carry the flag: flaggedAttachmentKeys only ever contains
    // keys collected from children (see buildFlaggedAttachmentKeys), but the
    // parentItemID check is kept here too so that stays true by construction,
    // not by coincidence.
    if (row.parentItemID !== null && this.flaggedAttachmentKeys.has(row.key)) {
      attachment.sharedCarrier = true;
    }

    return attachment;
  }

  /**
   * Item keys of child attachments whose carrier — resolved path, or file
   * content hash — also appears under a DIFFERENT parent work. Built from
   * every non-deleted attachment in the user library (children and orphans),
   * but only children contribute to (and can be flagged by) the map: an
   * orphan has no parent to weld two works through.
   */
  private buildFlaggedAttachmentKeys(): Set<string> {
    const rows = this.db!.prepare(
      `SELECT i.key AS key, att.parentItemID AS parentItemID, att.linkMode AS linkMode, att.path AS path
       FROM itemAttachments att
       JOIN items i ON i.itemID = att.itemID
       JOIN libraries l ON l.libraryID = i.libraryID
       WHERE l.type = 'user'
         AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`
    ).all() as {
      key: string;
      parentItemID: number | null;
      linkMode: number;
      path: string | null;
    }[];

    const carriers = rows.map(row => ({
      key: row.key,
      parentItemID: row.parentItemID,
      carrierKeys: this.carrierKeys(row.key, row.linkMode, row.path),
    }));

    const carrierMap = new Map<string, Set<number>>();
    for (const c of carriers) {
      if (c.parentItemID === null) continue; // orphans don't count as parents
      for (const k of c.carrierKeys) {
        const parents = carrierMap.get(k) ?? new Set<number>();
        parents.add(c.parentItemID);
        carrierMap.set(k, parents);
      }
    }

    const flagged = new Set<string>();
    for (const c of carriers) {
      if (c.parentItemID === null) continue;
      if (c.carrierKeys.some(k => (carrierMap.get(k)?.size ?? 0) >= 2)) {
        flagged.add(c.key);
      }
    }

    if (flagged.size > 0) {
      this.logger.verboseInfo(
        `${flagged.size} attachment(s) share a carrier with a different parent work`
      );
    }

    return flagged;
  }

  /** The resolved path, plus a content-hash key when the file is readable — the two ways two attachments can carry the same bytes. */
  private carrierKeys(key: string, linkMode: number, path: string | null): string[] {
    const resolvedPath = this.resolveAttachmentPath(key, linkMode, path);
    if (!resolvedPath) return [];

    const keys = [resolvedPath];
    const hash = this.hashFile(resolvedPath);
    if (hash) keys.push(`md5:${hash}`);
    return keys;
  }

  private hashFile(path: string): string | undefined {
    try {
      return createHash('md5').update(readFileSync(path)).digest('hex');
    } catch {
      return undefined; // unreadable or missing — skip silently
    }
  }

  /** Storage folders are named by the attachment's own key, not its filename. */
  private resolveAttachmentPath(
    key: string,
    linkMode: number,
    path: string | null
  ): string | undefined {
    if (!path) return undefined;
    if (path.startsWith('storage:')) {
      return join(this.dataDir, 'storage', key, path.slice('storage:'.length));
    }
    if (linkMode === 2 && isAbsolute(path)) {
      return path;
    }
    return undefined;
  }

  private loadWorkRef(workItemID: number | null): ZoteroWorkRef | undefined {
    // The work's own trashed state is already excluded by the annotation
    // query's join condition, so a non-null id here is always live.
    if (workItemID === null) return undefined;
    const row = this.db!.prepare(
      `SELECT i.key AS key, it.typeName AS itemType
         FROM items i
         JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
         WHERE i.itemID = ?`
    ).get(workItemID) as { key: string; itemType: string } | undefined;
    if (!row) return undefined;

    const ref: ZoteroWorkRef = { key: row.key, itemType: row.itemType };
    const { title } = this.loadFields(workItemID);
    if (title) ref.title = title;
    return ref;
  }

  private loadWorkAttachments(workItemID: number): ZoteroAttachment[] {
    const rows = this.db!.prepare(
      `SELECT i.itemID AS itemID, i.key AS key, i.dateAdded AS dateAdded,
                att.parentItemID AS parentItemID, att.linkMode AS linkMode, att.contentType AS contentType,
                att.path AS path, att.lastRead AS lastRead
         FROM itemAttachments att
         JOIN items i ON i.itemID = att.itemID
         WHERE att.parentItemID = ?
           AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`
    ).all(workItemID) as unknown as AttachmentRow[];
    return rows.map(row => this.buildAttachment(row));
  }

  private loadFields(itemID: number): { [fieldName: string]: string } {
    const rows = this.db!.prepare(
      `SELECT f.fieldName AS fieldName, v.value AS value
         FROM itemData d
         JOIN fields f ON f.fieldID = d.fieldID
         JOIN itemDataValues v ON v.valueID = d.valueID
         WHERE d.itemID = ?`
    ).all(itemID) as { fieldName: string; value: string }[];

    const fields: { [fieldName: string]: string } = {};
    for (const row of rows) fields[row.fieldName] = row.value;
    return fields;
  }

  private loadCreators(itemID: number): ZoteroCreator[] {
    return this.db!.prepare(
      `SELECT c.firstName AS firstName, c.lastName AS lastName, c.fieldMode AS fieldMode,
                ct.creatorType AS creatorType, ic.orderIndex AS orderIndex
         FROM itemCreators ic
         JOIN creators c ON c.creatorID = ic.creatorID
         JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
         WHERE ic.itemID = ?
         ORDER BY ic.orderIndex`
    ).all(itemID) as unknown as ZoteroCreator[];
  }

  private loadTags(itemID: number): ZoteroTag[] {
    return this.db!.prepare(
      `SELECT t.name AS name, itag.type AS type
         FROM itemTags itag
         JOIN tags t ON t.tagID = itag.tagID
         WHERE itag.itemID = ?`
    ).all(itemID) as unknown as ZoteroTag[];
  }

  private loadCollections(): CollectionMap {
    const rows = this.db!.prepare(
      `SELECT c.collectionID AS collectionID, c.key AS key, c.collectionName AS name,
                c.parentCollectionID AS parentCollectionID
         FROM collections c
         JOIN libraries l ON l.libraryID = c.libraryID
         WHERE l.type = 'user'`
    ).all() as unknown as (CollectionRow & { collectionID: number })[];
    return new Map(rows.map(row => [row.collectionID, row]));
  }

  private buildCollectionChain(
    collectionID: number,
    collections: CollectionMap,
    seen: Set<number> = new Set()
  ): ZoteroCollection | undefined {
    if (seen.has(collectionID)) return undefined; // guard against a cyclical parent chain
    seen.add(collectionID);

    const row = collections.get(collectionID);
    if (!row) return undefined;

    const parent =
      row.parentCollectionID === null
        ? undefined
        : this.buildCollectionChain(row.parentCollectionID, collections, seen);
    return { key: row.key, name: row.name, ...(parent ? { parent } : {}) };
  }

  private getItemCollections(itemID: number, collections: CollectionMap): ZoteroCollection[] {
    const rows = this.db!.prepare(`SELECT collectionID FROM collectionItems WHERE itemID = ?`).all(
      itemID
    ) as { collectionID: number }[];

    const result: ZoteroCollection[] = [];
    for (const row of rows) {
      const chain = this.buildCollectionChain(row.collectionID, collections);
      if (chain) result.push(chain);
    }
    return result;
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const worksFilter = this.sinceUntilFilter('i.dateModified');
      const works = this.db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM items i
           JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
           JOIN libraries l ON l.libraryID = i.libraryID
           WHERE l.type = 'user'
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND it.typeName NOT IN ('attachment', 'annotation', 'note')${worksFilter.clause}`
        )
        .get(...worksFilter.params) as { n: number };

      const annotationsFilter = this.sinceUntilFilter('i.dateModified');
      const annotations = this.db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM itemAnnotations a
           JOIN items i ON i.itemID = a.itemID
           JOIN libraries l ON l.libraryID = i.libraryID
           JOIN itemAttachments att ON att.itemID = a.parentItemID
           JOIN items ai ON ai.itemID = att.itemID
           WHERE l.type = 'user'
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND ai.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND (att.parentItemID IS NULL OR att.parentItemID NOT IN (SELECT itemID FROM deletedItems))${annotationsFilter.clause}`
        )
        .get(...annotationsFilter.params) as { n: number };

      const attachmentsFilter = this.sinceUntilFilter('i.dateModified');
      const attachments = this.db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM itemAttachments att
           JOIN items i ON i.itemID = att.itemID
           JOIN libraries l ON l.libraryID = i.libraryID
           WHERE l.type = 'user'
             AND att.parentItemID IS NULL
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems)${attachmentsFilter.clause}`
        )
        .get(...attachmentsFilter.params) as { n: number };

      const notesFilter = this.sinceUntilFilter('i.dateModified');
      const notes = this.db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM items i
           JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
           JOIN itemNotes n ON n.itemID = i.itemID
           JOIN libraries l ON l.libraryID = i.libraryID
           WHERE l.type = 'user'
             AND it.typeName = 'note'
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND (n.parentItemID IS NULL OR n.parentItemID NOT IN (SELECT itemID FROM deletedItems))${notesFilter.clause}`
        )
        .get(...notesFilter.params) as { n: number };

      return works.n + annotations.n + attachments.n + notes.n;
    } catch {
      return null;
    }
  }
}
