import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { contactIdentities } from '@chronicle.app/google';
import { messageAction } from '@chronicle.app/mail';
import { ActionAndChildren, Thread } from '@chronicle.app/schema';
import type { GmailRecord } from '../types.js';

/**
 * A Gmail message is an email like any other (the shared mail nodes, keyed
 * by Message-ID across sources), with Gmail's thread and labels: it
 * `isPartOf` its `Thread` and its labels are its `tags`. Mail in Sent is
 * yours. A person on one of your contacts is `sameAs` the contact's other
 * addresses and phone numbers.
 */
export default class GmailTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const { mail, gmail, contacts } = record.data as GmailRecord;
    const thread: Thread | undefined = gmail.threadId
      ? {
          '@type': 'Thread',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'gmail',
          sourceId: gmail.threadId,
        }
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
      }),
    ];
  }
}
