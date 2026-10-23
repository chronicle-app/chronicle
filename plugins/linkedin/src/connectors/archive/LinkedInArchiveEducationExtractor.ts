import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { parseCoarseDate } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * `Education.csv` — schools attended, newest-first. `snapshot` for the same
 * reason as positions: the dates are real, the degree text is a re-read.
 */
export class LinkedInArchiveEducationExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveEducationExtractor
> {
  static override description = 'Education history';
  static override recordTypes = ['education'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const enrollment of await this.enrollments()) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(enrollment.startedOn)) continue;
      yield this.createRecordWithArchiveContext({
        ...enrollment,
        occurredAt: enrollment.startedOn,
      });
      count++;
    }
  }

  /** The schools a run reads, and when each began. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const dates = (await this.enrollments()).map(enrollment => enrollment.startedOn);
    return { education: this.surveyDates(dates, options) };
  }

  /** Every school in the export with a name and a start, newest first. */
  private async enrollments() {
    const rows = await this.readCsv('Education.csv');

    return rows
      .map(row => ({
        school: row['School Name']?.trim(),
        degree: row['Degree Name']?.trim(),
        notes: row.Notes?.trim(),
        activities: row.Activities?.trim(),
        startedOn: parseCoarseDate(row['Start Date']),
        finishedOn: parseCoarseDate(row['End Date']),
      }))
      .filter(enrollment => enrollment.school && enrollment.startedOn)
      .sort((a, b) => (a.startedOn! < b.startedOn! ? 1 : -1));
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('Education.csv')).length;
  }
}
