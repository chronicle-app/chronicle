import { Record } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import SafariTransformer from './SafariTransformer.js';

// since/until bounds land on visit_time, which is seconds since the Apple epoch
const safariBound = (date: Date) => unixToSafariTimestamp(Math.floor(date.getTime() / 1000));

export class SafariExtractor extends SqliteExtractor<typeof SafariExtractor> {
  static override source = 'safari';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override description = 'Browsing history';
  static override default = true;
  static override recordTypes = ['views'];
  // extract() orders by history_visits.visit_time desc, which with keyOf opts
  // this extractor into the frontier cursor (incremental catch-up import).
  static override newestFirst = true;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .describe('Path to Safari History.db file')
      .default(`${process.env.HOME}/Library/Safari/History.db`),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any;

  static override defaultTransformer = SafariTransformer;

  /** history_visits.id — Safari's own visit id, AUTOINCREMENT so never reused. */
  override keyOf(record: Record): string | null {
    const visitId = (record.data as { visit_id?: number }).visit_id;
    return visitId === null || visitId === undefined ? null : String(visitId);
  }

  // Visits that landed on a page (redirect hops excluded), within since/until.
  private visitFilter(): { where: string; values: Array<number | string> } {
    const range = timeRangeConditions('history_visits.visit_time', this.config, {
      convert: safariBound,
    });
    const conditions = ['history_visits.redirect_destination IS NULL', ...range.conditions];
    return { where: conditions.join(' AND '), values: range.values };
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // 0 is the "no limit" convention (null here); the CLI's --limit default is the safety net
    const limit = this.getEffectiveLimit();
    const { where, values } = this.visitFilter();

    let sql = `
      SELECT history_visits.id AS visit_id,
             history_visits.history_item,
             history_visits.visit_time,
             history_visits.title,
             history_items.url,
             cast(history_visits.visit_time + ${APPLE_EPOCH_OFFSET_SECONDS} as integer) AS unix_timestamp,
             datetime(history_visits.visit_time + ${APPLE_EPOCH_OFFSET_SECONDS}, 'unixepoch') AS visit_datetime,
             history_visits.origin
      FROM history_visits
      LEFT JOIN history_items ON history_items.id = history_visits.history_item
      WHERE ${where}
      ORDER BY history_visits.visit_time DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      values.push(limit);
    }

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    for (const row of this.db.prepare(sql).iterate(...values)) {
      const processedRow = this.processRow(row);

      yield this.createRecord(processedRow, {
        source: 'safari',
        account,
      });
    }
  }

  private processRow(row: any): any {
    return {
      visit_id: row.visit_id,
      history_item: row.history_item,
      visit_time: row.visit_time,
      title: row.title || null,
      url: row.url,
      unix_timestamp: row.unix_timestamp,
      visit_datetime: row.visit_datetime,
      origin: row.origin,
      // Origin is an integer in Safari's schema - we can't determine device type from it directly
      device_type: 'desktop', // Default to desktop since we can't reliably detect mobile vs desktop
    };
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;

    try {
      // Same filters as the main query, counted
      const { where, values } = this.visitFilter();
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM history_visits
           LEFT JOIN history_items ON history_items.id = history_visits.history_item
           WHERE ${where}`
        )
        .get(...values) as { n: number };
      return row.n;
    } catch {
      return null;
    }
  }
}
