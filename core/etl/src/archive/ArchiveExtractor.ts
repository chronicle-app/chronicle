import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Extractor } from '../extractor.js';
import { Record } from '../types.js';

/**
 * Base for takeout-style export plugins (Facebook/Instagram archives, Twitter
 * exports, Google Takeout, …): a directory of JSON the platform wrote once,
 * read in place.
 *
 * Shared here: the archive record context (strategy + the export's account
 * info), JSON reading, the since/until window check, and the mojibake repair
 * these exports need. Layout knowledge stays per-plugin — exports differ in
 * structure (Meta's segmented directories, Twitter's `window.YTD.*` JS files)
 * and that knowledge is exactly what a plugin contributes.
 */
export abstract class ArchiveExtractor<
  SelfClass extends typeof ArchiveExtractor = typeof ArchiveExtractor,
> extends Extractor<SelfClass> {
  static override delivery = 'export' as const;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the export directory'),
  });

  /**
   * The export's own record of whose archive this is, loaded by the
   * subclass's `loadAccountInfo` and attached to every record's context.
   */
  protected accountInfo: any = null;

  /**
   * Read the export's account/profile info. Subclasses override with their
   * archive's location and shape; the default is "this export names no
   * owner" — never fabricate one.
   */
  protected async loadAccountInfo(): Promise<any> {
    return null;
  }

  /** Parse one JSON file from the archive (absolute path). */
  protected async readArchiveJson(filePath: string): Promise<any> {
    try {
      const buffer = await readFile(filePath);
      return JSON.parse(buffer.toString('utf-8'));
    } catch {
      throw new Error(`Failed to read archive JSON file ${filePath}`);
    }
  }

  /** Whether a date falls inside the configured since/until window. */
  protected isWithinDateRange(date: Date): boolean {
    if (this.config.since && date < this.config.since) return false;
    if (this.config.until && date > this.config.until) return false;
    return true;
  }

  /**
   * Repair export mojibake. These archives write each raw UTF-8 byte of the
   * original text as its own `\u00XX` escape, so after `JSON.parse` a
   * multi-byte character (emoji, curly quotes, CJK) arrives as a run of
   * Latin-1 code points. Reverse it universally: pack the code points back
   * into bytes and decode as UTF-8.
   *
   * Applied only when the string still looks byte-encoded — every char
   * ≤ 0xFF and at least one in 0x80–0xFF. A char ≥ 0x100 means it was
   * already decoded (real emoji/CJK, incl. surrogate pairs), so re-packing
   * is skipped; bytes that are not valid UTF-8 fail the fatal decode and
   * the original is kept.
   */
  protected fixArchiveTextEncoding(text: string): string {
    if (!text) return text;
    if (!/[\u0080-\u00FF]/.test(text)) return text.trim();
    if (/[\u0100-\uFFFF]/.test(text)) return text.trim();
    try {
      const bytes = Uint8Array.from(text, c => c.codePointAt(0) ?? 0);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    } catch {
      return text.trim();
    }
  }

  /** A record carrying the archive context: strategy + whose export this is. */
  protected createRecordWithArchiveContext(data: any, metadata: any = {}): Record {
    return this.createRecord(data, {
      ...metadata,
      strategy: 'archive',
      accountInfo: this.accountInfo,
    });
  }
}
