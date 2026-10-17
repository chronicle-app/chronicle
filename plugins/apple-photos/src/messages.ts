import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { assertReadable } from '@chronicle.app/etl';
import { getRow } from '@chronicle.app/etl-sqlite';

/** The Messages database Shared with You's photos came from. */
export const MESSAGES_DATABASE = `${process.env.HOME}/Library/Messages/chat.db`;

/** The message an attachment came in, as `chat.db` has it. */
export interface SharedMessage {
  /** Whether you sent it. */
  fromMe: boolean;
  /** The service it went over: `iMessage`, `SMS`, or `RCS`. */
  service: string | null;
  /**
   * The other person's handle, a phone number or an email address, as Messages
   * keeps it: who sent it, or for a message you sent in a one-to-one
   * conversation, who you sent it to. A message you sent to a group has none.
   */
  handle: string | null;
  /** Whether it went to a group conversation. */
  group: boolean;
}

// chat.style for a group conversation and a one-to-one one.
const GROUP = 43;
const ONE_TO_ONE = 45;

/**
 * Messages' database, for who sent each photo in Shared with You. Photos
 * keeps each photo's Messages attachment ID, but not who sent it in a group.
 */
export class MessagesDatabase {
  private readonly db: DatabaseSync;
  private readonly lookup: StatementSync;

  constructor(path: string) {
    assertReadable(path, 'Messages database');
    this.db = new DatabaseSync(path, { readOnly: true });
    // A message you sent in a one-to-one conversation usually has no handle
    // of its own. The conversation's one handle is who you sent it to.
    this.lookup = this.db.prepare(`
      SELECT m.is_from_me AS fromMe, m.service AS service, c.style AS style,
        COALESCE(h.id, (
          SELECT other.id FROM chat_handle_join ch JOIN handle other ON other.ROWID = ch.handle_id
          WHERE ch.chat_id = c.ROWID AND c.style = ${ONE_TO_ONE} LIMIT 1
        )) AS handle
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
    }>(this.lookup, attachment);
    if (!row) return null;
    const handle = row.handle?.trim() || null;
    return {
      fromMe: row.fromMe === 1,
      service: row.service ?? null,
      handle,
      group: row.style === GROUP,
    };
  }

  close(): void {
    this.db.close();
  }
}
