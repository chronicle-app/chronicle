import { Extractor, Record } from '@chronicle.app/etl';
import {
  countMbox,
  identityOf,
  parseMessage,
  readMbox,
  type MailMessage,
} from '@chronicle.app/email-core';
import { z } from 'zod';
import EmailTransformer from '../EmailTransformer.js';

export class EmailMboxExtractor extends Extractor<typeof EmailMboxExtractor> {
  static override source = 'email';
  static override description = 'Messages from an mbox file';
  static override delivery = 'export' as const;
  static override strategy = 'mbox';
  static override recordTypes = ['emails'];
  static override default = true;
  static override defaultTransformer = EmailTransformer;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the mbox file'),
    account: z
      .string()
      .optional()
      .describe("The mailbox's address: its mail is yours, as Gmail's own mailbox is"),
  });

  /**
   * The RFC 5322 Message-ID header — the message's own id, identical in any mail
   * tool. A message without one is keyed on the natural composite of its
   * sender, sent time, and subject: real source fields, never an invented id.
   * A message with neither has nothing to be identified by, and is skipped.
   * The transformer keys the same records on the same three facts.
   */
  override keyOf(record: Record): string | null {
    return identityOf(record.data as MailMessage);
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof EmailMboxExtractor.schema>;
    let count = 0;
    let unidentified = 0;
    let undated = 0;

    for await (const { raw, envelopeDate } of readMbox(config.input)) {
      const email = await parseMessage(raw);
      // No Date header: when its `From ` line says it arrived.
      email.date ??= envelopeDate;
      if (!email.date) {
        undated++;
        continue;
      }
      if (identityOf(email) === null) {
        // No Message-ID, and no From + parseable Date to compose a natural key
        // from: the source gives nothing real to identify this message by, and
        // a fabricated id would mint a new entity on every run. Skip and say so.
        unidentified++;
        continue;
      }
      if (config.since || config.until) {
        const sent = email.date ? new Date(email.date) : undefined;
        if (!sent) continue;
        if (config.since && sent < config.since) continue;
        if (config.until && sent > config.until) continue;
      }
      if (this.shouldStopExtracting(count)) break;

      yield this.createRecord(email, {
        messageId: email.messageId,
        from: email.from?.address,
        subject: email.subject,
        strategy: 'mbox',
        ...(config.account && { account: config.account.toLowerCase() }),
      });
      count++;
    }

    if (undated > 0) {
      this.logger.warn(`Skipped ${undated} message(s) with no date to place them by`);
    }
    if (unidentified > 0) {
      this.logger.warn(
        `Skipped ${unidentified} message(s) with no Message-ID and no From + Date to key on`
      );
    }
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof EmailMboxExtractor.schema>;
    try {
      return await countMbox(config.input);
    } catch {
      return null;
    }
  }
}
