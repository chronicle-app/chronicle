import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { parseSpaceStamp } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * `Learning.csv` — LinkedIn Learning courses, newest-watched first.
 *
 * Stays `event` rather than `snapshot`. The row re-reports one moving value,
 * the last time you watched, and each export pins that value to a real date —
 * so successive exports accumulate the distinct sittings instead of one
 * attribute overwriting itself.
 *
 * LinkedIn writes `N/A` where it means "never", which is not a date.
 */
export class LinkedInArchiveLearningExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveLearningExtractor
> {
  static override description = 'LinkedIn Learning courses watched or saved';

  static override recordTypes = ['learning'];
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const course of await this.courses()) {
      if (this.shouldStopExtracting(count)) break;
      const occurredAt = lastSeen(course);
      if (!this.withinWindow(occurredAt)) continue;
      yield this.createRecordWithArchiveContext({ ...course, occurredAt });
      count++;
    }
  }

  /** The courses a run reads, and when each was last watched, else completed. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const dates = (await this.courses()).map(course => lastSeen(course));
    return { learning: this.surveyDates(dates, options) };
  }

  /** Every course in the export with a title, newest-watched first. */
  private async courses() {
    const rows = await this.readCsv('Learning.csv');

    return rows
      .map(row => ({
        title: row['Content Title']?.trim(),
        description: row['Content Description']?.trim() || undefined,
        contentType: row['Content Type']?.trim() || undefined,
        watchedAt: parseSpaceStamp(row['Content Last Watched Date (if viewed)']),
        completedAt: parseSpaceStamp(row['Content Completed At (if completed)']),
        saved: row['Content Saved']?.trim().toLowerCase() === 'true',
      }))
      .filter(course => course.title)
      .sort((a, b) => ((a.watchedAt ?? '') < (b.watchedAt ?? '') ? 1 : -1));
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('Learning.csv')).length;
  }
}

/** When a course dates to: the last time it was watched, else when it was completed. */
function lastSeen(course: { watchedAt?: string; completedAt?: string }): string | undefined {
  return course.watchedAt ?? course.completedAt;
}
