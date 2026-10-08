import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { contactIdentities, googleAccount } from '@chronicle.app/google';
import { messageAction } from '@chronicle.app/email-core';
import { ActionAndChildren, Thread } from '@chronicle.app/schema';
import type { GmailRecord } from '../types.js';

/**
 * A Gmail message is keyed by its Message-ID, so copies in other mailboxes
 * and mbox files are one message. It's `inAccount` the Google account the
 * mailbox is, and `sameAs` Gmail's own ID for it, which is only unique within
 * that account. It `isPartOf` its `Thread` and its labels are its `tags`. Mail
 * in Sent is yours, and you are `sameAs` the Google account. A person on one
 * of your contacts is `sameAs` the contact's other addresses and phone
 * numbers.
 */
export default class GmailTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const { mail, gmail, contacts } = record.data as GmailRecord;
    // The Google account the mailbox is, by its address. Gmail's IDs are
    // only unique within it, so they're keyed in it.
    const account = gmail.owner ? googleAccount(gmail.owner) : undefined;
    const inAccount = (sourceId: string) =>
      account
        ? {
            '@key': ['@type', 'source', 'inAccount[*].handle', 'sourceId'],
            source: 'gmail',
            sourceId,
            inAccount: [account],
          }
        : { '@key': ['@type', 'source', 'sourceId'], source: 'gmail', sourceId };
    const thread: Thread | undefined = gmail.threadId
      ? { '@type': 'Thread', ...inAccount(gmail.threadId) }
      : undefined;
    return [
      messageAction(mail, {
        me: gmail.owner ? [gmail.owner] : [],
        sentByMe: gmail.labels.includes('Sent'),
        ...(gmail.receivedAt && { receivedAt: new Date(gmail.receivedAt) }),
        ...(thread && { thread }),
        tags: gmail.labels,
        ...(account && { account }),
        // You are the Google account the mailbox is.
        meIdentities: account ? [account] : [],
        // Your contacts link a person to their other addresses and numbers.
        identitiesOf: address => contactIdentities(address, contacts?.[address.toLowerCase()]),
        // Gmail's own ID for the message in the account, linked by `sameAs`.
        ...(gmail.id &&
          account && {
            identity: { source: 'gmail', sourceId: gmail.id, inAccount: account },
          }),
      }),
    ];
  }
}
