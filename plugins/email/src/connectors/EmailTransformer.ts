import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, Agent, Message, MessageAction } from '@chronicle.app/schema';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const parseEmailAddresses = require('emailjs-addressparser').default;

export default class EmailTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'emails') {
      actions.push(...this.buildEmailActions(record));
    }

    return actions;
  }

  private buildEmailActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];
    const emailData = record.data;

    // Build sender person with email address as handle
    const sender = this.buildPersonFromEmail(emailData.from);

    // Build recipient persons
    const recipients = [
      ...emailData.to.map((email: string) => this.buildPersonFromEmail(email)),
      ...emailData.cc.map((email: string) => this.buildPersonFromEmail(email)),
      ...emailData.bcc.map((email: string) => this.buildPersonFromEmail(email)),
    ];

    // Every action requires a valid agent
    if (!sender) {
      throw new Error(
        `Invalid or missing sender in email ${emailData.messageId ?? '(no Message-ID)'}: ${emailData.from}`
      );
    }

    // Identity. The Message-ID is the source's own id and stays `sourceId`. A
    // message without one (common in early-2000s mail) is keyed on the natural
    // composite of who sent it, when, and under what subject — the same three
    // real headers the extractor's keyOf composes, read here off the
    // transformed fields: the MessageAction carries them directly, the Message
    // reaches the first two through its carrying action (`action.*`). Dotted
    // paths to scalars only; a whole nested node in a key couples identity to
    // every mutable attribute of that node.
    const messageId: string | null = emailData.messageId || null;
    const timestamp = emailData.date ? new Date(emailData.date) : new Date();
    if (!messageId && (!emailData.date || Number.isNaN(timestamp.getTime()))) {
      throw new Error(
        `Email without a Message-ID needs a parseable Date to be identified: ${emailData.from} / ${emailData.subject}`
      );
    }

    // Build email message entity
    const emailMessage: Message = {
      '@type': 'Message',
      source: 'email',
      ...(messageId && { sourceId: messageId }),
      name: emailData.subject,
      description: emailData.body,
      recipient: recipients.filter(Boolean),
      author: [sender],
      '@key': messageId
        ? ['@type', 'source', 'sourceId']
        : ['@type', 'source', 'action.timestamp', 'action.agent.handle', 'name'],
    };

    const messageAction: MessageAction = {
      '@type': 'MessageAction',
      timestamp,
      source: 'email',
      ...(messageId && { sourceId: messageId }),
      '@key': messageId
        ? ['source', 'sourceId', '@type']
        : ['@type', 'source', 'timestamp', 'agent.handle', 'object.name'],
      agent: sender,
      object: emailMessage,
    };

    actions.push(messageAction);

    return actions;
  }

  private buildPersonFromEmail(emailString: string): Agent | null {
    if (!emailString?.trim()) return null;

    try {
      const parsed = parseEmailAddresses(emailString);
      if (!parsed || parsed.length === 0) return null;

      // Take the first parsed address
      const address = parsed[0];

      return {
        '@type': 'Agent',
        source: 'email',
        handle: address.address, // Clean email address
        name: address.name || address.address, // Use name if available, fallback to email
        '@key': ['@type', 'source', 'handle'],
      };
    } catch {
      // Log and skip malformed addresses
      this.logger.warn('Failed to parse email address', { address: emailString });
      return null;
    }
  }
}
