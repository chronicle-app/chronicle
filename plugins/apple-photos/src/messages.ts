import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { assertReadable, type DatabaseSchema } from '@chronicle.app/etl';
import { assertDatabaseSchema, getRow } from '@chronicle.app/etl-sqlite';
import { GROUP_CHAT_STYLE, type GroupChatIds } from '@chronicle.app/apple';
import { appleDate } from './coredata.js';

/** The Messages database Shared with You's photos came from. */
export const MESSAGES_DATABASE = `${process.env.HOME}/Library/Messages/chat.db`;

/**
 * What `chat.db` must have for Shared with You to read it. An older Messages
 * has no group IDs, so a group chat's photo has no Channel.
 */
const MESSAGES_DATABASES: DatabaseSchema[] = [
  {
    tables: {
      attachment: ['ROWID', 'guid'],
      message_attachment_join: ['message_id', 'attachment_id'],
      message: ['ROWID', 'is_from_me', 'service', 'handle_id', 'date'],
      handle: ['ROWID', 'id'],
      chat_message_join: ['chat_id', 'message_id'],
      chat: ['ROWID', 'style', 'group_id?', 'original_group_id?'],
    },
  },
];

/** The message an attachment came in, as `chat.db` has it. */
export interface SharedMessage {
  /** Whether you sent it. */
  fromMe: boolean;
  /** The service it went over: `iMessage`, `SMS`, or `RCS`. */
  service: string | null;
  /**
   * Who sent it: their handle, a phone number or an email address, as Messages
   * keeps it. A message you sent usually has none.
   */
  handle: string | null;
  /** When it was sent. */
  sent: string | null;
  /** Apple's IDs for the group chat it came in, or null in a one-to-one chat. */
  group: GroupChatIds | null;
}

/**
 * Messages' database, for who sent each photo in Shared with You, when, and
 * the group chat it came in. Photos keeps each photo's Messages attachment ID,
 * but not who sent it in a group, or whether a conversation is a group.
 */
export class MessagesDatabase {
  private readonly db: DatabaseSync;
  private readonly lookup: StatementSync;

  constructor(path: string) {
    assertReadable(path, 'Messages database');
    this.db = new DatabaseSync(path, { readOnly: true });
    try {
      const chat = assertDatabaseSchema(this.db, MESSAGES_DATABASES, path).get('chat');
      const c = (column: string) => (chat?.has(column) ? `c.${column}` : 'NULL');
      this.lookup = this.db.prepare(`
        SELECT m.is_from_me AS fromMe, m.service AS service, h.id AS handle,
          -- Nanoseconds since 2001, which are too large to read as a number.
          m.date / 1000000000.0 AS sent,
          c.style AS style, ${c('group_id')} AS groupId, ${c('original_group_id')} AS originalGroupId
        FROM attachment a
        JOIN message_attachment_join j ON j.attachment_id = a.ROWID
        JOIN message m ON m.ROWID = j.message_id
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cm ON cm.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cm.chat_id
        WHERE a.guid = ?
        LIMIT 1`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** The message an attachment came in, or null when it's gone from Messages. */
  message(attachment: string): SharedMessage | null {
    const row = getRow<{
      fromMe: number | null;
      service: string | null;
      handle: string | null;
      sent: number | null;
      style: number | null;
      groupId: string | null;
      originalGroupId: string | null;
    }>(this.lookup, attachment);
    if (!row) return null;
    return {
      fromMe: row.fromMe === 1,
      service: row.service ?? null,
      handle: row.handle?.trim() || null,
      sent: row.sent ? appleDate(row.sent) : null,
      group:
        row.style === GROUP_CHAT_STYLE
          ? { groupId: row.groupId, originalGroupId: row.originalGroupId }
          : null,
    };
  }

  close(): void {
    this.db.close();
  }
}
