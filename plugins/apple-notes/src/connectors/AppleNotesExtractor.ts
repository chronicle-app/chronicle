import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Record } from '@chronicle.app/etl';
import { SqliteExtractor, iterateRows, safariToUnixTimestamp } from '@chronicle.app/etl-sqlite';
import { z } from 'zod';
import {
  CURRENT_USER,
  recordCreator,
  recordModifier,
  shareParticipants,
  type Participant,
} from '../cloudKit.js';
import {
  decodeNoteBody,
  decodeReplicaUsers,
  noteMarkdown,
  sessionText,
  writingSessions,
  type NoteBody,
} from '../noteBody.js';
import AppleNotesTransformer from './AppleNotesTransformer.js';

const CONTAINER = `${process.env.HOME}/Library/Group Containers/group.com.apple.notes`;

/**
 * Who wrote something: you, or someone a note is shared with. The name,
 * emails, and phone numbers are what iCloud showed for them in the shares
 * that list them, as each share last synced.
 */
export interface Author {
  /** Their CloudKit user ID in Notes, the same in every note. Null for a note only on this Mac. */
  id: string | null;
  self: boolean;
  name: string | null;
  emails: string[];
  phones: string[];
}

/** What the shares say about one person. */
type Listed = Pick<Author, 'name' | 'emails' | 'phones'>;

/** A note as it is now. */
export interface AppleNote {
  id: string;
  title: string | null;
  created: string;
  /** Who made the note, when the database says. */
  creator: Author | null;
  /** When Notes last saved a change to it. */
  modified: string | null;
  /**
   * Its latest burst of writing, as `edits` gives it. A note none of whose
   * text says when it was written was last edited when Notes last saved it,
   * by whoever iCloud says last changed it.
   */
  lastEdit: Pick<Edit, 'start' | 'end' | 'author'>;
  folder: { id: string; title: string | null; trash: boolean } | null;
  locked: boolean;
  pinned: boolean;
  body: string | null;
  attachments: Attachment[];
  hashtags: string[];
}

export interface Attachment {
  id: string;
  uti: string;
  title: string | null;
  created: string | null;
  file: string | null;
}

/** A burst of one person's writing in one note, with the text from it that's still there. */
export interface Edit {
  note: { id: string; title: string | null };
  /** Who typed it, or null when the note doesn't say whose replica it was. */
  author: Author | null;
  start: string;
  end: string;
  text: string;
  characters: number;
  /** Replica UUIDs that typed it: each is one Notes install on one device. */
  replicas: string[];
}

interface NoteRow {
  pk: number;
  id: string;
  title: string | null;
  created: number;
  modified: number | null;
  locked: number | null;
  pinned: number | null;
  folderId: string | null;
  folderTitle: string | null;
  folderType: number | null;
  accountId: string | null;
  /** The account's own CloudKit user ID, which is you. */
  accountUser: string | null;
  data: Uint8Array | null;
  replicaUsers: Uint8Array | null;
  serverRecord: Uint8Array | null;
}

interface AttachmentRow {
  note: number;
  id: string;
  uti: string;
  title: string | null;
  created: number | null;
  mediaId: string | null;
  filename: string | null;
  accountId: string | null;
}

interface InlineAttachment {
  uti: string;
  alt: string | null;
}

const iso = (appleSeconds: number) =>
  new Date(safariToUnixTimestamp(appleSeconds) * 1000).toISOString();

/** The addresses with one more, unless it's already there in any case. */
const withAddress = (addresses: string[], address: string | null) =>
  address && !addresses.some(known => known.toLowerCase() === address.toLowerCase())
    ? [...addresses, address]
    : addresses;

/**
 * Notes keeps every note, folder, account, and attachment in
 * ZICCLOUDSYNCINGOBJECT, told apart by Z_ENT, and the body of each note in
 * ZICNOTEDATA. Entity numbers come from Z_PRIMARYKEY. Column suffixes such as
 * ZTITLE1 are the ones current macOS uses; earlier releases number them
 * differently. Who made and edited a shared note comes from its CloudKit
 * record, its replica-to-user map, and the people its share lists.
 */
abstract class AppleNotesBaseExtractor extends SqliteExtractor<typeof AppleNotesBaseExtractor> {
  static override source = 'apple-notes';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override default = true;
  static override newestFirst = true;
  static override defaultTransformer = AppleNotesTransformer;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe('Path to NoteStore.sqlite').default(`${CONTAINER}/NoteStore.sqlite`),
    // The CLI passes every value as a string.
    sessionGap: z.coerce
      .number()
      .positive()
      .default(20)
      .describe('Minutes without writing that end a writing session'),
  }) as any;

  override occurredAt(record: Record): Date | undefined {
    return new Date(record.context.occurredAt);
  }

  private entities?: Map<string, number>;

  protected entity(name: string): number {
    this.entities ??= new Map(
      (
        this.db!.prepare('SELECT Z_NAME AS name, Z_ENT AS ent FROM Z_PRIMARYKEY').all() as Array<{
          name: string;
          ent: number;
        }>
      ).map(row => [row.name, row.ent])
    );
    const ent = this.entities.get(name);
    if (ent === undefined) throw new Error(`This Notes database has no ${name} entity`);
    return ent;
  }

  /** Notes, last edited first. */
  protected *noteRows(limit: number | null): Generator<NoteRow> {
    let sql = `
      SELECT n.Z_PK AS pk, n.ZIDENTIFIER AS id, n.ZTITLE1 AS title,
             n.ZCREATIONDATE3 AS created, n.ZMODIFICATIONDATE1 AS modified,
             n.ZISPASSWORDPROTECTED AS locked, n.ZISPINNED AS pinned,
             f.ZIDENTIFIER AS folderId, f.ZTITLE2 AS folderTitle, f.ZFOLDERTYPE AS folderType,
             a.ZIDENTIFIER AS accountId, a.ZUSERRECORDNAME AS accountUser, d.ZDATA AS data,
             n.ZREPLICAIDTOUSERIDDICTDATA AS replicaUsers, n.ZSERVERRECORDDATA AS serverRecord
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICNOTEDATA d ON d.ZNOTE = n.Z_PK
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON f.Z_PK = n.ZFOLDER
      LEFT JOIN ZICCLOUDSYNCINGOBJECT a ON a.Z_PK = n.ZACCOUNT7
      WHERE n.Z_ENT = ? AND n.ZCREATIONDATE3 IS NOT NULL
        AND coalesce(n.ZMARKEDFORDELETION, 0) = 0
      ORDER BY coalesce(n.ZMODIFICATIONDATE1, n.ZCREATIONDATE3) DESC`;
    const params: number[] = [this.entity('ICNote')];
    if (limit !== null) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    yield* iterateRows<NoteRow>(this.db!.prepare(sql), ...params);
  }

  protected body(row: NoteRow): NoteBody | null {
    if (row.locked || !row.data) return null;
    try {
      return decodeNoteBody(row.data);
    } catch (error) {
      this.logger.warn("Can't read a note's text", { note: row.id, error: String(error) });
      return null;
    }
  }

  private everyone?: Map<string, Listed>;

  /**
   * Everyone any share lists, by CloudKit user ID. A person's ID is the same in
   * every note, so someone named in one share is known in all of them. A share
   * lists each person by the address they were invited at, so one person can
   * have a different one in each share, and they keep them all.
   */
  private people(): Map<string, Listed> {
    if (this.everyone) return this.everyone;
    this.everyone = new Map();
    const rows = this.db!.prepare(
      'SELECT ZSERVERSHAREDATA AS share FROM ZICCLOUDSYNCINGOBJECT WHERE ZSERVERSHAREDATA IS NOT NULL'
    ).all() as Array<{ share: Uint8Array }>;
    for (const { share } of rows) {
      let participants: Participant[];
      try {
        participants = shareParticipants(share);
      } catch (error) {
        this.logger.warn("Can't read a note's share", { error: String(error) });
        continue;
      }
      for (const person of participants) {
        const known = this.everyone.get(person.id) ?? { name: null, emails: [], phones: [] };
        this.everyone.set(person.id, {
          name: known.name ?? person.name,
          emails: withAddress(known.emails, person.email),
          phones: withAddress(known.phones, person.phone),
        });
      }
    }
    return this.everyone;
  }

  /** The person a CloudKit user ID names, from a note's point of view. */
  protected author(row: NoteRow, id: string | null): Author | null {
    if (id === null) return null;
    const self = id === CURRENT_USER || id === row.accountUser;
    const userId = id === CURRENT_USER ? row.accountUser : id;
    // Shares you own list you as the current user.
    const known =
      (userId ? this.people().get(userId) : undefined) ??
      (self ? this.people().get(CURRENT_USER) : undefined);
    return {
      id: userId,
      self,
      name: known?.name ?? null,
      emails: known?.emails ?? [],
      phones: known?.phones ?? [],
    };
  }

  /** Who made the note. One never synced to iCloud was made on this Mac. */
  protected creator(row: NoteRow): Author | null {
    return this.recordUser(row, recordCreator, 'made');
  }

  /** Who last changed the note, as iCloud last synced it. */
  protected modifier(row: NoteRow): Author | null {
    return this.recordUser(row, recordModifier, 'last changed');
  }

  /** A user the note's CloudKit record names. One never synced is all yours. */
  private recordUser(
    row: NoteRow,
    read: (record: Uint8Array) => string | null,
    did: string
  ): Author | null {
    if (!row.serverRecord) return this.author(row, CURRENT_USER);
    try {
      return this.author(row, read(row.serverRecord));
    } catch (error) {
      this.logger.warn(`Can't read who ${did} a note`, { note: row.id, error: String(error) });
      return null;
    }
  }

  /** The bursts of writing still in a note, each with the text from it that's there. */
  protected edits(row: NoteRow, body: NoteBody): Edit[] {
    const attachmentText = this.attachmentText(row);
    const authorOf = this.replicaAuthors(row, body);
    const edits: Edit[] = [];
    for (const session of writingSessions(body, this.config.sessionGap * 60, authorOf)) {
      const text = sessionText(body, session, attachmentText);
      if (!text) continue;
      edits.push({
        note: { id: row.id, title: row.title },
        author: this.author(row, session.author),
        start: new Date(session.start * 1000).toISOString(),
        end: new Date(session.end * 1000).toISOString(),
        text,
        characters: session.characters,
        replicas: session.replicas,
      });
    }
    return edits;
  }

  /**
   * Whose each replica is, by its 1-based index into the note's replicas. A
   * note with no record of it has only ever been edited by you.
   */
  protected replicaAuthors(row: NoteRow, body: NoteBody): (replica: number) => string | null {
    if (!row.replicaUsers) return () => CURRENT_USER;
    let users: Map<string, string>;
    try {
      users = decodeReplicaUsers(row.replicaUsers);
    } catch (error) {
      this.logger.warn("Can't read who edited a note", { note: row.id, error: String(error) });
      users = new Map();
    }
    return replica => users.get(body.replicas[replica - 1]) ?? null;
  }

  private attachmentsByNote?: Map<number, Attachment[]>;
  private inline?: Map<string, InlineAttachment>;

  protected attachments(row: NoteRow): Attachment[] {
    if (!this.attachmentsByNote) {
      this.attachmentsByNote = new Map();
      const rows = this.db!.prepare(
        `SELECT a.ZNOTE AS note, a.ZIDENTIFIER AS id, a.ZTYPEUTI AS uti, a.ZTITLE AS title,
                a.ZCREATIONDATE AS created, m.ZIDENTIFIER AS mediaId, m.ZFILENAME AS filename,
                acct.ZIDENTIFIER AS accountId
         FROM ZICCLOUDSYNCINGOBJECT a
         LEFT JOIN ZICCLOUDSYNCINGOBJECT m ON m.Z_PK = a.ZMEDIA
         LEFT JOIN ZICCLOUDSYNCINGOBJECT acct ON acct.Z_PK = a.ZACCOUNT1
         WHERE a.Z_ENT = ? AND a.ZNOTE IS NOT NULL AND coalesce(a.ZMARKEDFORDELETION, 0) = 0
         ORDER BY a.ZCREATIONDATE`
      ).all(this.entity('ICAttachment')) as unknown as AttachmentRow[];
      for (const a of rows) {
        const list = this.attachmentsByNote.get(a.note) ?? [];
        list.push({
          id: a.id,
          uti: a.uti,
          title: a.title || null,
          created: a.created ? iso(a.created) : null,
          file: this.mediaFile(a.accountId, a.mediaId, a.filename),
        });
        this.attachmentsByNote.set(a.note, list);
      }
    }
    return this.attachmentsByNote.get(row.pk) ?? [];
  }

  /** Hashtags, mentions, and links to other notes, which sit in the text itself. */
  protected inlineAttachments(): Map<string, InlineAttachment> {
    this.inline ??= new Map(
      (
        this.db!.prepare(
          `SELECT ZIDENTIFIER AS id, ZTYPEUTI1 AS uti, ZALTTEXT AS alt
           FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?`
        ).all(this.entity('ICInlineAttachment')) as Array<{
          id: string;
          uti: string;
          alt: string | null;
        }>
      ).map(row => [row.id, { uti: row.uti, alt: row.alt }])
    );
    return this.inline;
  }

  /** Media sits in Accounts/<account>/Media/<media>/<generation>/<file name>. */
  private mediaFile(account: string | null, media: string | null, filename: string | null) {
    if (!account || !media || !filename) return null;
    const dir = path.join(path.dirname(this.config.input), 'Accounts', account, 'Media', media);
    try {
      for (const generation of readdirSync(dir))
        if (readdirSync(path.join(dir, generation)).includes(filename))
          return path.join(dir, generation, filename);
    } catch {
      /* Not downloaded to this Mac. */
    }
    return null;
  }

  /** How an attachment reads in the text. */
  protected attachmentText(row: NoteRow): (identifier: string) => string {
    const byId = new Map(this.attachments(row).map(a => [a.id, a]));
    const inline = this.inlineAttachments();
    return identifier => {
      const tag = inline.get(identifier);
      if (tag) return tag.alt ?? '';
      const attachment = byId.get(identifier);
      if (!attachment) return '[attachment]';
      const name = attachment.title ?? (attachment.file ? path.basename(attachment.file) : null);
      return `[${kindOf(attachment.uti)}${name ? `: ${name}` : ''}]`;
    };
  }
}

function kindOf(uti: string): string {
  if (/jpeg|png|heic|image|gif|tiff/.test(uti)) return 'image';
  if (uti === 'com.apple.paper' || uti.startsWith('com.apple.paper.doc')) return 'scan';
  if (uti === 'com.apple.drawing.2' || uti === 'com.apple.drawing') return 'drawing';
  if (uti === 'com.apple.notes.table') return 'table';
  if (/pdf/.test(uti)) return 'pdf';
  if (/audio|m4a/.test(uti)) return 'audio';
  if (/url/.test(uti)) return 'link';
  return 'attachment';
}

/**
 * Each note as it is now, last edited first. Bounded by when Notes last saved
 * a change to it, so a later run picks up a deletion that left no text.
 */
export class AppleNotesExtractor extends AppleNotesBaseExtractor {
  static override description = 'Your notes, as they are now';
  static override recordTypes = ['notes'];
  static override temporality = 'snapshot' as const;

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;
    for (const row of this.noteRows(since || until ? null : this.getEffectiveLimit())) {
      const created = iso(row.created);
      const modified = row.modified ? iso(row.modified) : null;
      const saved = modified ?? created;
      if ((since && saved < since.toISOString()) || (until && saved >= until.toISOString()))
        continue;
      const body = this.body(row);
      const inline = this.inlineAttachments();
      // Bursts come newest first by when they ended, as `edits` gives them.
      const [latest] = (body ? this.edits(row, body) : []).sort((a, b) =>
        b.end.localeCompare(a.end)
      );
      const note: AppleNote = {
        id: row.id,
        title: row.title,
        created,
        creator: this.creator(row),
        modified,
        lastEdit: latest
          ? { start: latest.start, end: latest.end, author: latest.author }
          : { start: saved, end: saved, author: this.modifier(row) },
        folder: row.folderId
          ? { id: row.folderId, title: row.folderTitle, trash: row.folderType === 1 }
          : null,
        locked: Boolean(row.locked),
        pinned: Boolean(row.pinned),
        body: body ? noteMarkdown(body, this.attachmentText(row)) : null,
        attachments: this.attachments(row),
        hashtags: body
          ? [
              ...new Set(
                body.runs
                  .map(run => run.attachment && inline.get(run.attachment))
                  .filter(tag => tag && tag.uti.endsWith('.hashtag') && tag.alt)
                  .map(tag => (tag as InlineAttachment).alt!.replace(/^#/, ''))
              ),
            ]
          : [],
      };
      yield this.createRecord(note, { recordType: 'notes', occurredAt: saved });
    }
  }
}

/**
 * Bursts of one person's writing, newest first. Notes stamps each stretch of
 * text with when it was written, and each character with the replica that
 * typed it, which the note maps to a person. So the text still in a note can
 * be grouped into the sessions that wrote it, one person's at a time. Deleted
 * text is gone, and so are sessions whose text was all deleted. Not read
 * unless asked for: most people want their notes, not how they were written.
 */
export class AppleNotesEditsExtractor extends AppleNotesBaseExtractor {
  static override description = 'Who wrote what is in your notes, and when';
  static override recordTypes = ['edits'];
  static override default = false;

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;
    const edits: Edit[] = [];
    for (const row of this.noteRows(null)) {
      const body = this.body(row);
      if (body) edits.push(...this.edits(row, body));
    }
    edits.sort((a, b) => b.end.localeCompare(a.end));
    const limit = this.getEffectiveLimit();
    let count = 0;
    for (const edit of edits) {
      if (since && edit.end < since.toISOString()) continue;
      if (until && edit.end >= until.toISOString()) continue;
      if (limit !== null && count++ >= limit) return;
      // An edit happened during its burst, but what it says about the note,
      // its title and the text still in it, is as of this read.
      yield this.createRecord(
        edit,
        { recordType: 'edits', occurredAt: edit.end },
        { assertedAt: this.asOfTime() }
      );
    }
  }
}
