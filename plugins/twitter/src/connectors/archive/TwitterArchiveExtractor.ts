import {
  ArchiveExtractor,
  countMonth,
  Extractor,
  type KindSurvey,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { z } from 'zod';

export abstract class TwitterArchiveExtractor<
  T extends typeof TwitterArchiveExtractor,
> extends ArchiveExtractor<T> {
  static override source = 'twitter';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('The Twitter archive, as a zip or its unpacked folder'),
    'include-group-dms': z
      .boolean()
      .optional()
      .default(true)
      .describe('Include group direct messages in extraction'),
  });

  protected override readonly exportName = 'Twitter archive';

  /** Whose archive this is, from `data/account.js`. */
  protected override async loadAccountInfo(): Promise<any> {
    try {
      const content = await this.files.readText('data/account.js');
      const jsData = this.parseTwitterJS(content, 'account');
      return jsData[0]?.account || null;
    } catch (error) {
      this.logger.warn('Could not load account info', { error: String(error) });
      return null;
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

  /** How many records a run reads and when, from the time it dates each by. */
  protected surveyOf(times: Date[], options: SurveyOptions): KindSurvey {
    const kind: KindSurvey = { count: times.length, ...(options.byMonth && { byMonth: {} }) };
    for (const time of times) {
      if (!kind.earliest || time < kind.earliest) kind.earliest = time;
      if (!kind.latest || time > kind.latest) kind.latest = time;
      if (kind.byMonth) countMonth(kind.byMonth, time);
    }
    return kind;
  }

  protected convertTwitterDateToISO(twitterDate: string): string {
    // Convert Twitter's date format "Sat Jan 11 17:10:28 +0000 2025" to ISO
    // Twitter uses format: "ddd MMM DD HH:mm:ss +0000 YYYY"
    const date = new Date(twitterDate);
    return date.toISOString();
  }
}
