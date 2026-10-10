import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { contactIdentities, googleAccount } from '@chronicle.app/google';
import { emailAccount, messageAction } from '@chronicle.app/email-core';
import { ActionAndChildren, Thread } from '@chronicle.app/schema';
import type { GmailRecord } from '../types.js';

/**
 * A Gmail message is keyed by its Message-ID, so copies in other mailboxes
 * and mbox files are one message. It's `inAccount` the mailbox's address,
 * as any mail source of the same mailbox says, and you are `sameAs` the
 * Google account at that address. It `isPartOf` its `Thread`, whose ID the
 * Google account issued, so the thread is `inAccount` it and keyed within
 * it. Its labels are its `tags`. Mail in Sent is yours. A person on one of
 * your contacts is `sameAs` the contact's other addresses and phone numbers.
 */
export default class GmailTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const { mail, gmail, contacts } = record.data as GmailRecord;
    // The account at the mailbox's address, which any mail source can name,
    // and the Google account, which issues Gmail's thread IDs: they're only
    // unique within it, so they're keyed in it.
    const account = gmail.owner ? emailAccount(gmail.owner) : undefined;
    const google = gmail.owner ? googleAccount(gmail.owner) : undefined;
    const thread: Thread | undefined = gmail.threadId
      ? {
          '@type': 'Thread',
          source: 'gmail',
          sourceId: gmail.threadId,
          ...(google
            ? {
                '@key': ['@type', 'source', 'inAccount[*].handle', 'sourceId'],
                inAccount: [google],
              }
            : { '@key': ['@type', 'source', 'sourceId'] }),
        }
      : undefined;
    return [
      messageAction(mail, {
        me: gmail.owner ? [gmail.owner] : [],
        sentByMe: gmail.labels.includes('Sent'),
        ...(gmail.receivedAt && { receivedAt: new Date(gmail.receivedAt) }),
        ...(thread && { thread }),
        tags: gmail.labels,
        ...(account && { account }),
        // You are the Google account at the mailbox's address.
        meIdentities: google ? [google] : [],
        // Your contacts link a person to their other addresses and numbers.
        identitiesOf: address =>
          contactIdentities(address, contacts?.[address.toLowerCase()], gmail.owner),
      }),
    ];
  }
}
