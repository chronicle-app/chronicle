import { ArchiveExtractor, Extractor } from '@chronicle.app/etl';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export abstract class TwitterArchiveExtractor<
  T extends typeof TwitterArchiveExtractor,
> extends ArchiveExtractor<T> {
  static override source = 'twitter';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to Twitter export data directory'),
    'include-group-dms': z
      .boolean()
      .optional()
      .default(true)
      .describe('Include group direct messages in extraction'),
  });

  /**
   * Twitter's export needs the archive's base directory to locate
   * `data/account.js`, so this can't share the base class's no-arg
   * `loadAccountInfo()` signature — kept as its own method instead of an
   * incompatible override.
   */
  protected async loadAccountInfoFrom(basePath: string): Promise<void> {
    try {
      const content = await readFile(`${basePath}/data/account.js`, 'utf-8');
      const jsData = this.parseTwitterJS(content, 'account');
      this.accountInfo = jsData[0]?.account || null;
    } catch (error) {
      this.logger.warn('Could not load account info', { error: String(error) });
      this.accountInfo = null;
    }
  }

  protected parseTwitterJS(content: string, dataType: string): any[] {
    const regex = new RegExp(`window\\.YTD\\.${dataType}\\.part0\\s*=\\s*(.+)`, 's');
    const match = content.match(regex);

    if (!match) {
      throw new Error(`Could not parse ${dataType} data from Twitter export`);
    }

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new Error(`Invalid JSON in ${dataType} file: ${error}`);
    }
  }

  protected convertTwitterDateToISO(twitterDate: string): string {
    // Convert Twitter's date format "Sat Jan 11 17:10:28 +0000 2025" to ISO
    // Twitter uses format: "ddd MMM DD HH:mm:ss +0000 YYYY"
    const date = new Date(twitterDate);
    return date.toISOString();
  }
}
