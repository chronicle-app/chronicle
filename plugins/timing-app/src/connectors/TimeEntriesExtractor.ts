import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { getRow, iterateRows } from '@chronicle.app/etl-sqlite';
import TimingAppTransformer from './TimingAppTransformer.js';
import {
  TimingDbExtractor,
  TimingProject,
  startsByMonth,
  timeSurvey,
  type SpanRow,
} from './TimingDbExtractor.js';

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
    const { conditions, params } = this.entryFilter();
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
    return iterateRows<any>(this.db!.prepare(sql), ...params);
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

  /** The entries an uncapped run reads, when, and the time they span. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { conditions, params } = this.entryFilter(this.sinceSeconds(null));
    const rows = `FROM TaskActivity WHERE ${conditions.join(' AND ')}`;
    const row = getRow<SpanRow>(
      this.db.prepare(
        `SELECT COUNT(*) AS n, MIN(startDate) AS first, MAX(startDate) AS last,
          COALESCE(SUM(endDate - startDate), 0) AS seconds
        ${rows}`
      ),
      ...params
    )!;
    const byMonth = options.byMonth ? startsByMonth(this.db, 'startDate', rows, params) : undefined;
    return { 'time-entries': timeSurvey(row, 'entries', byMonth) };
  }

  /** Finished entries within the window. */
  private entryFilter(since = this.sinceSeconds()): { conditions: string[]; params: number[] } {
    const { conditions, params } = this.windowFilter('TaskActivity', since);
    return { conditions: [...conditions, 'TaskActivity.isRunning = 0'], params };
  }
}
