import { Extractor, Record } from '@chronicle.app/etl';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createRequire } from 'node:module';
import EmailTransformer from '../EmailTransformer.js';

const require = createRequire(import.meta.url);
const { Libmime } = require('libmime');
const libmime = new Libmime();

/**
 * Joins the parts of a composite key. A control character that RFC 5322 header
 * text cannot carry, so no From/Date/Subject combination can collide with
 * another by concatenation.
 */
const COMPOSITE_DELIMITER = '\u001F';

interface MboxEmail {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  date: string;
  /** The RFC 5322 Message-ID header, or null when the message carries none. */
  messageId: string | null;
  body: string;
  headers: { [key: string]: string };
}

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
  });

  /**
   * The RFC 5322 Message-ID header — the message's own id, identical in any mail
   * tool. A message without one is keyed on the natural composite of its From,
   * Date, and Subject headers: real source fields, never an invented id. That
   * needs From and a Date that parses; a message with neither has nothing to be
   * identified by, and parseMbox never emits it. EmailTransformer keys the same
   * records on the same three facts (sender handle, sent time, subject).
   */
  override keyOf(record: Record): string | null {
    return EmailMboxExtractor.identityOf((record.data as MboxEmail).headers);
  }

  /**
   * Message-ID when present; otherwise `From␟Date␟Subject` over the raw
   * headers (Subject may be empty and still takes part); null when there is no
   * From or no parseable Date to compose.
   */
  static identityOf(headers: { [key: string]: string }): string | null {
    const messageId = headers['message-id'];
    if (messageId) return messageId;
    const { from, date } = headers;
    if (!from || !date || Number.isNaN(new Date(date).getTime())) return null;
    return [from, date, headers.subject ?? ''].join(COMPOSITE_DELIMITER);
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof EmailMboxExtractor.schema>;

    try {
      const content = await readFile(config.input, 'utf-8');
      const emails = this.parseMbox(content);

      let count = 0;
      for (const email of emails) {
        // Apply date filtering if configured
        if (config.since || config.until) {
          const emailDate = new Date(email.date);
          if (config.since && emailDate < config.since) continue;
          if (config.until && emailDate > config.until) continue;
        }

        // Apply limit if configured
        if (this.shouldStopExtracting(count)) break;

        yield this.createRecord(email, {
          messageId: email.messageId,
          from: email.from,
          subject: email.subject,
          strategy: 'mbox',
        });
        count++;
      }
    } catch (error) {
      throw new Error(`Failed to read mbox file: ${error}`);
    }
  }

  private parseMbox(content: string): MboxEmail[] {
    const emails: MboxEmail[] = [];
    let unidentified = 0;
    const messages = content.split(/^From /m);

    // Skip the first element if it's empty (before the first "From " line)
    const validMessages = messages.slice(1);

    for (const message of validMessages) {
      const email = this.parseMessage('From ' + message);
      if (!email) continue;
      if (EmailMboxExtractor.identityOf(email.headers) === null) {
        // No Message-ID, and no From + parseable Date to compose a natural key
        // from: the source gives nothing real to identify this message by, and
        // a fabricated id would mint a new entity on every run. Skip and say so.
        unidentified++;
        continue;
      }
      emails.push(email);
    }

    if (unidentified > 0) {
      this.logger.warn(
        `Skipped ${unidentified} message(s) with no Message-ID and no From + Date to key on`
      );
    }

    return emails;
  }

  private parseMessage(message: string): MboxEmail | null {
    const lines = message.split('\n');
    const headers: { [key: string]: string } = {};
    let headerSection = true;
    const bodyLines: string[] = [];

    for (const line of lines) {
      if (headerSection) {
        if (line.trim() === '') {
          headerSection = false;
          continue;
        }

        // Handle multi-line headers
        if (line.startsWith(' ') || line.startsWith('\t')) {
          const lastHeader = Object.keys(headers).pop();
          if (lastHeader) {
            headers[lastHeader] += ' ' + line.trim();
          }
          continue;
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, Math.max(0, colonIndex)).trim().toLowerCase();
          const value = line.slice(Math.max(0, colonIndex + 1)).trim();
          headers[key] = value;
        }
      } else {
        bodyLines.push(line);
      }
    }

    // Extract required fields
    const from = headers.from || '';
    const to = this.parseEmailList(headers.to || '');
    const cc = this.parseEmailList(headers.cc || '');
    const bcc = this.parseEmailList(headers.bcc || '');
    const subject = this.decodeMimeHeader(headers.subject || '');
    const date = headers.date || '';
    const messageId = headers['message-id'] ?? null;
    const body = this.extractTextContent(bodyLines, headers);

    if (!from && !subject) {
      return null; // Skip invalid messages
    }

    return {
      from,
      to,
      cc,
      bcc,
      subject,
      date,
      messageId,
      body,
      headers,
    };
  }

  private extractTextContent(bodyLines: string[], headers: { [key: string]: string }): string {
    const contentType = headers['content-type'] || '';

    // If not multipart, return the body as-is
    if (!contentType.toLowerCase().includes('multipart')) {
      return bodyLines.join('\n').trim();
    }

    // Extract boundary from Content-Type header
    const boundaryMatch = contentType.match(/boundary=["']?([^"';]+)["']?/i);
    if (!boundaryMatch) {
      return bodyLines.join('\n').trim(); // Fallback if no boundary found
    }

    const boundary = boundaryMatch[1];
    const bodyText = bodyLines.join('\n');

    // Split by boundary
    const parts = bodyText.split(`--${boundary}`);
    const textParts: string[] = [];

    for (const part of parts) {
      if (!part.trim() || part.trim() === '--') continue;

      // Parse each part's headers and content
      const partLines = part.split('\n');
      const partHeaders: { [key: string]: string } = {};
      let partHeaderSection = true;
      const partBodyLines: string[] = [];

      for (const line of partLines) {
        if (partHeaderSection) {
          if (line.trim() === '') {
            partHeaderSection = false;
            continue;
          }

          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = line.slice(colonIndex + 1).trim();
            partHeaders[key] = value;
          }
        } else {
          partBodyLines.push(line);
        }
      }

      // Only include text/plain parts
      const partContentType = partHeaders['content-type'] || '';
      if (partContentType.toLowerCase().includes('text/plain')) {
        textParts.push(partBodyLines.join('\n').trim());
      }
    }

    // Join all text parts
    return textParts.join('\n\n').trim();
  }

  private decodeMimeHeader(headerValue: string): string {
    if (!headerValue) return '';

    try {
      return libmime.decodeWords(headerValue);
    } catch {
      // If decoding fails, return the original value
      this.logger.warn('Failed to decode MIME header', { headerValue });
      return headerValue;
    }
  }

  private parseEmailList(emailString: string): string[] {
    if (!emailString.trim()) return [];

    return emailString
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0);
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof EmailMboxExtractor.schema>;

    try {
      const content = await readFile(config.input, 'utf-8');
      const messages = content.split(/^From /m);
      return Math.max(0, messages.length - 1); // Subtract 1 for the content before first "From "
    } catch {
      return null;
    }
  }
}
