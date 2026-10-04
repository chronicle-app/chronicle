import PostalMime, { decodeWords, type Address } from 'postal-mime';
import { messageBody } from './body.js';

/** A person on a message: their address, and the name they gave, if any. */
export interface MailAddress {
  address: string;
  name?: string;
}

/**
 * One email, as a mail source reads it: its envelope, its text, and the names
 * of its attachments. Plain data, so it can be a raw record.
 */
export interface MailMessage {
  /** The Message-ID header, angle brackets and all; null when there is none. */
  messageId: string | null;
  /** The Date header as an ISO instant; null when there is none or it doesn't parse. */
  date: string | null;
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  /** The Message-ID this replies to (In-Reply-To). */
  inReplyTo: string | null;
  /** The conversation's earlier Message-IDs, oldest first (References). */
  references: string[];
  /**
   * What the sender wrote, as plain text or Markdown: no HTML, quoted
   * history, or signature. See `messageBody`.
   */
  text: string;
  attachments: { filename: string | null; mimeType: string }[];
  /**
   * The headers a source reads, by lowercase name: the envelope, threading,
   * mailing list, and Gmail's own. Routing and signing headers (`Received`,
   * `DKIM-Signature`, …) are left out: they're most of a header block, and
   * nothing reads them.
   */
  headers: Record<string, string>;
}

/**
 * Parse an RFC 5322 message, MIME and all: encoded words, quoted-printable
 * and base64 bodies, and multipart alternatives are decoded.
 */
export async function parseMessage(raw: Uint8Array | string): Promise<MailMessage> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'base64' });
  const date = email.date && !Number.isNaN(Date.parse(email.date)) ? email.date : null;
  return {
    messageId: email.messageId?.trim() || null,
    date: date && new Date(date).toISOString(),
    subject: email.subject ?? '',
    from: mailboxes(email.from ? [email.from] : [])[0] ?? null,
    to: mailboxes(email.to),
    cc: mailboxes(email.cc),
    bcc: mailboxes(email.bcc),
    // The Message-ID in it: some clients write words around it.
    inReplyTo: email.inReplyTo?.match(/<[^>]+>/)?.[0] ?? (email.inReplyTo?.trim() || null),
    references: email.references?.match(/<[^>]+>/g) ?? [],
    text: messageBody(email, { bulk: isBulk(email.headers) }),
    attachments: email.attachments
      .filter(attachment => attachment.disposition === 'attachment' || attachment.filename)
      .map(({ filename, mimeType }) => ({ filename, mimeType })),
    headers: keptHeaders(email.headers),
  };
}

/**
 * The headers kept, decoded (a Takeout writes a label like `Café` as an
 * encoded word). Where one repeats, the first is kept: it's the one added
 * last, on arrival in this mailbox, so a forwarded message's `Delivered-To`
 * is this mailbox's address, not the one it was forwarded from.
 */
function keptHeaders(headers: { key: string; value: string }[]): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const { key, value } of headers) {
    if (Object.hasOwn(kept, key)) continue;
    if (KEPT_HEADERS.has(key) || key.startsWith('x-gm')) kept[key] = decodeWords(value);
  }
  return kept;
}

const KEPT_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'delivered-to',
  'subject',
  'date',
  'message-id',
  'in-reply-to',
  'references',
  'list-id',
  'list-unsubscribe',
  'precedence',
]);

/** Mail sent to a list: a newsletter or a notification, by its list headers. */
function isBulk(headers: { key: string; value: string }[]): boolean {
  return headers.some(
    ({ key, value }) =>
      key === 'list-unsubscribe' ||
      key === 'list-id' ||
      (key === 'precedence' && /bulk|list/i.test(value))
  );
}

/** Addresses, with groups opened up, and a name only where one was given. */
function mailboxes(addresses: Address[] | undefined): MailAddress[] {
  return (addresses ?? [])
    .flatMap(address => address.group ?? [address])
    .filter(mailbox => mailbox.address)
    .map(mailbox => ({
      address: mailbox.address,
      ...(mailbox.name && { name: mailbox.name }),
    }));
}
