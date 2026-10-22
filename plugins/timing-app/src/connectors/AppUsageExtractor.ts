import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { getRow, iterateRows } from '@chronicle.app/etl-sqlite';
import TimingAppTransformer from './TimingAppTransformer.js';
import {
  TimingDbExtractor,
  TimingDevice,
  TimingProject,
  startsByMonth,
  timeSurvey,
  type SpanRow,
} from './TimingDbExtractor.js';

/**
 * Automatic app/screen usage from Timing's `AppActivity` table (6M+ rows),
 * streamed newest-first with a cursor. Each row → an `ExecuteAction` with a
 * `DeviceSession` result.
 */
export class AppUsageExtractor extends TimingDbExtractor<typeof AppUsageExtractor> {
  static override source = 'timing-app';
  static override description = 'Automatic app and screen usage';

  static override recordTypes = ['app-activities'];
  static override default = false;
  static override defaultTransformer = TimingAppTransformer;

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const projectChain = this.projectChainResolver();
    const devices = this.loadDevices();

    for (const row of this.rows()) {
      yield this.buildRecord(row, devices, projectChain);
    }
  }

  private rows(): Iterable<any> {
    const { conditions, params } = this.windowFilter('a');
    const limit = this.getEffectiveLimit();
    let sql = `
      SELECT CAST(a.id AS TEXT) AS id, a.startDate, a.endDate,
             CAST(a.localDeviceID AS TEXT) AS deviceLocalId,
             app.bundleIdentifier AS bundleIdentifier, app.executable AS executable,
             app.title AS appTitle,
             CAST(a.projectID AS TEXT) AS projectId,
             t.stringValue AS windowTitle, p.stringValue AS pathString
      FROM AppActivity a
      LEFT JOIN Application app ON a.applicationID = app.id
      LEFT JOIN Title t ON a.titleID = t.id
      LEFT JOIN Path p ON a.pathID = p.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.startDate DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }
    return iterateRows<any>(this.db!.prepare(sql), ...params);
  }

  private buildRecord(
    row: any,
    devices: Map<string, TimingDevice>,
    projectChain: (id: string | null) => TimingProject[]
  ): Record {
    return this.createRecord(
      {},
      {
        recordType: 'app-activities',
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate,
        app: {
          bundleIdentifier: row.bundleIdentifier || null,
          executable: row.executable || null,
          title: row.appTitle || null,
        },
        device: devices.get(row.deviceLocalId) ?? null,
        projectChain: projectChain(row.projectId),
        windowTitle: row.windowTitle || null,
        pathString: row.pathString || null,
      }
    );
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const total = this.countWindow('AppActivity', 'startDate');
      const limit = this.getEffectiveLimit();
      return limit === null ? total : Math.min(limit, total);
    } catch {
      return null;
    }
  }

  /**
   * The activities an uncapped run reads, when, and the time they span. The
   * run's joins are left out: each is to a primary key, so it keeps every row.
   */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { conditions, params } = this.windowFilter('a', this.sinceSeconds(null));
    const rows = `FROM AppActivity a WHERE ${conditions.join(' AND ')}`;
    const row = getRow<SpanRow>(
      this.db.prepare(
        `SELECT COUNT(*) AS n, MIN(a.startDate) AS first, MAX(a.startDate) AS last,
          COALESCE(SUM(a.endDate - a.startDate), 0) AS seconds
        ${rows}`
      ),
      ...params
    )!;
    const byMonth = options.byMonth
      ? startsByMonth(this.db, 'a.startDate', rows, params)
      : undefined;
    return { 'app-activities': timeSurvey(row, 'activities', byMonth) };
  }
}
