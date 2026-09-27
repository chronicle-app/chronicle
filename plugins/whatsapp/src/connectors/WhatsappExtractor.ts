import { Delivery, Record, normalizePhoneNumber } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  safariToUnixTimestamp,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import {
  getICloudAccount,
  lookupContact,
  lookupContactByPhone,
  buildICloudPersonSchema,
} from '@chronicle.app/icloud';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import WhatsappTransformer from './WhatsappTransformer.js';
import { whatsappPerson, phoneToJid } from '../identity.js';
import { decodeReplyStanzaId } from '../replyTarget.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`;

/**
 * Message types that are system/notification noise rather than real
 * conversation, measured against a live ChatStorage.sqlite:
 *   6  = group event (subject/member/avatar changes)
 *   10 = system notification (E2E notice, "security code changed", etc.)
 * Their timestamps are often misleading (the 2021 "security code" rows on a
 * device linked in 2025), and most carry no body, so they are excluded.
 */
const SYSTEM_MESSAGE_TYPES = [6, 10];

/** Session types we ingest: 0 = one-to-one, 1 = group. (2 = broadcast, 3 = status are skipped.) */
const CONVERSATION_SESSION_TYPES = [0, 1];
const GROUP_SESSION_TYPE = 1;

export class WhatsappExtractor extends SqliteExtractor<typeof WhatsappExtractor> {
  static override recordTypes: string[] = ['messages'];
  static override source = 'whatsapp';
  static override description = 'Messages from the local macOS database';
  static override delivery: Delivery = 'local';
  static override strategy = 'app-db';
  static override default = true;
  // buildQuery orders by m.ZMESSAGEDATE DESC, which with keyOf opts this
  // extractor into the frontier cursor (incremental catch-up import).
  static override newestFirst = true;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .default(DEFAULT_DB)
      .describe('Path to the WhatsApp ChatStorage.sqlite database'),
    mediaDir: z
      .string()
      .optional()
      .describe(
        'Directory holding WhatsApp media (defaults to the "Message" folder beside the database)'
      ),
    includeContactNames: z
      .boolean()
      .optional()
      .default(true)
      .describe('Resolve contact names from the macOS AddressBook (default: true)'),
    selfNumber: z
      .string()
      .optional()
      .describe(
        'Your WhatsApp number in E.164 (e.g. +14165551234), used to identify your own messages. Defaults to the phone number on your macOS contact card.'
      ),
    contactsDb: z
      .string()
      .optional()
      .describe(
        "Path to WhatsApp's ContactsV2.sqlite (the LID→phone map). Defaults to the file beside the ChatStorage database; when absent, LIDs stay opaque."
      ),
    skipMedia: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Skip media entirely: don't materialize the backup's Message/ tree and emit attachments as placeholders (no bytes). Much faster — useful for testing message/identity logic."
      ),
  }) as any;

  static override defaultTransformer = WhatsappTransformer;

  /** The stanza id — WhatsApp's own message id, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { stanzaId?: string }).stanzaId ?? null;
  }

  /** Where media files live; relative ZMEDIALOCALPATH values resolve against this. */
  private mediaRoot(): string {
    const cfg = this.config as any;
    return cfg.mediaDir || path.join(path.dirname(cfg.input), 'Message');
  }

  /** Path to WhatsApp's ContactsV2.sqlite (LID→phone map); beside ChatStorage by default. */
  private contactsDbPath(): string {
    const cfg = this.config as any;
    return cfg.contactsDb || path.join(path.dirname(cfg.input), 'ContactsV2.sqlite');
  }

  override async determineCount(): Promise<number | null> {
    const { sql, values } = this.buildQuery({ count: true });
    const row = this.db!.prepare(sql).get(...values) as { n: number } | undefined;
    return row?.n ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    const mediaRoot = this.mediaRoot();
    const { includeContactNames } = this.config as any;
    const pushNames = this.loadPushNames();
    const lidToPhone = this.loadLidToPhone();
    const groupRosters = this.loadGroupMembers(pushNames);
    const rosterEmitted = new Set<string>();
    const me = await this.resolveMe(pushNames);

    const { sql, values } = this.buildQuery({ count: false });
    // Stream rows with a cursor (.iterate) rather than materializing the whole
    // result set (.all) — a full-history iPhone backup is ~360k messages. The lookup
    // tables above are already loaded and nothing in the loop queries the DB, so the
    // open cursor is safe across yields.
    const rows = this.db!.prepare(sql).iterate(...values) as IterableIterator<any>;

    for (const row of rows) {
      const isFromMe = row.isFromMe === 1;
      const isGroup = row.sessionType === GROUP_SESSION_TYPE;

      // The group's member roster, attached to the Channel — but only once per group
      // (on the first message we see for it), so it lands on the Channel without being
      // stamped onto every message. Both strategies run this same path.
      let groupMembers: { jid: string; name?: string }[] | undefined;
      if (isGroup && !rosterEmitted.has(row.chatJid)) {
        rosterEmitted.add(row.chatJid);
        groupMembers = groupRosters.get(row.chatJid) ?? [];
      }

      // The human sender's JID. In groups the member is in ZGROUPMEMBER
      // (ZFROMJID there is just the group); in 1:1 it is ZFROMJID (≈ the session).
      const senderJid = isFromMe
        ? null
        : isGroup
          ? row.memberJid || row.fromJid
          : row.fromJid || row.chatJid;

      // Resolve a relative ZMEDIALOCALPATH against the media root; null when the
      // file isn't on disk (the common case — WhatsApp Desktop keeps ~4% locally).
      // Whether this counts as a real attachment is decided by the message TYPE in
      // the transformer (most messages carry a ZWAMEDIAITEM row — link previews,
      // locations — that are not attachments).
      const mediaLocalPath =
        (this.config as any).skipMedia || !row.mediaLocalPath
          ? null
          : path.isAbsolute(row.mediaLocalPath)
            ? row.mediaLocalPath
            : path.join(mediaRoot, row.mediaLocalPath);

      yield this.createRecord(row, {
        // ZMESSAGEDATE is seconds since the 2001 epoch (Core Foundation time),
        // NOT nanoseconds like iMessage's chat.db — convert with the seconds-based
        // helper and store milliseconds for `new Date(...)`.
        timestamp: safariToUnixTimestamp(row.messageDate) * 1000,
        stanzaId: row.stanzaId,
        isFromMe,
        isGroup,
        senderJid,
        senderName: senderJid ? pushNames.get(senderJid) : undefined,
        chatJid: row.chatJid,
        counterpartName: row.partnerName || pushNames.get(row.chatJid),
        text: row.text,
        messageType: row.messageType,
        mediaLocalPath,
        // WhatsApp stores photo/video CAPTIONS in ZWAMEDIAITEM.ZTITLE (never in
        // ZTEXT). Carried independently of the file so a captioned-but-fileless
        // image still keeps its words.
        mediaCaption: row.mediaTitle,
        // Stanza id of the message this one is a quoted reply to, or null. Decoded
        // from the media-item metadata blob (covers nearly all replies), falling back
        // to the sparse ZPARENTMESSAGE link. The transformer keys the reply target on
        // it so it folds onto the real parent Message node.
        replyToStanzaId: decodeReplyStanzaId(row.replyMeta) ?? row.parentStanzaId ?? null,
        me,
        includeContactNames,
        // WhatsApp's own LID→phone-JID map (from ContactsV2). Lets the transformer
        // resolve a privacy LID to the portable phone identity so it merges with the
        // same person seen by number. Same Map reference on every record.
        lidToPhone,
        // Group roster for the Channel's member edge; set only on the first message
        // seen per group (undefined otherwise).
        groupMembers,
      });
    }
  }

  /**
   * LID (`<id>@lid`) → phone JID (`<number>@s.whatsapp.net`), from WhatsApp's own
   * ContactsV2 address book (`ZWAADDRESSBOOKCONTACT.ZLID` ↔ `ZWHATSAPPID`). This is
   * a genuine WhatsApp-issued association, not a synthesized one — so resolving a LID
   * to its number is sound. Contacts with no LID, or LIDs for non-contacts, are
   * simply absent and stay opaque. Empty when ContactsV2 is not present.
   */
  private loadLidToPhone(): Map<string, string> {
    const dbPath = this.contactsDbPath();
    if (!fs.existsSync(dbPath)) return new Map();

    const contacts = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = contacts
        .prepare(
          `SELECT ZLID AS lid, ZWHATSAPPID AS phoneJid FROM ZWAADDRESSBOOKCONTACT
           WHERE ZLID IS NOT NULL AND ZLID <> ''
             AND ZWHATSAPPID IS NOT NULL AND ZWHATSAPPID <> ''`
        )
        .all() as { lid: string; phoneJid: string }[];
      return new Map(rows.map(r => [r.lid, r.phoneJid]));
    } catch {
      // Old/foreign ContactsV2 without the LID columns: no map, LIDs stay opaque.
      return new Map();
    } finally {
      contacts.close();
    }
  }

  /**
   * Identity for the account owner ("me"), keyed exactly like every other person:
   * `source: "whatsapp"` on the WhatsApp JID, with the phone number as a `sameAs`
   * edge. The owner's own JID is not stored in ChatStorage.sqlite, but a WhatsApp
   * account IS its phone-number JID (`<number>@s.whatsapp.net`), so we reconstruct it
   * from the number (a real WhatsApp id, not synthesized), resolved in priority order:
   *   1. the `selfNumber` config override (your WhatsApp number, E.164);
   *   2. the phone number on your macOS "me" contact card (what iMessage uses);
   *   3. a last-resort iCloud identity, only if no number can be determined.
   */
  private async resolveMe(pushNames: Map<string, string>): Promise<any> {
    const cfg = this.config as any;

    if (cfg.selfNumber) {
      const handle = normalizePhoneNumber(cfg.selfNumber);
      if (handle) {
        // Name for "me": my AddressBook entry, else my own WhatsApp push name.
        const name =
          (cfg.includeContactNames ? lookupContactByPhone(handle)?.fullName : undefined) ||
          pushNames.get(phoneToJid(handle));
        return this.meFromPhone(handle, name);
      }
      this.logger.info(`Ignoring invalid selfNumber: ${cfg.selfNumber}`);
    }

    if (cfg.includeContactNames) {
      const account = await getICloudAccount();
      const myCard = account?.email ? lookupContact(account.email) : null;
      const handle = myCard?.phoneNumbers?.[0]
        ? normalizePhoneNumber(myCard.phoneNumbers[0])
        : null;
      if (handle) return this.meFromPhone(handle, myCard?.fullName);
    }

    // Could not determine a phone number; fall back to the iCloud identity, which
    // buildICloudPersonSchema already tags onto the self hub (sameAs: ["@me"]).
    return buildICloudPersonSchema();
  }

  /**
   * Build "me" from an E.164 number: a `whatsapp`-keyed Person on the phone-number
   * JID with the phone as a `sameAs` edge — the same shape {@link whatsappPerson}
   * gives every other person, so "you" across WhatsApp/iMessage/etc. fold together
   * through the phone hub.
   */
  private meFromPhone(handle: string, name?: string): any {
    // Tag the account owner as self only here, not in whatsappPerson, which
    // builds every other participant too.
    const owner = whatsappPerson({
      jid: phoneToJid(handle),
      phoneHandle: handle,
      name,
    });
    return { ...owner, sameAs: [...(owner.sameAs ?? []), '@me'] };
  }

  /**
   * Group `@g.us` JID → its member roster (`{ jid, name }`), from ZWAGROUPMEMBER —
   * the membership edge on the group's Channel. A current snapshot of participants
   * (the owner isn't listed). The companion DB carries only a partial roster and the
   * iPhone backup the full one; both feed the same Channel, so the fold unions them.
   * Member names prefer the group's stored contact name, then the WhatsApp push name.
   */
  private loadGroupMembers(
    pushNames: Map<string, string>
  ): Map<string, { jid: string; name?: string }[]> {
    const rows = this.db!.prepare(
      `SELECT s.ZCONTACTJID AS groupJid, gm.ZMEMBERJID AS jid, gm.ZCONTACTNAME AS name
       FROM ZWAGROUPMEMBER gm
       JOIN ZWACHATSESSION s ON gm.ZCHATSESSION = s.Z_PK
       WHERE s.ZSESSIONTYPE = ${GROUP_SESSION_TYPE} AND gm.ZMEMBERJID IS NOT NULL`
    ).all() as { groupJid: string; jid: string; name: string | null }[];

    const byGroup = new Map<string, { jid: string; name?: string }[]>();
    for (const r of rows) {
      const roster = byGroup.get(r.groupJid) ?? [];
      roster.push({ jid: r.jid, name: r.name || pushNames.get(r.jid) });
      byGroup.set(r.groupJid, roster);
    }
    return byGroup;
  }

  /**
   * JID → WhatsApp display ("push") name. ZWAPROFILEPUSHNAME is the only name
   * source for LID members, who have no phone and no AddressBook entry.
   */
  private loadPushNames(): Map<string, string> {
    const rows = this.db!.prepare(
      `SELECT ZJID AS jid, ZPUSHNAME AS name FROM ZWAPROFILEPUSHNAME
       WHERE ZPUSHNAME IS NOT NULL AND ZPUSHNAME <> ''`
    ).all() as { jid: string; name: string }[];
    return new Map(rows.map(r => [r.jid, r.name]));
  }

  /**
   * Shared query builder for both the row scan and the count. Keeps the WHERE
   * clause (the definition of "a real message") in one place.
   */
  private buildQuery({ count }: { count: boolean }): {
    sql: string;
    values: any[];
  } {
    const selectCols = count
      ? 'COUNT(*) AS n'
      : `
        m.ZSTANZAID        AS stanzaId,
        m.ZTEXT            AS text,
        m.ZMESSAGEDATE     AS messageDate,
        m.ZISFROMME        AS isFromMe,
        m.ZMESSAGETYPE     AS messageType,
        m.ZFROMJID         AS fromJid,
        s.ZCONTACTJID      AS chatJid,
        s.ZSESSIONTYPE     AS sessionType,
        s.ZPARTNERNAME     AS partnerName,
        gm.ZMEMBERJID      AS memberJid,
        md.ZMEDIALOCALPATH AS mediaLocalPath,
        md.ZTITLE          AS mediaTitle,
        md.ZMETADATA       AS replyMeta,
        parent.ZSTANZAID   AS parentStanzaId`;

    let sql = `
      SELECT ${selectCols}
      FROM ZWAMESSAGE m
      JOIN ZWACHATSESSION s ON m.ZCHATSESSION = s.Z_PK
      LEFT JOIN ZWAMEDIAITEM md ON md.ZMESSAGE = m.Z_PK
      LEFT JOIN ZWAGROUPMEMBER gm ON m.ZGROUPMEMBER = gm.Z_PK
      LEFT JOIN ZWAMESSAGE parent ON m.ZPARENTMESSAGE = parent.Z_PK
        AND parent.ZSTANZAID IS NOT NULL
      WHERE m.ZSTANZAID IS NOT NULL
        AND m.ZMESSAGETYPE NOT IN (${SYSTEM_MESSAGE_TYPES.join(',')})
        AND s.ZSESSIONTYPE IN (${CONVERSATION_SESSION_TYPES.join(',')})
        AND ((m.ZTEXT IS NOT NULL AND m.ZTEXT <> '') OR m.ZMEDIAITEM IS NOT NULL)`;

    const values: any[] = [];

    const range = timeRangeConditions('m.ZMESSAGEDATE', this.config, {
      convert: date => unixToSafariTimestamp(date.getTime() / 1000),
    });
    sql += range.conditions.map(c => ` AND ${c}`).join('');
    values.push(...range.values);

    if (!count) {
      sql += ` ORDER BY m.ZMESSAGEDATE DESC`;
      const limit = this.getEffectiveLimit();
      if (limit !== null) {
        sql += ` LIMIT ?`;
        values.push(limit);
      }
    }

    return { sql, values };
  }
}
