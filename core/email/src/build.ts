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
 * A Message-ID as an identifier: without the angle brackets RFC 5322 writes
 * around it, as JMAP and `mid:` URIs give it, so every source keys it alike.
 */
function msgId(header: string): string {
  return header.replace(/^<(.*)>$/, '$1');
}

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
  /**
   * The owner's other identities, such as the account the mailbox is,
   * linked by `sameAs` from every agent that's the owner.
   */
  meIdentities?: Agent[];
  /** The account the source read the message from: the message is `inAccount` it. */
  account?: Agent;
  /**
   * The source's own identity for its copy of the message (Gmail's message
   * ID), linked by `sameAs`, keyed within the account that issued it. The
   * message stays keyed by its Message-ID, which every copy shares.
   */
  identity?: { source: string; sourceId: string; inAccount?: Agent };
}

/**
 * The sending of a message: a `MessageAction` by its sender, whose object is
 * the `Message`, with its recipients, the message it replies to, and its
 * thread and labels when the source has them. The sending happened once, so
 * the action is keyed by the Message-ID wherever the message is read, as the
 * message is.
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
  const person = (address: MailAddress, owner: boolean) =>
    agent(address, owner, [
      ...(owner ? (options.meIdentities ?? []) : []),
      ...identities(address.address),
    ]);
  const sender = person(mail.from, options.sentByMe || isMe(mail.from.address));
  const recipients = dedupe([...mail.to, ...mail.cc, ...mail.bcc]).map(address =>
    person(address, isMe(address.address))
  );

  const messageId = mail.messageId && msgId(mail.messageId);
  const { identity } = options;
  const copy: Message | undefined = identity && {
    '@type': 'Message',
    '@key': identity.inAccount
      ? ['@type', 'source', 'inAccount[*].handle', 'sourceId']
      : ['@type', 'source', 'sourceId'],
    source: identity.source,
    sourceId: identity.sourceId,
    ...(identity.inAccount && { inAccount: [identity.inAccount] }),
  };
  const message: Message = {
    '@type': 'Message',
    ...(messageId
      ? { '@key': MESSAGE_KEY, source: EMAIL, sourceId: messageId }
      : { '@key': KEYLESS_MESSAGE_KEY, source: EMAIL }),
    ...(copy && { sameAs: [copy] }),
    ...(options.account && { inAccount: [options.account] }),
    name: mail.subject,
    ...(mail.text && { body: mail.text }),
    // The sender in full is the action's agent; here, the same node by its key.
    author: [reference(sender)],
    ...(recipients.length > 0 && { recipient: recipients }),
    ...(mail.inReplyTo && {
      inReplyTo: [
        { '@type': 'Message', '@key': MESSAGE_KEY, source: EMAIL, sourceId: msgId(mail.inReplyTo) },
      ],
    }),
    ...(options.thread && { isPartOf: [options.thread] }),
    ...(options.tags?.length && { tags: options.tags }),
  };

  return {
    '@type': 'MessageAction',
    ...(messageId
      ? { '@key': MESSAGE_KEY, source: EMAIL, sourceId: messageId }
      : { '@key': KEYLESS_ACTION_KEY, source: EMAIL }),
    timestamp: new Date(sentAt),
    agent: sender,
    object: message,
  };
}

/**
 * An email account by its address, keyed as a person is: the account a
 * message is `inAccount`, whatever service holds it.
 */
export function emailAccount(address: string): Agent {
  return {
    '@type': 'Agent',
    '@key': ADDRESS_KEY,
    source: EMAIL,
    handle: address.toLowerCase(),
  };
}

/** A node written in full elsewhere in the record, by its key alone. */
function reference(agent: Agent): Agent {
  return {
    '@type': agent['@type'],
    '@key': agent['@key'],
    source: agent.source,
    handle: agent.handle,
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
