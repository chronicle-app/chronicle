import type { Agent, Message, MessageAction, Thread } from '@chronicle.app/schema';
import type { MailAddress, MailMessage } from './parse.js';

/**
 * A message is named by its Message-ID in the `email` namespace: the
 * protocol's own identity, so the same email from Gmail, a Takeout, or any
 * mbox is one node, whichever plugin read it.
 */
const MESSAGE_KEY = ['@type', 'source', 'sourceId'];
/** Without a Message-ID: who sent it, when, and under what subject. */
const KEYLESS_MESSAGE_KEY = ['@type', 'source', 'action.timestamp', 'action.agent.handle', 'name'];
const KEYLESS_ACTION_KEY = ['@type', 'source', 'timestamp', 'agent.handle', 'object.name'];
/** Identifiers defined by the email protocol (RFC 5322) live in its namespace. */
const EMAIL = 'email';
/**
 * A person is their email address, in the `email` namespace: the identity
 * other plugins link a person's address to (iMessage, LinkedIn, Timing, …),
 * so every mail source and every link meets on one node.
 */
const ADDRESS_KEY = ['@type', 'source', 'handle'];

/**
 * Joins the parts of a composite identity. A control character that header
 * text cannot carry, so no From/Date/Subject combination can collide with
 * another by concatenation.
 */
const COMPOSITE_DELIMITER = '\u001F';

/**
 * A message's own identity: its Message-ID; without one, its sender, sent
 * time, and subject. Null when it has neither a Message-ID nor a sender and a
 * date: nothing real identifies it, and a made-up id would mint a new message
 * each run, so a source skips it.
 */
export function identityOf(mail: MailMessage): string | null {
  if (mail.messageId) return mail.messageId;
  if (!mail.from || !mail.date) return null;
  return [mail.from.address.toLowerCase(), mail.date, mail.subject].join(COMPOSITE_DELIMITER);
}

export interface MessageNodeOptions {
  /**
   * The mailbox owner's addresses: the sender or a recipient at one of them
   * is the owner (`@me`).
   */
  me?: string[];
  /** The source says the owner sent it (Gmail's Sent label), whatever the From says. */
  sentByMe?: boolean;
  /** When the message arrived, for one without a Date header. */
  receivedAt?: Date;
  /** The conversation the source puts it in. */
  thread?: Thread;
  /** The source's labels or folders for it. */
  tags?: string[];
  /**
   * Other identities of the person at an address (an address book's other
   * addresses and phone numbers for them), linked by `sameAs`.
   */
  identitiesOf?: (address: string) => Agent[];
}

/**
 * The sending of a message: a `MessageAction` by its sender, whose object is
 * the `Message`, with its recipients, the message it replies to, and its
 * thread and labels when the source has them.
 */
export function messageAction(mail: MailMessage, options: MessageNodeOptions = {}): MessageAction {
  const me = new Set((options.me ?? []).map(address => address.toLowerCase()));
  const isMe = (address: string) => me.has(address.toLowerCase());
  if (!mail.from) {
    throw new Error(`Email ${mail.messageId ?? '(no Message-ID)'} has no sender`);
  }
  const sentAt = mail.date ?? options.receivedAt?.toISOString();
  if (!sentAt) {
    throw new Error(`Email ${mail.messageId ?? '(no Message-ID)'} has no date`);
  }
  const identities = options.identitiesOf ?? (() => []);
  const sender = agent(
    mail.from,
    options.sentByMe || isMe(mail.from.address),
    identities(mail.from.address)
  );
  const recipients = dedupe([...mail.to, ...mail.cc, ...mail.bcc]).map(address =>
    agent(address, isMe(address.address), identities(address.address))
  );

  const message: Message = {
    '@type': 'Message',
    ...(mail.messageId
      ? { '@key': MESSAGE_KEY, source: EMAIL, sourceId: mail.messageId }
      : { '@key': KEYLESS_MESSAGE_KEY, source: EMAIL }),
    name: mail.subject,
    ...(mail.text && { body: mail.text }),
    author: [sender],
    ...(recipients.length > 0 && { recipient: recipients }),
    ...(mail.inReplyTo && {
      inReplyTo: [
        { '@type': 'Message', '@key': MESSAGE_KEY, source: EMAIL, sourceId: mail.inReplyTo },
      ],
    }),
    ...(options.thread && { isPartOf: [options.thread] }),
    ...(options.tags?.length && { tags: options.tags }),
  };

  return {
    '@type': 'MessageAction',
    ...(mail.messageId
      ? { '@key': MESSAGE_KEY, source: EMAIL, sourceId: mail.messageId }
      : { '@key': KEYLESS_ACTION_KEY, source: EMAIL }),
    timestamp: new Date(sentAt),
    agent: sender,
    object: message,
  };
}

/** A person by their address, lowercased so one person is one node. */
function agent(address: MailAddress, me: boolean, identities: Agent[] = []): Agent {
  const handle = address.address.toLowerCase();
  const sameAs: NonNullable<Agent['sameAs']> = [...(me ? ['@me'] : []), ...identities];
  return {
    '@type': 'Agent',
    '@key': ADDRESS_KEY,
    source: EMAIL,
    handle,
    name: address.name || handle,
    ...(sameAs.length > 0 && { sameAs }),
  };
}

/** Each address once: a person on both To and Cc is one recipient. */
function dedupe(addresses: MailAddress[]): MailAddress[] {
  const seen = new Set<string>();
  return addresses.filter(({ address }) => {
    const handle = address.toLowerCase();
    if (seen.has(handle)) return false;
    seen.add(handle);
    return true;
  });
}
