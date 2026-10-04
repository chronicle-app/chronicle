import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { messageAction, type MailMessage } from '@chronicle.app/mail';
import { ActionAndChildren } from '@chronicle.app/schema';

export default class EmailTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'emails') return [];
    return [messageAction(record.data as MailMessage)];
  }
}
