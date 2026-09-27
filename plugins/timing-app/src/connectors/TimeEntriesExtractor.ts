import { Record } from '@chronicle.app/etl';
import TimingAppTransformer from './TimingAppTransformer.js';
import { TimingDbExtractor, TimingProject } from './TimingDbExtractor.js';

/**
 * Manually-logged time entries from Timing's `TaskActivity` table. Timing calls
 * these "time entries" (each belongs to a project). Small and high-signal —
 * deliberately recorded, unlike the automatic app usage. Each → an
 * `ExperienceAction` carrying a lean `Session`.
 */
export class TimeEntriesExtractor extends TimingDbExtractor<typeof TimeEntriesExtractor> {
  static override source = 'timing-app';
  static override description = 'Manually logged time entries';

  static override recordTypes = ['time-entries'];
  static override default = false;
  static override defaultTransformer = TimingAppTransformer;

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const projectChain = this.projectChainResolver();

    for (const row of this.rows()) {
      yield this.buildRecord(row, projectChain);
    }
  }

  private rows(): Iterable<any> {
    const since = this.sinceSeconds();
    const until = this.untilSeconds();
    const conditions = ['isDeleted = 0', 'isRunning = 0'];
    const params: any[] = [];
    if (since !== null) {
      conditions.push('startDate > ?');
      params.push(since);
    }
    if (until !== null) {
      conditions.push('startDate < ?');
      params.push(until);
    }

    const limit = this.getEffectiveLimit();
    let sql = `
      SELECT CAST(id AS TEXT) AS id, startDate, endDate,
             CAST(projectID AS TEXT) AS projectId, title, notes
      FROM TaskActivity
      WHERE ${conditions.join(' AND ')}
      ORDER BY startDate DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }
    return this.db!.prepare(sql).iterate(...params) as Iterable<any>;
  }

  private buildRecord(row: any, projectChain: (id: string | null) => TimingProject[]): Record {
    return this.createRecord(
      {},
      {
        recordType: 'time-entries',
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate,
        title: row.title || null,
        notes: row.notes || null,
        projectChain: projectChain(row.projectId),
      }
    );
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const total = this.countWindow('TaskActivity', 'startDate', ' AND isRunning = 0');
      const limit = this.getEffectiveLimit();
      return limit === null ? total : Math.min(limit, total);
    } catch {
      return null;
    }
  }
}
