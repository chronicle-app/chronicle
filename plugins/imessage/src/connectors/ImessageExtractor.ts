import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  countsByMonth,
  iosToUnixTimestamp,
  monthSql,
  timeRangeConditions,
  APPLE_EPOCH_OFFSET_SECONDS,
} from '@chronicle.app/etl-sqlite';
import { GROUP_CHAT_STYLE, getICloudAccount, type GroupChatIds } from '@chronicle.app/apple';
import ImessageTransformer from './ImessageTransformer.js';
import { z } from 'zod';

export class ImessageExtractor extends SqliteExtractor<typeof ImessageExtractor> {
  static override recordTypes: string[] = ['messages'];
  static override source = 'imessage';
  static override description = 'Messages and attachments from chat.db';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override default = true;
  // What extract() and survey() read, which a chat.db must have.
  static override databases = [
    {
      tables: {
        message: [
          'ROWID',
          'guid',
          'text',
          'service',
          'date',
          'is_from_me',
          'handle_id',
          'attributedBody',
          'item_type?',
        ],
        handle: ['ROWID', 'id', 'service'],
        chat: ['ROWID', 'style', 'display_name?', 'group_id?', 'original_group_id?'],
        chat_message_join: ['chat_id', 'message_id'],
        chat_handle_join: ['chat_id', 'handle_id'],
        message_attachment_join: ['message_id', 'attachment_id'],
        attachment: [
          'ROWID',
          'guid',
          'filename',
          'mime_type',
          'uti',
          'total_bytes',
          'transfer_name',
          'is_outgoing',
          'hide_attachment?',
        ],
      },
    },
  ];

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
    const groups = this.loadGroups();
    const rows = this.queryMessages();
    const attachments = this.loadAttachments();

    // Get real iCloud account info automatically
    const realIcloudAccount =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    // The group chats whose roster a message has carried, so each goes on its
    // Channel once, on the first message seen in it, not on every message.
    const rostered = new Set<number>();

    for (const row of rows) {
      const chatId = (row as any).chat_id;
      const group = groups[chatId];
      const groupRoster = group !== undefined && !rostered.has(chatId);
      if (groupRoster) rostered.add(chatId);
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
        group,
        groupRoster,
        myIcloudAccount: realIcloudAccount,
        includeContactNames: this.config.includeContactNames,
      });
    }
  }

  /** The messages a run reads, one per chat they're in, and when, from three aggregates. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const { conditions, values } = this.messageFilter();
    const inRange = conditions.map(condition => ` AND ${condition}`).join('');
    // A message's chats, as the run joins them, and only those in range.
    const read = `SELECT 1 FROM message AS m INNER JOIN chat_message_join AS cm ON m.ROWID = cm.message_id`;
    const messages = this.db!.prepare(
      `SELECT COUNT(*) AS n, MIN(m.date) AS first, MAX(m.date) AS last
      FROM message AS m INNER JOIN chat_message_join AS cm ON m.ROWID = cm.message_id
      WHERE 1${inRange}`
    );
    messages.setReadBigInts(true);
    const { n, first, last } = messages.get(...values) as { [column: string]: bigint | null };
    const { chats } = this.db!.prepare(
      `SELECT COUNT(*) AS chats FROM chat WHERE EXISTS (${read} WHERE cm.chat_id = chat.ROWID${inRange})`
    ).get(...values) as { chats: number };
    const { bytes } = this.db!.prepare(
      `SELECT COALESCE(SUM(a.total_bytes), 0) AS bytes
      FROM message_attachment_join AS maj INNER JOIN attachment AS a ON maj.attachment_id = a.ROWID
      WHERE ${this.attachmentFilter()} AND EXISTS (${read} WHERE m.ROWID = maj.message_id${inRange})`
    ).get(...values) as { bytes: number };
    const at = (date: bigint | null) =>
      date === null ? undefined : new Date(iosToUnixTimestamp(Number(date)));
    const count = Number(n);
    const month = monthSql(`m.date / 1000000000 + ${APPLE_EPOCH_OFFSET_SECONDS}`);
    const byMonth =
      options.byMonth &&
      countsByMonth(
        this.db!.prepare(
          `SELECT ${month} AS month, COUNT(*) AS n
          FROM message AS m INNER JOIN chat_message_join AS cm ON m.ROWID = cm.message_id
          WHERE 1${inRange} GROUP BY month`
        ).all(...values) as Array<{ month: string | null; n: number }>
      );
    return {
      messages: {
        count,
        ...(count > 0 && { earliest: at(first), latest: at(last) }),
        ...(byMonth && { byMonth }),
        measures: [
          { key: 'conversations', label: 'conversations', value: chats },
          { key: 'attachmentBytes', label: 'attachments', value: bytes, unit: 'bytes' },
        ],
      },
    };
  }

  /**
   * Messages within since and until. chat.db stores message.date as nanoseconds
   * since the Apple epoch. A system event, such as a group being renamed or
   * someone joining it, is a row too, with no text and often no sender, so
   * only rows that are messages (`item_type` 0) are read.
   */
  private messageFilter(): { conditions: string[]; values: Array<number | string> } {
    const filter = timeRangeConditions('m.date', this.config, {
      convert: date =>
        (
          BigInt(date.getTime()) * 1_000_000n -
          BigInt(APPLE_EPOCH_OFFSET_SECONDS) * 1_000_000_000n
        ).toString(),
    });
    if (this.has('message.item_type')) filter.conditions.push('m.item_type = 0');
    return filter;
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

    const { conditions, values } = this.messageFilter();
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

  /**
   * The group chats, by chat, with their names and Apple's IDs for them. An
   * older Messages without a column has none of what it holds.
   */
  private loadGroups(): { [key: string]: GroupChatIds & { name: string | null } } {
    const rows = this.db!.prepare(
      `SELECT ROWID AS chat_id, ${this.chatColumn('display_name')} AS name,
        ${this.chatColumn('group_id')} AS group_id,
        ${this.chatColumn('original_group_id')} AS original_group_id
      FROM chat WHERE style = ?`
    ).all(GROUP_CHAT_STYLE) as any[];

    const groups: { [key: string]: GroupChatIds & { name: string | null } } = {};
    for (const row of rows) {
      groups[row.chat_id] = {
        name: row.name?.trim() || null,
        groupId: row.group_id,
        originalGroupId: row.original_group_id,
      };
    }
    return groups;
  }

  /** A column of `chat` the schema marks optional, or NULL when this Messages has none. */
  private chatColumn(name: string): string {
    return this.has(`chat.${name}`) ? name : 'NULL';
  }

  /**
   * The attachments a run reads: files Messages shows. It keeps others hidden,
   * such as the images and icon of a link preview, which no one sent.
   */
  private attachmentFilter(): string {
    const shown = this.has('attachment.hide_attachment')
      ? ' AND COALESCE(a.hide_attachment, 0) = 0'
      : '';
    return `a.filename IS NOT NULL${shown}`;
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
      WHERE ${this.attachmentFilter()}
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
