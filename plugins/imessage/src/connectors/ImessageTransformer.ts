import {
  ChronicleTransformer,
  Record,
  normalizePhoneNumber,
  createMediaObject,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Message,
  MessageAction,
  AgentAndChildren,
  Person,
} from '@chronicle.app/schema';
import { lookupContact, buildICloudPersonSchema, type Contact } from '@chronicle.app/icloud';
import * as fs from 'node:fs';
import * as path from 'node:path';

export default class ImessageTransformer extends ChronicleTransformer {
  static override source = 'imessage';

  override async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'messages') {
      actions.push(...(await this.buildMessageAction(record)));
    }

    return actions;
  }

  private async buildMessageAction(record: Record): Promise<MessageAction[]> {
    const service = this.getServiceSource(record.context.service);
    const participants = this.buildParticipants(record);
    const myIdentity = await this.buildMyIdentity(record);
    const { agent, recipients } = this.determineAgentAndRecipients(
      record,
      participants,
      myIdentity
    );

    const obj: MessageAction = {
      '@type': 'MessageAction',
      timestamp: new Date(record.context.timestamp),
      source: service,
      sourceId: record.context.guid, // Use GUID instead of ROWID
      '@key': ['source', 'sourceId', '@type'],
      object: this.buildMessage(record, recipients),
      agent,
    };

    return [obj];
  }

  private buildMessage(record: Record, recipients: AgentAndChildren[]): Message {
    const messageSource = this.getServiceSource(record.context.service);
    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: messageSource, // Use service-based source (sms or imessage)
      sourceId: record.context.guid, // Use GUID for message identity
      body: this.normalizedBody(record),
    };

    // Add recipients if available
    if (recipients.length > 0) {
      message.recipient = recipients;
    }

    // Add attachments using contains property (following Bluesky pattern)
    const attachments = record.context.attachments || [];
    if (attachments.length > 0) {
      message.contains = this.processAttachments(attachments);
    }

    return message;
  }

  private buildParticipants(record: Record): AgentAndChildren[] {
    const agentSource = this.getAgentSource(record.context.service);
    const chatParticipants: { id: string }[] = record.context.participants || [];
    return chatParticipants.map(participant =>
      this.buildParticipantAgent(record, agentSource, participant.id)
    );
  }

  /**
   * One chat participant as an Agent in the service's identity namespace
   * (`icloud` for iMessage, `phone` for SMS), keyed on the handle exactly as
   * chat.db stores it — an email address or a phone number; no sourceId, since
   * the database carries no DSID. Linked by `sameAs` to the email identities the
   * same handle is known by, so the participant collapses with the person the
   * email plugin saw.
   */
  private buildParticipantAgent(record: Record, agentSource: string, handle: string): Agent {
    const contact = record.context.includeContactNames
      ? (this.config.lookupContact ?? lookupContact)(handle)
      : null;
    const sameAs = this.emailIdentities(handle, contact);
    return {
      '@type': 'Agent',
      source: agentSource,
      handle,
      name: contact?.fullName,
      '@key': ['@type', 'source', 'handle'],
      ...(sameAs.length > 0 ? { sameAs } : {}),
    };
  }

  /**
   * The `email`-namespace identities this participant is: the handle itself when
   * it is an email address (iMessage addresses people by their iCloud email),
   * plus every email on the AddressBook card the handle resolves to when contact
   * lookup is on. Each is a full entity-reference node keyed the way the email
   * plugin keys its own agents — `Agent` / `email` / the address as written, no
   * case folding on either side — so the fold merges the two through the shared
   * keyset. Only identifiers the source actually carries; one address spelled
   * more than once keeps its first spelling.
   */
  private emailIdentities(handle: string, contact: Contact | null): Agent[] {
    const candidates = [...(handle.includes('@') ? [handle] : []), ...(contact?.emails ?? [])];
    const seen = new Set<string>();
    const emails: string[] = [];
    for (const email of candidates) {
      const key = email.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
    return emails.map(email => ({
      '@type': 'Agent',
      source: 'email',
      handle: email,
      '@key': ['@type', 'source', 'handle'],
    }));
  }

  private async buildMyIdentity(record: Record): Promise<Person> {
    const { service } = record.context;
    const agentSource = this.getAgentSource(service);

    const identity =
      agentSource === 'icloud'
        ? ((await buildICloudPersonSchema(record.context.myIcloudAccount)) as Person)
        : this.buildMyPhoneIdentity(record);
    // Tag the account owner as self. The iCloud branch (buildICloudPersonSchema)
    // already self-tags, so add `@me` only when it isn't already present.
    const sameAs = identity?.sameAs ?? [];
    return { ...identity, sameAs: sameAs.includes('@me') ? sameAs : [...sameAs, '@me'] };
  }

  private buildMyPhoneIdentity(record?: Record): Person {
    // Try to find my phone number by matching my iCloud email in AddressBook
    if (record?.context?.myIcloudAccount?.email && record?.context?.includeContactNames) {
      const myContact = (this.config.lookupContact ?? lookupContact)(
        record.context.myIcloudAccount.email
      );
      if (myContact?.phoneNumbers && myContact.phoneNumbers.length > 0) {
        // Found my contact with phone numbers - use the first one (normalized)
        const normalizedPhone = normalizePhoneNumber(myContact.phoneNumbers[0]);
        if (normalizedPhone) {
          return {
            '@type': 'Person',
            source: 'phone',
            handle: normalizedPhone,
            '@key': ['@type', 'source', 'handle'],
          };
        }
      }
    }

    // Fallback when we can't determine my phone number
    // Still need a unique identifier - use iCloud email as fallback handle
    const fallbackHandle = record?.context?.myIcloudAccount?.email;
    if (fallbackHandle) {
      return {
        '@type': 'Person',
        source: 'phone',
        handle: fallbackHandle, // Use iCloud email as unique identifier
        '@key': ['@type', 'source', 'handle'],
      };
    }

    // Last resort - no unique info available
    return {
      '@type': 'Person',
      source: 'phone',
      '@key': ['@type', 'source'],
    };
  }

  private determineAgentAndRecipients(
    record: Record,
    participants: AgentAndChildren[],
    myIdentity: Person
  ): { agent: AgentAndChildren; recipients: AgentAndChildren[] } {
    const isFromMe = record.context.isFromMe === 1;

    if (isFromMe) {
      // I sent the message - I'm the agent, everyone else are recipients
      const recipients = myIdentity.handle
        ? participants.filter(p => p.handle !== myIdentity.handle)
        : participants; // If I have no handle (SMS fallback), all participants are recipients

      return {
        agent: myIdentity,
        recipients,
      };
    }
    // Someone else sent the message - find them as agent, I'm a recipient
    const { handleIdText } = record.context;
    const agent = participants.find(p => p.handle === handleIdText);

    if (!agent) {
      // The sender is not among the chat's participants: build them from the
      // message's own handle, the same way as any other participant.
      const agentSource = this.getAgentSource(record.context.service);
      return {
        agent: this.buildParticipantAgent(record, agentSource, handleIdText),
        recipients: [myIdentity],
      };
    }

    return {
      agent,
      recipients: [...participants.filter(p => p.handle !== agent.handle), myIdentity],
    };
  }

  private getServiceSource(_service: string): string {
    // All messages come from iMessage database, so use imessage source regardless of service type
    return 'imessage';
  }

  private getAgentSource(service: string): string {
    // For Person source - differentiates identity systems
    switch (service?.toLowerCase()) {
      case 'sms':
        return 'phone';
      case 'imessage':
      default:
        return 'icloud';
    }
  }

  private normalizedBody(record: Record): string {
    // Use text field first, fallback to processed attributedBody
    return record.data.text || record.context.attributedBody || '';
  }

  private processAttachments(attachments: any[]): any[] {
    const mediaObjects = [];

    for (const attachment of attachments) {
      try {
        const filePath = this.resolveAttachmentPath(attachment.filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
          console.warn(`Attachment file not found: ${filePath}`);
          continue;
        }

        // MIME drives the media object @type (ImageObject vs DocumentObject…).
        // chat.db's mime_type is NULL for some transfers (dynamic UTIs like
        // rich-link previews), so fall back to extension, then magic bytes.
        const mimeType =
          attachment.mimeType ||
          this.getMimeTypeFromExtension(filePath) ||
          this.sniffMimeType(this.readLeadingBytes(filePath)) ||
          'application/octet-stream';

        // Reference the file by path; ingest reads the bytes into the
        // attachment store — no base64 inflation through the pipeline.
        const mediaObject = createMediaObject({
          path: filePath,
          mimeType,
          description: attachment.transferName || path.basename(attachment.filename),
        });

        // Add iMessage attachment GUID for deduplication
        mediaObject.sourceId = attachment.guid;
        mediaObject.source = 'imessage';
        mediaObject['@key'] = ['source', 'sourceId'];

        mediaObjects.push(mediaObject);
      } catch (error) {
        console.warn(`Failed to process attachment ${attachment.filename}:`, error);
      }
    }

    return mediaObjects;
  }

  private getMimeTypeFromExtension(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.ico': 'image/x-icon',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.3gp': 'video/3gpp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.caf': 'audio/x-caf',
      '.amr': 'audio/amr',
      '.pdf': 'application/pdf',
      '.vcf': 'text/vcard',
    };
    return mimeTypes[ext];
  }

  /** First 16 bytes of a file — enough for every signature in sniffMimeType. */
  private readLeadingBytes(filePath: string): Buffer {
    const buf = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    try {
      const n = fs.readSync(fd, buf, 0, 16, 0);
      return buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Last-resort detection from magic bytes (e.g. rich-link previews with dyn.* UTIs). */
  private sniffMimeType(bytes: Buffer): string | undefined {
    const ascii = (start: number, text: string) =>
      bytes.length >= start + text.length &&
      bytes.toString('latin1', start, start + text.length) === text;

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return 'image/jpeg';
    if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(1, 'PNG')) return 'image/png';
    if (ascii(0, 'GIF8')) return 'image/gif';
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
    if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
    if (ascii(4, 'ftypheic') || ascii(4, 'ftypheix') || ascii(4, 'ftypmif1')) return 'image/heic';
    if (ascii(4, 'ftypqt')) return 'video/quicktime';
    if (ascii(4, 'ftypM4A')) return 'audio/mp4';
    if (ascii(4, 'ftyp')) return 'video/mp4';
    if (ascii(0, '%PDF')) return 'application/pdf';
    if (ascii(0, 'ID3')) return 'audio/mpeg';
    if (ascii(0, 'caff')) return 'audio/x-caf';
    if (ascii(0, '#!AMR')) return 'audio/amr';
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
      return 'image/x-icon';
    return undefined;
  }

  private resolveAttachmentPath(filename: string): string {
    // iMessage filename field contains paths like ~/Library/Messages/Attachments/...
    // Need to expand the ~ to the actual home directory
    if (filename.startsWith('~/')) {
      return path.join(process.env.HOME || '', filename.slice(2));
    }

    // If it's already an absolute path, use as-is
    if (path.isAbsolute(filename)) {
      return filename;
    }

    // Handle relative paths by prepending the standard iMessage attachments directory
    const attachmentsDir = path.join(process.env.HOME || '', 'Library', 'Messages', 'Attachments');
    return path.join(attachmentsDir, filename);
  }
}
