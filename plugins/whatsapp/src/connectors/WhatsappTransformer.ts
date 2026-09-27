import {
  ChronicleTransformer,
  Record,
  normalizePhoneNumber,
  createMediaObject,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AgentAndChildren,
  Channel,
  Message,
  MessageAction,
} from '@chronicle.app/schema';
import { lookupContactByPhone } from '@chronicle.app/icloud';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseJid } from '../jid.js';
import { whatsappPerson, whatsappAgent, whatsappChannel } from '../identity.js';

export default class WhatsappTransformer extends ChronicleTransformer {
  static override source = 'whatsapp';

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    return [this.buildMessageAction(record)];
  }

  private buildMessageAction(record: Record): MessageAction {
    const ctx = record.context;
    const { agent, recipients, channel } = this.resolveParticipants(record);

    return {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'whatsapp',
      sourceId: ctx.stanzaId,
      timestamp: new Date(ctx.timestamp).toISOString() as any,
      agent,
      object: this.buildMessage(record, recipients, channel),
    };
  }

  private buildMessage(record: Record, recipients: AgentAndChildren[], channel?: Channel): Message {
    const ctx = record.context;
    // The message type decides whether this is a real attachment. Link previews
    // and locations also carry a ZWAMEDIAITEM row but are not media.
    const mediaType = MEDIA_TYPE_BY_MESSAGE_TYPE[ctx.messageType];
    const caption = mediaType ? ctx.mediaCaption : undefined;

    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'whatsapp',
      sourceId: ctx.stanzaId,
    };

    // Text messages put their words in ZTEXT; media messages put the caption in
    // ZTITLE. Either is the body; a bodiless media message (a bare image, voice
    // note, etc.) omits it rather than carrying an empty string.
    const body = ctx.text || caption;
    if (body) message.body = body;

    if (recipients.length > 0) {
      message.recipient = recipients;
    }

    // A group message belongs to its group, modeled as a Channel (the conversation
    // container); 1:1 DMs have no Channel — their two participants describe them.
    if (channel) {
      message.isPartOf = [channel as any];
    }

    // A quoted reply points at the parent message by its stanza id, so it folds onto
    // the real parent Message node (or a stub, if that message isn't in the archive).
    if (ctx.replyToStanzaId) {
      message.inReplyTo = [
        {
          '@type': 'Message',
          source: 'whatsapp',
          sourceId: ctx.replyToStanzaId,
          '@key': ['@type', 'source', 'sourceId'],
        },
      ];
    }

    const media = mediaType ? this.buildMedia(ctx, mediaType) : null;
    if (media) {
      message.contains = [media];
    }

    return message;
  }

  /**
   * Sender, recipients, and (for groups) the Channel, from message direction:
   * - 1:1 outgoing: I send; the partner receives. No Channel.
   * - 1:1 incoming: the partner sends; I receive. No Channel.
   * - group: the sender is me (outgoing) or the member (incoming); the message
   *   `isPartOf` the group Channel and its recipients are the group's members.
   */
  private resolveParticipants(record: Record): {
    agent: AgentAndChildren;
    recipients: AgentAndChildren[];
    channel?: Channel;
  } {
    const ctx = record.context;
    const { me, lidToPhone } = ctx;
    const includeNames = ctx.includeContactNames;
    const resolve = (jid: any, name: any) => this.agentForJid(jid, name, includeNames, lidToPhone);

    if (ctx.isGroup) {
      // The group is a Channel the message `isPartOf`. Membership is a `member` edge
      // on the Channel (the roster, set once per group by the extractor), NOT a
      // per-message recipient — so the recipient stays consistent across acquisition
      // strategies (just me on incoming, nobody on outgoing) while the fuller/sparser
      // rosters from backup/companion fold onto the one Channel.
      const members = ((ctx.groupMembers ?? []) as { jid: string; name?: string }[])
        .map(m => resolve(m.jid, m.name))
        .filter((r): r is AgentAndChildren => r !== null);
      const channel = whatsappChannel(ctx.chatJid, ctx.counterpartName, members);
      const sender = ctx.isFromMe ? me : (resolve(ctx.senderJid, ctx.senderName) ?? me);
      return { agent: sender, recipients: ctx.isFromMe ? [] : [me], channel };
    }

    // 1:1 DM — the two participants describe it fully.
    const partner = resolve(ctx.chatJid, ctx.counterpartName);
    if (ctx.isFromMe) {
      return { agent: me, recipients: partner ? [partner] : [] };
    }
    return { agent: partner ?? me, recipients: [me] };
  }

  /**
   * Build an Agent from a JID. The WhatsApp account is always the identity —
   * `source: "whatsapp"`, keyed on the raw JID, a genuine WhatsApp-issued id we never
   * synthesize:
   * - individual / LID → `Person`
   * - group / anything else → `Agent`
   *
   * The phone number — carried directly by an individual JID, or recovered for a LID
   * from WhatsApp's own ContactsV2 map — rides along as a `sameAs` edge to the
   * portable `phone` namespace, NOT as the primary key. That lets this person merge
   * with the same number seen via iMessage/contacts through the sameAs fold, and lets
   * a person's phone-JID and LID identities converge on one phone hub, without ever
   * coercing the WhatsApp id into another namespace.
   *
   * Returns null when there is nothing real to key on.
   */
  private agentForJid(
    jid: string | null | undefined,
    nameHint: string | null | undefined,
    includeContactNames: boolean,
    lidToPhone?: Map<string, string>
  ): AgentAndChildren | null {
    const parsed = parseJid(jid);
    if (!parsed) return null;

    const isPerson = parsed.kind === 'individual' || parsed.kind === 'lid';
    if (!isPerson) return whatsappAgent(parsed.jid, nameHint);

    // The phone: from an individual JID directly, or a LID via the ContactsV2 map.
    const phone = parsed.phone ?? parseJid(lidToPhone?.get(parsed.jid))?.phone ?? null;
    const phoneHandle = phone ? normalizePhoneNumber(phone) : null;
    const contactName =
      phoneHandle && includeContactNames ? lookupContactByPhone(phoneHandle)?.fullName : undefined;

    return whatsappPerson({
      jid: parsed.jid,
      phoneHandle,
      name: contactName || nameHint,
    });
  }

  /**
   * The message's attachment. When the file is on disk it carries `contentPath`
   * (bytes captured at ingest); otherwise it's a placeholder with no bytes —
   * WhatsApp Desktop keeps only ~4% of media locally, so most are placeholders.
   *
   * Either way it is keyed by the owning message's `stanzaId`: a message has
   * exactly one attachment, and the stanzaId is the same on this companion DB and
   * on a future iPhone-backup DB — so a placeholder and the real file collapse to
   * one node when the backup is ingested. (ZVCARDNAME content hashes are absent on
   * ~86% of fileless media, so they can't serve as the merge key here.)
   */
  private buildMedia(ctx: any, type: string): any {
    const onDisk = Boolean(ctx.mediaLocalPath) && fs.existsSync(ctx.mediaLocalPath);

    const mediaObject = createMediaObject({
      type,
      description: ctx.mediaCaption || (onDisk ? path.basename(ctx.mediaLocalPath) : undefined),
      ...(onDisk
        ? {
            path: ctx.mediaLocalPath,
            mimeType: mimeFromExtension(ctx.mediaLocalPath),
          }
        : {}),
    });

    mediaObject.source = 'whatsapp';
    mediaObject.sourceId = ctx.stanzaId;
    mediaObject['@key'] = ['@type', 'source', 'sourceId'];
    return mediaObject;
  }
}

/** ZMESSAGETYPE → media object @type, from on-disk file extensions in a real DB. */
const MEDIA_TYPE_BY_MESSAGE_TYPE: { [type: number]: string } = {
  1: 'ImageObject',
  15: 'ImageObject', // stickers (.webp)
  2: 'VideoObject',
  11: 'VideoObject',
  23: 'VideoObject',
  3: 'AudioObject', // voice notes (.opus/.m4a)
  8: 'DocumentObject',
};

const EXTENSION_MIME: { [ext: string]: string } = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.3gp': 'video/3gpp',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.vcf': 'text/vcard',
};

function mimeFromExtension(filePath: string): string {
  return EXTENSION_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
