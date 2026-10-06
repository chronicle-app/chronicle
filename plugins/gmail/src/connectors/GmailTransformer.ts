import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { contactIdentities } from '@chronicle.app/google';
import { messageAction } from '@chronicle.app/email-core';
import { ActionAndChildren, Realm, Thread } from '@chronicle.app/schema';
import type { GmailRecord } from '../types.js';

/**
 * A Gmail message is this mailbox's copy of an email: keyed by Gmail's own
 * ID in the mailbox (a `Realm` for the account), carrying what Gmail reported,
 * and `sameAs` the Message-ID every copy shares, so copies in other
 * mailboxes and mbox files are one message. It `isPartOf` its `Thread` and
 * its labels are its `tags`. Mail in Sent is
 * yours. A person on one of your contacts is `sameAs` the contact's other
 * addresses and phone numbers.
 */
export default class GmailTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const { mail, gmail, contacts } = record.data as GmailRecord;
    // Gmail's IDs are only unique within a mailbox, so they're keyed in it.
    const mailbox: Realm | undefined = gmail.owner
      ? {
          '@type': 'Realm',
          '@key': ['@type', 'source', 'handle'],
          source: 'gmail',
          handle: gmail.owner,
        }
      : undefined;
    const inMailbox = (sourceId: string) =>
      mailbox
        ? {
            '@key': ['@type', 'source', 'inRealm.handle', 'sourceId'],
            source: 'gmail',
            sourceId,
            inRealm: mailbox,
          }
        : { '@key': ['@type', 'source', 'sourceId'], source: 'gmail', sourceId };
    const thread: Thread | undefined = gmail.threadId
      ? { '@type': 'Thread', ...inMailbox(gmail.threadId) }
      : undefined;
    return [
      messageAction(mail, {
        me: gmail.owner ? [gmail.owner] : [],
        sentByMe: gmail.labels.includes('Sent'),
        ...(gmail.receivedAt && { receivedAt: new Date(gmail.receivedAt) }),
        ...(thread && { thread }),
        tags: gmail.labels,
        // Your contacts link a person to their other addresses and numbers.
        identitiesOf: address => contactIdentities(address, contacts?.[address.toLowerCase()]),
        // The message is this mailbox's copy, with Gmail's own ID; it's
        // `sameAs` the Message-ID every copy shares.
        ...(gmail.id &&
          mailbox && {
            identity: { source: 'gmail', sourceId: gmail.id, inRealm: mailbox },
          }),
      }),
    ];
  }
}
