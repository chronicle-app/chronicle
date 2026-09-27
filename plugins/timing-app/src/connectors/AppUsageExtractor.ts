import { Record } from '@chronicle.app/etl';
import TimingAppTransformer from './TimingAppTransformer.js';
import { TimingDbExtractor, TimingDevice, TimingProject } from './TimingDbExtractor.js';

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
    const since = this.sinceSeconds();
    const until = this.untilSeconds();
    const conditions = ['a.isDeleted = 0'];
    const params: any[] = [];
    if (since !== null) {
      conditions.push('a.startDate > ?');
      params.push(since);
    }
    if (until !== null) {
      conditions.push('a.startDate < ?');
      params.push(until);
    }

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
    return this.db!.prepare(sql).iterate(...params) as Iterable<any>;
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
}
