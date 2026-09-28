import { ArchiveExtractor, Extractor } from '@chronicle.app/etl';
import { parse } from 'csv-parse/sync';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { profileHandle } from '../fields.js';

/** What one export knows about the member who requested it. */
export interface LinkedInAccount {
  /** The vanity slug, when the export names it. */
  handle?: string;
  /** `First Last` from Profile.csv, when it has one. */
  name?: string;
  /** The address flagged `Primary` in Email Addresses.csv. */
  email?: string;
  headline?: string;
  location?: string;
}

/**
 * Base for the LinkedIn member data export — the ZIP that Settings & Privacy →
 * Data Privacy → "Get a copy of your data" produces, unpacked to a directory of
 * CSVs.
 *
 * Shared here: reading a named CSV out of the export, the account info every
 * record carries, and the date window. One subclass per file, because the files
 * have nothing in common but their extension.
 *
 * **Two archives, and this reads either.** The *fast* archive arrives in
 * minutes with your profile, network, and messages. The *full* archive takes
 * up to a day and adds your activity — `Shares.csv`, `Comments.csv`,
 * `Reactions.csv`. Every extractor here treats a missing file as an empty one,
 * so a fast archive simply yields fewer record types than a full one.
 */
export abstract class LinkedInArchiveExtractor<
  T extends typeof LinkedInArchiveExtractor = typeof LinkedInArchiveExtractor,
> extends ArchiveExtractor<T> {
  static override source = 'linkedin';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the unpacked LinkedIn export directory'),
    'profile-url': z
      .string()
      .optional()
      .describe(
        'Your LinkedIn profile URL (https://www.linkedin.com/in/…). Only needed when the export carries no invitation to infer it from.'
      ),
  });

  protected override accountInfo: LinkedInAccount = {};

  /** Lower-cased file name → real file name, so a renamed case still resolves. */
  private fileIndex?: Map<string, string>;

  /** When LinkedIn wrote this export — see {@link asOfTime}. */
  private compiledAt?: Date;

  /**
   * Read the export's own facts before extraction: who it belongs to, and when
   * LinkedIn built it. The base class defines `loadAccountInfo` but never calls
   * it — each archive plugin decides when its export is readable.
   */
  override async setup(): Promise<void> {
    await super.setup();
    this.compiledAt = await this.newestFileTime();
    await this.loadAccountInfo();
  }

  /**
   * The "as of" time for the snapshot records: when LinkedIn compiled the
   * export, taken as the newest file time in the directory.
   *
   * Not the moment of the import, which is the default. An export is a frozen
   * artifact — its profile was true when LinkedIn wrote it, not when you got
   * around to reading it — and dating the sighting to the artifact is also what
   * makes a second import of the same directory a byte-identical no-op instead
   * of a fresh sighting of unchanged facts.
   */
  protected override asOfTime(): Date {
    return this.compiledAt ?? super.asOfTime();
  }

  /** The newest mtime among the export's files, or none if it has none. */
  private async newestFileTime(): Promise<Date | undefined> {
    const { input } = this.config as { input: string };
    let newest: number | undefined;
    for (const name of await this.fileNames()) {
      try {
        const { mtimeMs } = await stat(join(input, name));
        if (newest === undefined || mtimeMs > newest) newest = mtimeMs;
      } catch {
        // A file that vanished between listing and stat tells us nothing.
      }
    }
    return newest === undefined ? undefined : new Date(newest);
  }

  /**
   * The export's own account facts, read once per run: the profile, the primary
   * email, and — the interesting one — the member's own profile URL.
   *
   * **The profile URL is not in Profile.csv.** LinkedIn omits it. It appears
   * only on the other side of an edge: `Invitations.csv` carries both parties'
   * URLs *and* a `Direction` column, so an `OUTGOING` row states outright that
   * the inviter is you. That is the source declaring it, not us guessing from a
   * name match — and a name match is exactly the guess to avoid, because two
   * members share a name often enough to matter.
   *
   * With no invitations to read, the `profile-url` config supplies it, and
   * failing that the self falls back to `selfAgent`'s per-source singleton. All
   * three routes still merge onto the one person through `@me`.
   */
  protected override async loadAccountInfo(): Promise<LinkedInAccount> {
    const account: LinkedInAccount = {};

    const [profile] = await this.readCsv('Profile.csv');
    if (profile) {
      const name = [profile['First Name'], profile['Last Name']]
        .map(part => part?.trim())
        .filter(Boolean)
        .join(' ');
      if (name) account.name = name;
      if (profile.Headline?.trim()) account.headline = profile.Headline.trim();
      if (profile['Geo Location']?.trim()) {
        account.location = profile['Geo Location'].trim();
      }
    }

    const emails = await this.readCsv('Email Addresses.csv');
    const primary = emails.find(row => row.Primary?.trim() === 'Yes');
    const email = primary?.['Email Address']?.trim();
    if (email) account.email = email;

    const configured = profileHandle((this.config as { 'profile-url'?: string })['profile-url']);
    account.handle = configured ?? (await this.selfHandleFromInvitations());

    this.accountInfo = account;
    return account;
  }

  /**
   * The member's own slug, taken from whichever side of an invitation LinkedIn
   * labelled as theirs. Undefined when the export has no invitations.
   */
  private async selfHandleFromInvitations(): Promise<string | undefined> {
    const invitations = await this.readCsv('Invitations.csv');
    for (const row of invitations) {
      const direction = row.Direction?.trim().toUpperCase();
      if (direction === 'OUTGOING') {
        const handle = profileHandle(row.inviterProfileUrl);
        if (handle) return handle;
      }
      if (direction === 'INCOMING') {
        const handle = profileHandle(row.inviteeProfileUrl);
        if (handle) return handle;
      }
    }
    return undefined;
  }

  /**
   * Parse one CSV out of the export, as an array of row objects.
   *
   * A file the export did not include comes back empty rather than throwing —
   * see the fast/full archive note on the class. Every value arrives trimmed,
   * and `Connections.csv`'s three-line prose preamble is dropped: LinkedIn
   * writes a `Notes:` paragraph above the header there and nowhere else.
   */
  protected async readCsv(
    fileName: string
  ): Promise<Array<{ [column: string]: string | undefined }>> {
    const path = await this.resolveFile(fileName);
    if (!path) return [];

    const text = stripPreamble(await readFile(path, 'utf8'));
    if (!text.trim()) return [];

    return parse(text, {
      columns: (header: string[]) => header.map(column => column.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });
  }

  /** The real path for a file name, matched case-insensitively, or none. */
  private async resolveFile(fileName: string): Promise<string | undefined> {
    await this.fileNames();
    const resolved = this.fileIndex!.get(fileName.toLowerCase());
    const { input } = this.config as { input: string };
    return resolved ? join(input, resolved) : undefined;
  }

  /** Every file in the export, listed once and indexed for case-insensitive lookup. */
  private async fileNames(): Promise<string[]> {
    if (!this.fileIndex) {
      const { input } = this.config as { input: string };
      let entries: string[] = [];
      try {
        entries = await readdir(input);
      } catch {
        throw new Error(`Could not read the LinkedIn export directory ${input}`);
      }
      this.fileIndex = new Map(entries.map(name => [name.toLowerCase(), name]));
    }
    return [...this.fileIndex.values()];
  }

  /**
   * Whether a record's date clears the configured since/until window. A record
   * LinkedIn dated only to the year or month is compared at the start of that
   * span, and an undated one always passes — dropping it would lose a real
   * record on the strength of a date the source never wrote.
   */
  protected withinWindow(date: string | undefined): boolean {
    if (!date) return true;
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? true : this.isWithinDateRange(parsed);
  }
}

/**
 * Drop the prose LinkedIn writes above the header of `Connections.csv` — a
 * `Notes:` line, a quoted paragraph about missing email addresses, then a blank
 * line. Detected by that literal opener rather than by counting lines, so a
 * longer or shorter note still parses.
 */
function stripPreamble(text: string): string {
  if (!text.startsWith('Notes:')) return text;
  const blankLine = /\r?\n\s*\r?\n/.exec(text);
  return blankLine ? text.slice(blankLine.index + blankLine[0].length) : text;
}
