import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** A message in an mbox: its raw bytes, and when its `From ` line says it arrived. */
export interface MboxMessage {
  raw: Buffer;
  /** The envelope date as an ISO instant; null when the line has none. */
  envelopeDate: string | null;
}

/**
 * The messages in an mbox file, raw, one at a time: a Takeout of a whole
 * mailbox runs to gigabytes, so it's read as a stream, never whole.
 *
 * A message starts at a `From ` line at the top of the file or after a blank
 * line. A body line that began with `From ` was written as `>From `
 * (mboxrd), and gets its `>` back. Lines are read as latin1, which keeps
 * every byte as it was, so the parser sees the message's own bytes.
 */
export async function* readMbox(path: string): AsyncGenerator<MboxMessage> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let message: string[] | undefined;
  let envelopeDate: string | null = null;
  let blank = true;
  for await (const line of lines) {
    if (blank && line.startsWith('From ')) {
      if (message) yield { raw: Buffer.from(message.join('\n'), 'latin1'), envelopeDate };
      message = [];
      envelopeDate = envelopeDateOf(line);
    } else if (message) {
      message.push(/^>+From /.test(line) ? line.slice(1) : line);
    }
    blank = line === '';
  }
  if (message) yield { raw: Buffer.from(message.join('\n'), 'latin1'), envelopeDate };
}

/**
 * The date on a `From sender date` line: `Mon Mar 03 00:00:00 +0000 2025`
 * (Takeout) or `Mon Jan  6 10:00:00 2025` (asctime, read as UTC).
 */
function envelopeDateOf(line: string): string | null {
  const date = line.split(/\s+/).slice(2).join(' ');
  const zoned = /[+-]\d{4}|UTC|GMT/.test(date) ? date : `${date} UTC`;
  const at = Date.parse(zoned);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** How many messages an mbox file holds, by its `From ` lines, read as a stream. */
export async function countMbox(path: string): Promise<number> {
  let count = 0;
  let blank = true;
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (blank && line.startsWith('From ')) count++;
    blank = line === '';
  }
  return count;
}
