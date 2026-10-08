import type { ContactLinks } from '@chronicle.app/google';
import type { MailMessage } from '@chronicle.app/email-core';

/** One extracted record: the message, and what Gmail knows about it. */
export interface GmailRecord {
  mail: MailMessage;
  gmail: {
    /** Gmail's message ID, in hex. */
    id: string | null;
    /** Gmail's thread ID, in hex: the API's and a Takeout's agree. */
    threadId: string | null;
    /** Label names, as Gmail shows them. */
    labels: string[];
    /** When Gmail received it: the API's internal date, or a Takeout's `From ` line. */
    receivedAt: string | null;
    /** The mailbox's own address: the API's profile, or a Takeout's Delivered-To. */
    owner: string | null;
    /** The mailbox account's Gaia id, from Google's userinfo (API only). */
    ownerGaiaId?: string | null;
  };
  /** What your contacts link each address on it to (API only). */
  contacts?: { [address: string]: ContactLinks };
}
