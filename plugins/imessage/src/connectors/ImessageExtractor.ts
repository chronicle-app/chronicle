import { Record } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  iosToUnixTimestamp,
  timeRangeConditions,
  APPLE_EPOCH_OFFSET_SECONDS,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import ImessageTransformer from './ImessageTransformer.js';
import { z } from 'zod';

export class ImessageExtractor extends SqliteExtractor<typeof ImessageExtractor> {
  static override recordTypes: string[] = ['messages'];
  static override source = 'imessage';
  static override description = 'Messages and attachments from chat.db';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override default = true;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .default(`${process.env.HOME}/Library/Messages/chat.db`)
      .describe('The path to the iMessage sqlite database'),
    includeContactNames: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include contact names from AddressBook (default: true)'),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any;

  static override defaultTransformer = ImessageTransformer;

  override async *extract(): AsyncGenerator<Record> {
    const chats = this.loadChats();
    const rows = this.queryMessages();
    const attachments = this.loadAttachments();

    // Get real iCloud account info automatically
    const realIcloudAccount =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    for (const row of rows) {
      const attributedBody = this.processAttributedBody((row as any).attributedBody);
      const timestamp = iosToUnixTimestamp(Number.parseInt((row as any).date, 10));
      const participants = chats[(row as any).chat_id] || [];
      const messageAttachments = attachments[(row as any).ROWID] || [];

      yield this.createRecord(row, {
        attributedBody,
        timestamp,
        messageId: (row as any).ROWID,
        guid: (row as any).guid,
        service: (row as any).service,
        isFromMe: (row as any).is_from_me,
        handleId: (row as any).handle_id,
        handleIdText: (row as any).handle_id_text,
        participants,
        attachments: messageAttachments,
        myIcloudAccount: realIcloudAccount,
        includeContactNames: this.config.includeContactNames,
      });
    }
  }

  private queryMessages() {
    let sql = `
      SELECT
        m.ROWID, m.guid, m.text, m.service, m.date, m.is_from_me, m.handle_id,
        m.attributedBody, h.id as handle_id_text, h.service as handle_service,
        cm.chat_id
      FROM
        message AS m
        LEFT OUTER JOIN handle AS h ON m.handle_id = h.ROWID
        INNER JOIN chat_message_join AS cm ON m.ROWID = cm.message_id`;

    // chat.db stores message.date as nanoseconds since the Apple epoch
    const { conditions, values } = timeRangeConditions('m.date', this.config, {
      convert: date =>
        (
          BigInt(date.getTime()) * 1_000_000n -
          BigInt(APPLE_EPOCH_OFFSET_SECONDS) * 1_000_000_000n
        ).toString(),
    });

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` ORDER BY m.date DESC`;

    const effectiveLimit = this.getEffectiveLimit();
    if (effectiveLimit !== null) {
      sql += ` LIMIT ?`;
      values.push(effectiveLimit);
    }

    const stmt = this.db!.prepare(sql);
    stmt.setReadBigInts(true);
    return stmt
      .all(...values)
      .map(row =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'bigint'
              ? key === 'date' || value > BigInt(Number.MAX_SAFE_INTEGER)
                ? value.toString()
                : Number(value)
              : value,
          ])
        )
      );
  }

  private loadChats(): { [key: string]: any[] } {
    const sql = `
      SELECT ch.chat_id, h.ROWID as handle_rowid, h.id, h.service as handle_service
      FROM chat_handle_join AS ch
      INNER JOIN handle AS h ON ch.handle_id = h.ROWID
      INNER JOIN chat AS c ON ch.chat_id = c.ROWID
    `;

    const stmt = this.db!.prepare(sql);
    const results = stmt.all() as any[];

    // Group handles by chat_id
    const chats: { [key: string]: any[] } = {};
    for (const row of results) {
      const chatId = row.chat_id;
      if (!chats[chatId]) {
        chats[chatId] = [];
      }
      chats[chatId].push({
        handleRowid: row.handle_rowid,
        id: row.id,
        service: row.handle_service,
      });
    }

    return chats;
  }

  private loadAttachments(): { [key: string]: any[] } {
    const sql = `
      SELECT 
        maj.message_id,
        a.ROWID as attachment_id,
        a.guid,
        a.filename,
        a.mime_type,
        a.uti,
        a.total_bytes,
        a.transfer_name,
        a.is_outgoing
      FROM message_attachment_join AS maj
      INNER JOIN attachment AS a ON maj.attachment_id = a.ROWID
      WHERE a.filename IS NOT NULL
    `;

    const stmt = this.db!.prepare(sql);
    const results = stmt.all() as any[];

    // Group attachments by message_id
    const attachments: { [key: string]: any[] } = {};
    for (const row of results) {
      const messageId = row.message_id;
      if (!attachments[messageId]) {
        attachments[messageId] = [];
      }
      attachments[messageId].push({
        attachmentId: row.attachment_id,
        guid: row.guid,
        filename: row.filename,
        mimeType: row.mime_type,
        uti: row.uti,
        totalBytes: row.total_bytes,
        transferName: row.transfer_name,
        isOutgoing: row.is_outgoing,
      });
    }

    return attachments;
  }

  private processAttributedBody(attributedBody: string | Uint8Array): string {
    if (!attributedBody) return '';

    attributedBody = (
      typeof attributedBody === 'string'
        ? Buffer.from(attributedBody, 'binary')
        : Buffer.from(attributedBody)
    ).toString('utf8');

    if (attributedBody.includes('NSNumber')) {
      attributedBody = attributedBody.split('NSNumber')[0];
      if (attributedBody.includes('NSString')) {
        attributedBody = attributedBody.split('NSString')[1];
        if (attributedBody.includes('NSDictionary')) {
          attributedBody = attributedBody.split('NSDictionary')[0];
          attributedBody = attributedBody.slice(6, -12);
        }
      }
    }

    return attributedBody;
  }
}
