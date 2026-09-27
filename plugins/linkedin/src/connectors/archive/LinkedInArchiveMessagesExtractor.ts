import { htmlToText, Record } from '@chronicle.app/etl';
import { memberName, parseSpaceStamp, profileHandle, profileUrl } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/** A party to a message: the handle when LinkedIn gave one, the name when it did not. */
export interface MessageParty {
  handle?: string;
  name?: string;
  url?: string;
}

/**
 * `messages.csv` — every LinkedIn message, newest-first, grouped by the
 * conversation id LinkedIn assigns.
 *
 * **Names and profile URLs cannot be zipped together.** A group thread lists
 * every participant's name in `TO` but only publishes URLs for the ones you may
 * see, so the two comma-separated lists routinely differ in length and the
 * n-th name is not the n-th URL. Pairing them positionally would attach real
 * people to the wrong profiles. So the parties come from the URLs, which are
 * real identifiers; the names ride along only when both lists are the same
 * length, where the correspondence is unambiguous.
 *
 * **A quarter of the bodies are HTML, and none of it is stored.** Sponsored
 * InMail and templated LinkedIn notices arrive as the message editor's raw
 * markup. `htmlToText` turns each back into the text a reader saw — keeping a
 * link's URL as well as its label, since these anchors mostly say "here" — so
 * a `Message` body is what was said and not how it was styled.
 *
 * **Attachments do not survive the export.** The `ATTACHMENTS` column holds
 * signed `linkedin.com/dms/…` URLs that carry an expiry and a per-export token:
 * the link dies long before the archive is old, and an entity keyed on it would
 * mint a fresh identity every time you export. The bytes themselves are not in
 * the ZIP. `hasAttachment` therefore rides the record for a future pass to use,
 * and the transformer writes nothing for it — better a gap than a dead link
 * dressed as a file.
 */
export class LinkedInArchiveMessagesExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveMessagesExtractor
> {
  static override description = 'Messages';
  static override recordTypes = ['messages'];
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    const rows = await this.readCsv('messages.csv');

    const messages = rows
      .map(row => {
        const senderHandle = profileHandle(row['SENDER PROFILE URL']);
        const senderName = memberName(row.FROM);
        return {
          conversationId: row['CONVERSATION ID']?.trim() || undefined,
          conversationTitle: row['CONVERSATION TITLE']?.trim() || undefined,
          sender: party(senderHandle, senderName),
          recipients: parties(row.TO, row['RECIPIENT PROFILE URLS']),
          subject: htmlToText(row.SUBJECT),
          content: htmlToText(row.CONTENT),
          folder: row.FOLDER?.trim() || undefined,
          hasAttachment: Boolean(row.ATTACHMENTS?.trim()),
          sentAt: parseSpaceStamp(row.DATE),
        };
      })
      // The conversation and the moment are what make a message findable again;
      // a row missing either is not a message we can place.
      .filter(message => message.conversationId && message.sentAt)
      .sort((a, b) => ((a.sentAt ?? '') < (b.sentAt ?? '') ? 1 : -1));

    let count = 0;
    for (const message of messages) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(message.sentAt)) continue;
      yield this.createRecordWithArchiveContext({
        ...message,
        occurredAt: message.sentAt,
      });
      count++;
    }
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('messages.csv')).length;
  }
}

/** One party, or nothing when LinkedIn identified them neither way. */
function party(handle: string | undefined, name: string | undefined): MessageParty | undefined {
  if (!handle && !name) return undefined;
  return {
    ...(handle && { handle, url: profileUrl(handle) }),
    ...(name && { name }),
  };
}

/**
 * The recipients of one message. Handles come from the URL list; names are
 * attached only when the two lists line up one-for-one (see the class note).
 */
function parties(rawNames: string | undefined, rawUrls: string | undefined): MessageParty[] {
  const names = splitList(rawNames).map(name => memberName(name));
  const handles = splitList(rawUrls).flatMap(url => profileHandle(url) ?? []);

  if (handles.length === 0) {
    return names.flatMap(name => (name ? [{ name }] : []));
  }

  const aligned = names.length === handles.length;
  return handles.map((handle, index) => ({
    handle,
    url: profileUrl(handle),
    ...(aligned && names[index] && { name: names[index] }),
  }));
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}
