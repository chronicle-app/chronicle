import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { contactIdentities, googleAccount } from '@chronicle.app/google';
import { mailbox as mailboxAt, messageAction } from '@chronicle.app/email-core';
import { ActionAndChildren, Realm, Thread } from '@chronicle.app/schema';
import type { GmailRecord } from '../types.js';

/**
 * A Gmail message is keyed by its Message-ID, so copies in other mailboxes
 * and mbox files are one message, and is `sameAs` Gmail's own ID for it in
 * the mailbox (a `Realm` at its address, `sameAs` the Google account's). It `isPartOf` its `Thread` and
 * its labels are its `tags`. Mail in Sent is
 * yours, and you are `sameAs` the Google account the mailbox is. A person on
 * one of your contacts is `sameAs` the contact's other addresses and phone
 * numbers.
 */
export default class GmailTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const { mail, gmail, contacts } = record.data as GmailRecord;
    // Gmail's IDs are only unique within a mailbox, so they're keyed in it:
    // the mailbox at its address, as an mbox of the same mail names it, which
    // is the Google account's.
    const mailbox: Realm | undefined = gmail.owner
      ? {
          ...mailboxAt(gmail.owner),
          sameAs: [
            {
              '@type': 'Realm',
              '@key': ['@type', 'source', 'handle'],
              source: 'google-account',
              handle: gmail.owner.toLowerCase(),
            },
          ],
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
        // You are the Google account the mailbox is.
        meIdentities: gmail.owner ? [googleAccount(gmail.owner)] : [],
        // Your contacts link a person to their other addresses and numbers.
        identitiesOf: address => contactIdentities(address, contacts?.[address.toLowerCase()]),
        // Gmail's own ID for the message in this mailbox, linked by `sameAs`.
        ...(gmail.id &&
          mailbox && {
            identity: { source: 'gmail', sourceId: gmail.id, inRealm: mailbox },
          }),
      }),
    ];
  }
}
