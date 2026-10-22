import { existsSync } from 'node:fs';
import path from 'node:path';
import { Record } from '@chronicle.app/etl';
import { nodeKey } from '@chronicle.app/schema';
import { SqliteExtractor, iterateRows, safariToUnixTimestamp } from '@chronicle.app/etl-sqlite';
import { z } from 'zod';
import { CURRENT_USER, recordCreator, shareParticipants, type Participant } from '../cloudKit.js';
import {
  decodeNoteBody,
  decodeReplicaUsers,
  noteMarkdown,
  sessionText,
  writingSessions,
  type NoteBody,
  type WritingSession,
} from '../noteBody.js';
import AppleNotesTransformer, { mediaObject } from './AppleNotesTransformer.js';

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
   * When it was last edited: when Notes last saved it, or when its newest
   * text was written, if later, since text that syncs in from someone else
   * can leave the save time behind. By whoever wrote its newest text, or,
   * with none, the one person it maps any replica to.
   */
  lastEdit: { at: string; author: Author | null };
  /** Its folder, and whoever owns the folder, which is you unless it was shared with you. */
  folder: { id: string; title: string | null; trash: boolean; owner: Author | null } | null;
  locked: boolean;
  pinned: boolean;
  body: string | null;
  attachments: Attachment[];
  hashtags: string[];
}

export interface Attachment {
  id: string;
  /** Its type, when the database has one. */
  uti: string | null;
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
  /** The CloudKit user ID of whoever shared the folder with you; null for your own. */
  folderOwner: string | null;
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
  uti: string | null;
  title: string | null;
  created: number | null;
  mediaId: string | null;
  /** The folder under the media's that its current file is in. */
  generation: string | null;
  filename: string | null;
  accountId: string | null;
}

interface InlineAttachment {
  uti: string | null;
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
             f.ZZONEOWNERNAME AS folderOwner,
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
    if (!row.serverRecord) return this.author(row, CURRENT_USER);
    try {
      return this.author(row, recordCreator(row.serverRecord));
    } catch (error) {
      this.logger.warn("Can't read who made a note", { note: row.id, error: String(error) });
      return null;
    }
  }

  /**
   * Whose each replica is, by its 1-based index into the note's replicas. A
   * note with no record of it has only ever been edited by you.
   */
  protected replicaAuthors(row: NoteRow, body: NoteBody): (replica: number) => string | null {
    if (!row.replicaUsers) return () => CURRENT_USER;
    const users = this.replicaUsers(row);
    return replica => users.get(body.replicas[replica - 1]) ?? null;
  }

  /** Whose each replica UUID is, by the note's map. */
  protected replicaUsers(row: NoteRow): Map<string, string> {
    if (!row.replicaUsers) return new Map();
    try {
      return decodeReplicaUsers(row.replicaUsers);
    } catch (error) {
      this.logger.warn("Can't read who edited a note", { note: row.id, error: String(error) });
      return new Map();
    }
  }

  private attachmentsByNote?: Map<number, Attachment[]>;
  private inline?: Map<string, InlineAttachment>;

  protected attachments(row: NoteRow): Attachment[] {
    if (!this.attachmentsByNote) {
      this.attachmentsByNote = new Map();
      const rows = this.db!.prepare(
        `SELECT a.ZNOTE AS note, a.ZIDENTIFIER AS id, a.ZTYPEUTI AS uti, a.ZTITLE AS title,
                a.ZCREATIONDATE AS created, m.ZIDENTIFIER AS mediaId, m.ZGENERATION1 AS generation,
                m.ZFILENAME AS filename, acct.ZIDENTIFIER AS accountId
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
          file: this.mediaFile(a),
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
          uti: string | null;
          alt: string | null;
        }>
      ).map(row => [row.id, { uti: row.uti, alt: row.alt }])
    );
    return this.inline;
  }

  /**
   * Media sits in Accounts/<account>/Media/<media>/<generation>/<file name>.
   * Editing it adds a generation and can leave the earlier ones, so the file is
   * the one in the generation the media names.
   */
  private mediaFile({ accountId, mediaId, generation, filename }: AttachmentRow) {
    if (!accountId || !mediaId || !generation || !filename) return null;
    const file = path.join(
      path.dirname(this.config.input),
      'Accounts',
      accountId,
      'Media',
      mediaId,
      generation,
      filename
    );
    // Not there when it isn't downloaded to this Mac.
    return existsSync(file) ? file : null;
  }

  /**
   * How an attachment reads in the text. A file is a Markdown image or link to
   * `cid:` and the identity its node in the note's `contains` has, the hash of
   * its key, as an email's inline image names its part. Anything else is named
   * in brackets, such as `[table]`.
   */
  protected attachmentText(row: NoteRow): (identifier: string) => string {
    const byId = new Map(this.attachments(row).map(a => [a.id, a]));
    const inline = this.inlineAttachments();
    return identifier => {
      const tag = inline.get(identifier);
      if (tag) return tag.alt ?? '';
      const attachment = byId.get(identifier);
      if (!attachment) return '[attachment]';
      const kind = kindOf(attachment.uti);
      const name = attachment.title ?? (attachment.file ? path.basename(attachment.file) : null);
      const media = mediaObject(attachment);
      if (!media) return `[${kind}${name ? `: ${name}` : ''}]`;
      const text = (name ?? kind).replaceAll(/[\\[\]]/g, '\\$&');
      const link = `[${text}](cid:${nodeKey(media)})`;
      return media['@type'] === 'ImageObject' ? `!${link}` : link;
    };
  }
}

function kindOf(uti: string | null): string {
  if (!uti) return 'attachment';
  if (/jpeg|png|heic|image|gif|tiff/.test(uti)) return 'image';
  if (uti === 'com.apple.paper' || uti.startsWith('com.apple.paper.doc')) return 'scan';
  if (uti === 'com.apple.drawing.2' || uti === 'com.apple.drawing') return 'drawing';
  if (uti === 'com.apple.notes.table') return 'table';
  if (/pdf/.test(uti)) return 'pdf';
  if (/audio|m4a/.test(uti)) return 'audio';
  if (/movie|video|mpeg-4|quicktime/.test(uti)) return 'video';
  if (/url/.test(uti)) return 'link';
  return 'attachment';
}

/**
 * Each note as it is now, last edited first, and bounded by when it was last
 * edited, so a later run picks up every note changed since.
 */
export class AppleNotesExtractor extends AppleNotesBaseExtractor {
  static override description = 'Your notes, as they are now';
  static override recordTypes = ['notes'];
  static override temporality = 'snapshot' as const;

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;
    // When a note was last edited can be in its text, so every note is read.
    const notes: Array<{ row: NoteRow; body: NoteBody | null; lastEdit: AppleNote['lastEdit'] }> =
      [];
    for (const row of this.noteRows(null)) {
      const body = this.body(row);
      const lastEdit = this.lastEdit(row, body);
      if (
        (since && lastEdit.at < since.toISOString()) ||
        (until && lastEdit.at >= until.toISOString())
      )
        continue;
      notes.push({ row, body, lastEdit });
    }
    notes.sort((a, b) => b.lastEdit.at.localeCompare(a.lastEdit.at));
    const limit = this.getEffectiveLimit();
    const inline = this.inlineAttachments();
    for (const { row, body, lastEdit } of limit === null ? notes : notes.slice(0, limit)) {
      const note: AppleNote = {
        id: row.id,
        title: row.title,
        created: iso(row.created),
        creator: this.creator(row),
        modified: row.modified ? iso(row.modified) : null,
        lastEdit,
        folder: row.folderId
          ? {
              id: row.folderId,
              title: row.folderTitle,
              trash: row.folderType === 1,
              owner: this.author(row, row.folderOwner ?? CURRENT_USER),
            }
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
                  .filter(tag => tag && tag.uti?.endsWith('.hashtag') && tag.alt)
                  .map(tag => (tag as InlineAttachment).alt!.replace(/^#/, ''))
              ),
            ]
          : [],
      };
      yield this.createRecord(note, { recordType: 'notes', occurredAt: lastEdit.at });
    }
  }

  private lastEdit(row: NoteRow, body: NoteBody | null): AppleNote['lastEdit'] {
    const saved = safariToUnixTimestamp(row.modified ?? row.created);
    // Each person's writing a second at a time; the last is the newest text.
    let newest: WritingSession | undefined;
    if (body)
      for (const second of writingSessions(body, 0, this.replicaAuthors(row, body)))
        if (!newest || second.end > newest.end) newest = second;
    return {
      at: new Date(Math.max(saved, newest?.end ?? saved) * 1000).toISOString(),
      author: this.author(row, newest ? newest.author : this.onlyEditor(row)),
    };
  }

  /** The one person a note maps any replica to: you, when it maps none. */
  private onlyEditor(row: NoteRow): string | null {
    if (!row.replicaUsers) return CURRENT_USER;
    const users = new Set(this.replicaUsers(row).values());
    return users.size === 1 ? [...users][0] : null;
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

  /** `--session-gap` is read only by edits, so a run that gives it without kinds reads them. */
  static override kindsFor = (config: { [option: string]: unknown }) =>
    config.sessionGap === undefined ? undefined : ['edits'];

  static override schema = AppleNotesBaseExtractor.schema.extend({
    // The CLI passes every value as a string. No default here, or the CLI
    // would pass one to every run and each would read edits.
    sessionGap: z.coerce
      .number()
      .positive()
      .optional()
      .describe('Minutes without writing that end a writing session, 20 by default'),
  });

  async *extract(): AsyncGenerator<Record> {
    const { since, until, sessionGap = 20 } = this.config;
    const edits: Edit[] = [];
    for (const row of this.noteRows(null)) {
      const body = this.body(row);
      if (!body) continue;
      const attachmentText = this.attachmentText(row);
      const authorOf = this.replicaAuthors(row, body);
      for (const session of writingSessions(body, sessionGap * 60, authorOf)) {
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
