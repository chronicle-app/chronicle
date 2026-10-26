import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { assertReadable } from '@chronicle.app/etl';
import { getRow } from '@chronicle.app/etl-sqlite';
import { GROUP_CHAT_STYLE, type GroupChatIds } from '@chronicle.app/apple';

/** The Messages database Shared with You's photos came from. */
export const MESSAGES_DATABASE = `${process.env.HOME}/Library/Messages/chat.db`;

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
  /** Apple's IDs for the group chat it came in, or null in a one-to-one chat. */
  group: GroupChatIds | null;
}

/**
 * Messages' database, for who sent each photo in Shared with You and the
 * group chat it came in. Photos keeps each photo's Messages attachment ID,
 * but not who sent it in a group, or whether a conversation is a group.
 */
export class MessagesDatabase {
  private readonly db: DatabaseSync;
  private readonly lookup: StatementSync;

  constructor(path: string) {
    assertReadable(path, 'Messages database');
    this.db = new DatabaseSync(path, { readOnly: true });
    this.lookup = this.db.prepare(`
      SELECT m.is_from_me AS fromMe, m.service AS service, h.id AS handle,
        c.style AS style, c.group_id AS groupId, c.original_group_id AS originalGroupId
      FROM attachment a
      JOIN message_attachment_join j ON j.attachment_id = a.ROWID
      JOIN message m ON m.ROWID = j.message_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      LEFT JOIN chat_message_join cm ON cm.message_id = m.ROWID
      LEFT JOIN chat c ON c.ROWID = cm.chat_id
      WHERE a.guid = ?
      LIMIT 1`);
  }

  /** The message an attachment came in, or null when it's gone from Messages. */
  message(attachment: string): SharedMessage | null {
    const row = getRow<{
      fromMe: number | null;
      service: string | null;
      handle: string | null;
      style: number | null;
      groupId: string | null;
      originalGroupId: string | null;
    }>(this.lookup, attachment);
    if (!row) return null;
    return {
      fromMe: row.fromMe === 1,
      service: row.service ?? null,
      handle: row.handle?.trim() || null,
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
