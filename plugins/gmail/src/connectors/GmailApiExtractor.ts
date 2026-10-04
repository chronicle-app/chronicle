import { Extractor, Record } from '@chronicle.app/etl';
import { ContactDirectory, GoogleApi, googleAccountOptions } from '@chronicle.app/google';
import { identityOf, parseMessage } from '@chronicle.app/mail';
import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { z } from 'zod';
import {
  filterOptions,
  gmailSearch,
  includesSpamTrash,
  narrows,
  wantedLabels,
} from '../filters.js';
import { labelId, labelName } from '../labels.js';
import type { GmailRecord } from '../types.js';
import GmailTransformer from './GmailTransformer.js';

/** Messages fetched at once. */
const CONCURRENCY = 10;

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  /** When Gmail received it, in epoch milliseconds. */
  internalDate: string;
  /** The whole RFC 5322 message, base64url. */
  raw: string;
}

/**
 * Your Gmail, newest first, through the Gmail API. Each message is fetched
 * whole and parsed like any email, with Gmail's thread and labels.
 */
export class GmailApiExtractor extends Extractor<typeof GmailApiExtractor> {
  static override source = 'gmail';
  static override description = 'Messages in your Gmail';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['messages'];
  static override default = true;
  static override newestFirst = true;
  static override defaultTransformer = GmailTransformer;
  /** Swapped for a fake server in tests. */
  static apiBaseURL = 'https://gmail.googleapis.com/gmail/v1';
  /**
   * The least time a batch takes. Fetching a message costs 5 of the 6,000
   * units Gmail allows a user each minute, so a batch of 10 every half second
   * stays inside it however long a run goes. Tests set it to 0.
   */
  static batchIntervalMs = 500;

  static override schema = Extractor.schema.extend({
    ...googleAccountOptions,
    ...filterOptions,
    // A Takeout's; listed here too, since a source's flags are shared.
    input: z.string().optional().describe('Path to the Gmail mbox from Google Takeout'),
  });

  private api!: GoogleApi;
  private contacts = ContactDirectory.empty;
  private labelNames = new Map<string, string>();
  private owner: string | null = null;

  override keyOf(record: Record): string | null {
    return identityOf((record.data as GmailRecord).mail);
  }

  override occurredAt(record: Record): Date | undefined {
    const { mail, gmail } = record.data as GmailRecord;
    const at = gmail.receivedAt ?? mail.date;
    return at ? new Date(at) : undefined;
  }

  private get options() {
    return this.config as z.infer<typeof GmailApiExtractor.schema>;
  }

  override async setup(): Promise<void> {
    await super.setup();
    const { account, accessToken } = this.options;
    this.api = new GoogleApi({
      service: 'gmail',
      baseURL: GmailApiExtractor.apiBaseURL,
      account,
      accessToken,
    });
    await this.api.initialize();
    const [profile, labels] = await Promise.all([
      this.api.get<{ emailAddress?: string }>('/users/me/profile'),
      this.api.get<{ labels?: { id: string; name: string }[] }>('/users/me/labels'),
    ]);
    this.owner = profile.emailAddress ?? null;
    for (const label of labels.labels ?? []) this.labelNames.set(label.id, label.name);
    const { directory, missing } = await ContactDirectory.load({ account, accessToken });
    this.contacts = directory;
    if (missing) {
      this.hint('Your contacts aren’t linked to these people', {
        action: 'Run `chronicle auth login google --add contacts` to link them.',
      });
    }
  }

  override async determineCount(): Promise<number | null> {
    // Only the whole mailbox has a count without listing it.
    if (narrows(this.options)) return null;
    const profile = await this.api.get<{ messagesTotal?: number }>('/users/me/profile');
    const total = profile.messagesTotal ?? null;
    const limit = this.getEffectiveLimit();
    return total !== null && limit !== null ? Math.min(total, limit) : total;
  }

  async *extract(): AsyncGenerator<Record> {
    const ids = this.api.pages<{ id: string }>(
      '/users/me/messages',
      {
        q: gmailSearch(this.options),
        labelIds: this.labelIds(),
        includeSpamTrash: includesSpamTrash(this.options),
        maxResults: 500,
      },
      'messages'
    );
    let count = 0;
    let unidentified = 0;
    let batch: string[] = [];

    // Fetched a batch at a time, and yielded in the order Gmail listed them.
    const flush = async function* (this: GmailApiExtractor) {
      const started = Date.now();
      // A message deleted between the listing and the fetch is just gone.
      const messages = await Promise.all(
        batch.map(id =>
          this.api.get<RawMessage>(`/users/me/messages/${id}`, { format: 'raw' }).catch(error => {
            if ((error as { code?: string })?.code === 'not-found') return null;
            throw error;
          })
        )
      );
      const wait = GmailApiExtractor.batchIntervalMs - (Date.now() - started);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      batch = [];
      for (const message of messages) {
        // A draft hasn't been sent: it isn't a message yet.
        if (!message || message.labelIds?.includes('DRAFT')) continue;
        const record = await this.recordOf(message);
        if (!record) {
          unidentified++;
          continue;
        }
        yield this.createRecord(record, { recordType: 'messages' });
        if (this.shouldStopExtracting(++count)) return true;
      }
      return false;
    }.bind(this);

    try {
      for await (const { id } of ids) {
        batch.push(id);
        if (batch.length < CONCURRENCY) continue;
        if (yield* flush()) return;
      }
      if (batch.length > 0) yield* flush();
    } finally {
      if (unidentified > 0) {
        this.logger.warn(
          `Skipped ${unidentified} message(s) with no Message-ID and no From + Date to key on`
        );
      }
    }
  }

  /** The label IDs every message must have: `--label`, and Sent for `--sent`. */
  private labelIds(): string[] | undefined {
    const ids = wantedLabels(this.options).map(name => {
      const id = labelId(name, this.labelNames);
      if (!id) {
        throw new ExtractorError(`Gmail has no label "${name}"`, {
          code: 'unknown-label',
          exitCode: EXIT_CODES.usage,
          hint: `Your labels are ${[...this.labelNames.values()].sort().join(', ')}.`,
        });
      }
      return id;
    });
    return ids.length > 0 ? ids : undefined;
  }

  private async recordOf(message: RawMessage): Promise<GmailRecord | null> {
    const mail = await parseMessage(Buffer.from(message.raw, 'base64url'));
    // Nothing real to identify it by: a made-up id would mint a new message each run.
    if (identityOf(mail) === null) return null;
    return {
      mail,
      gmail: {
        id: message.id,
        threadId: message.threadId,
        labels: (message.labelIds ?? [])
          .map(id => labelName(id, this.labelNames))
          .filter((name): name is string => name !== undefined),
        receivedAt: new Date(Number(message.internalDate)).toISOString(),
        owner: this.owner,
      },
      contacts: this.contacts.linksFor(
        [mail.from, ...mail.to, ...mail.cc, ...mail.bcc].flatMap(person =>
          person ? [person.address] : []
        )
      ),
    };
  }

  override recordToString(data?: GmailRecord): string {
    return data?.mail?.subject || 'gmail.messages';
  }
}
