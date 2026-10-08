import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { mailbox, messageAction, type MailMessage } from '@chronicle.app/email-core';
import { ActionAndChildren } from '@chronicle.app/schema';

/**
 * A message from an mbox. With the mailbox's address (`account`), you are
 * `@me` there, and the message is `sameAs` its copy in the mailbox at that
 * address, the mailbox Gmail's copies of the same mail are in.
 */
export default class EmailTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'emails') return [];
    const { account } = (record.context ?? {}) as { account?: string };
    return [
      messageAction(
        record.data as MailMessage,
        account ? { me: [account], mailbox: mailbox(account) } : {}
      ),
    ];
  }
}
