import { Record } from '@chronicle.app/etl';
import { parseCoarseDate } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * `Positions.csv` — the work history, newest-first.
 *
 * `snapshot`, even though every row carries real dates. The dates ride the
 * boundary actions and stay exactly where LinkedIn put them; what re-reads is
 * the mutable part — a title, a description someone rewrote — and that belongs
 * at the moment it was seen.
 */
export class LinkedInArchivePositionsExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchivePositionsExtractor
> {
  static override description = 'Work history';
  static override recordTypes = ['positions'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    const rows = await this.readCsv('Positions.csv');

    const positions = rows
      .map(row => ({
        company: row['Company Name']?.trim(),
        title: row.Title?.trim(),
        description: row.Description?.trim(),
        location: row.Location?.trim(),
        startedOn: parseCoarseDate(row['Started On']),
        finishedOn: parseCoarseDate(row['Finished On']),
      }))
      .filter(position => position.company && position.startedOn)
      .sort((a, b) => (a.startedOn! < b.startedOn! ? 1 : -1));

    let count = 0;
    for (const position of positions) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(position.startedOn)) continue;
      yield this.createRecordWithArchiveContext({
        ...position,
        occurredAt: position.startedOn,
      });
      count++;
    }
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('Positions.csv')).length;
  }
}
