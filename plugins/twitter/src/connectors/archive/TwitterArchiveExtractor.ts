import {
  ArchiveExtractor,
  countMonth,
  Extractor,
  type KindSurvey,
  type Record,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { z } from 'zod';
import { fileName } from '../../utils/media.js';

export abstract class TwitterArchiveExtractor<
  T extends typeof TwitterArchiveExtractor,
> extends ArchiveExtractor<T> {
  static override source = 'twitter';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    // Optional so a run through the API needn't give one (see ArchiveExtractor).
    input: z.string().optional().describe('The Twitter archive, as a zip or its unpacked folder'),
    'include-group-dms': z
      .boolean()
      .optional()
      .default(true)
      .describe('Include group direct messages in extraction'),
  });

  protected override readonly exportName = 'Twitter archive';

  /** When X generated this archive; see {@link asOfTime}. */
  private generatedAt?: Date;

  override async setup(): Promise<void> {
    await super.setup();
    this.generatedAt = await this.generationDate();
  }

  /**
   * The archive's "as of" time: when X generated it. Everything in it is as X
   * had it then, an old tweet's author's handle as much as a like, which has
   * no time of its own, so every record is asserted then. A tweet keeps its
   * place on the timeline by when it was posted. Dating the sighting to the
   * archive also makes a second import of it restate the same one.
   */
  protected override asOfTime(): Date {
    return this.generatedAt ?? super.asOfTime();
  }

  protected override createRecordWithArchiveContext(data: any, metadata: any = {}): Record {
    const record = super.createRecordWithArchiveContext(data, metadata);
    if (this.generatedAt) record.extraction.recordAssertedAt = this.generatedAt.toISOString();
    return record;
  }

  /**
   * When X generated the archive, from `data/manifest.js`, or else when it
   * wrote `data/account.js`. None when it says neither.
   */
  private async generationDate(): Promise<Date | undefined> {
    try {
      const content = await this.files.readText('data/manifest.js');
      const manifest = JSON.parse(content.slice(content.indexOf('{')));
      const date = new Date(manifest.archiveInfo?.generationDate);
      if (!Number.isNaN(date.getTime())) return date;
    } catch {
      // An archive without a manifest is dated by its files.
    }
    return (await this.files.modified('data/account.js')) ?? undefined;
  }

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

  /**
   * The archive's copy of a tweet's or message's media file, on disk: X
   * names it after the tweet or message and the file it serves.
   */
  protected async mediaPath(
    folder: string,
    owner: string,
    url: string | undefined
  ): Promise<string | undefined> {
    if (!url) return undefined;
    const path = `data/${folder}/${owner}-${fileName(url)}`;
    if (!(await this.files.has(path))) return undefined;
    return (await this.files.localPath(path)) ?? undefined;
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
