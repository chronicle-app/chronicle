import { Extractor, InputNotFound, Record } from '@chronicle.app/etl';
import { ContactDirectory, contactOptions, googleAccountOptions } from '@chronicle.app/google';
import { countMbox, identityOf, parseMessage, readMbox } from '@chronicle.app/email-core';
import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { z } from 'zod';
import { filterOptions, matches, narrows } from '../filters.js';
import { hexId, takeoutLabels } from '../labels.js';
import type { GmailRecord } from '../types.js';
import GmailTransformer from './GmailTransformer.js';

/**
 * Your Gmail from a Google Takeout: the mbox it exports (`All mail Including
 * Spam and Trash.mbox`). Each message keeps the thread and labels Gmail wrote
 * into its `X-GM-THRID` and `X-Gmail-Labels` headers, so it becomes the same
 * record the API makes.
 */
export class GmailTakeoutExtractor extends Extractor<typeof GmailTakeoutExtractor> {
  static override source = 'gmail';
  static override description = 'Messages in a Google Takeout of your Gmail';
  static override delivery = 'export' as const;
  static override strategy = 'takeout';
  static override recordTypes = ['messages'];
  static override defaultTransformer = GmailTransformer;

  // `input` is checked when it's read rather than by the schema: a source's
  // flags are shared, so a schema-required flag here would also gate the API.
  static override schema = Extractor.schema.extend({
    ...googleAccountOptions,
    ...contactOptions,
    ...filterOptions,
    input: z.string().optional().describe('Path to the Gmail mbox from Google Takeout'),
  });

  private contacts = ContactDirectory.empty;

  /**
   * A Takeout needs no sign-in; with `--link-contacts` and a sign-in, your
   * contacts link the people in it as the API's do.
   */
  override async setup(): Promise<void> {
    await super.setup();
    const { account, accessToken, linkContacts } = this.options;
    this.contacts = (await ContactDirectory.load({ account, accessToken, linkContacts })).directory;
  }

  override keyOf(record: Record): string | null {
    return identityOf((record.data as GmailRecord).mail);
  }

  override occurredAt(record: Record): Date | undefined {
    const { date } = (record.data as GmailRecord).mail;
    return date ? new Date(date) : undefined;
  }

  private get options() {
    return this.config as z.infer<typeof GmailTakeoutExtractor.schema>;
  }

  private get input(): string {
    if (this.options.query) {
      throw new ExtractorError('A Gmail search needs the API', {
        code: 'unsupported-flag',
        exitCode: EXIT_CODES.usage,
        hint: 'Use `--label` or `--sent` with a Takeout instead.',
      });
    }
    if (!this.options.input) {
      throw new InputNotFound('No Takeout mbox given', {
        hint: 'Pass the Gmail mbox from your Takeout with `--input <path>`.',
      });
    }
    return this.options.input;
  }

  override async determineCount(): Promise<number | null> {
    if (narrows(this.options)) return null;
    try {
      const total = await countMbox(this.input);
      const limit = this.getEffectiveLimit();
      return limit === null ? total : Math.min(total, limit);
    } catch {
      return null;
    }
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    let unidentified = 0;
    let undated = 0;
    for await (const { raw, envelopeDate } of readMbox(this.input)) {
      const mail = await parseMessage(raw);
      // No Date header: when its `From ` line says Gmail received it.
      mail.date ??= envelopeDate;
      if (!mail.date) {
        undated++;
        continue;
      }
      if (identityOf(mail) === null) {
        unidentified++;
        continue;
      }
      const labels = takeoutLabels(mail.headers['x-gmail-labels']);
      // A draft hasn't been sent: it isn't a message yet.
      if (labels.includes('Drafts') || !matches(mail, labels, this.options)) continue;
      const record: GmailRecord = {
        mail,
        gmail: {
          id: hexId(mail.headers['x-gm-msgid']),
          threadId: hexId(mail.headers['x-gm-thrid']),
          labels,
          receivedAt: envelopeDate,
          // Gmail writes the mailbox's own address on every message it
          // delivers; a message you sent has none, but it's from you.
          owner:
            addressIn(mail.headers['delivered-to']) ??
            (labels.includes('Sent') ? (mail.from?.address.toLowerCase() ?? null) : null),
        },
        contacts: this.contacts.linksFor(
          [mail.from, ...mail.to, ...mail.cc, ...mail.bcc].flatMap(person =>
            person ? [person.address] : []
          )
        ),
      };
      yield this.createRecord(record, { recordType: 'messages' });
      if (this.shouldStopExtracting(++count)) break;
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

  override recordToString(data?: GmailRecord): string {
    return data?.mail?.subject || 'gmail.messages';
  }
}

/** The address in a header like `Delivered-To: me@example.com`. */
function addressIn(header: string | undefined): string | null {
  return header?.match(/[^\s<>,"]+@[^\s<>,"]+/)?.[0]?.toLowerCase() ?? null;
}
