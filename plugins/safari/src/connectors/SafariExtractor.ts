import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  countsByMonth,
  monthSql,
  timeRangeConditions,
  unixToSafariTimestamp,
  iterateRows,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/apple';
import { z } from 'zod';
import SafariTransformer from './SafariTransformer.js';

// since/until bounds land on visit_time, which is seconds since the Apple epoch
const safariBound = (date: Date) => unixToSafariTimestamp(Math.floor(date.getTime() / 1000));

// A visit's time as a record gives it: whole Unix seconds.
const visitTime = `cast(history_visits.visit_time + ${APPLE_EPOCH_OFFSET_SECONDS} as integer)`;

/** Safari's History.db; its Bookmarks.plist is in the same folder. */
export const historyInput = z
  .string()
  .describe('Path to Safari History.db file')
  .default(`${process.env.HOME}/Library/Safari/History.db`);

/**
 * The Apple Account whose history and bookmarks these are. Omitted, it's the
 * one signed in to this Mac; null, there's no one to name.
 */
export const accountOption = z
  .object({
    accountID: z.string(),
    email: z.string(),
    displayName: z.string(),
    dsid: z.string().optional(),
  })
  .nullable()
  .optional();

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
  // What extract() and survey() read, which a History.db must have.
  static override databases = [
    {
      tables: {
        history_items: ['id', 'url'],
        history_visits: [
          'id',
          'history_item',
          'visit_time',
          'title',
          'redirect_destination',
          'origin',
        ],
      },
    },
  ];

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: historyInput,
    account: accountOption,
  }) as any;

  static override defaultTransformer = SafariTransformer;

  /** history_visits.id — Safari's own visit id, AUTOINCREMENT so never reused. */
  override keyOf(record: Record): string | null {
    const visitId = (record.data as { visit_id?: number }).visit_id;
    return visitId === null || visitId === undefined ? null : String(visitId);
  }

  override occurredAt(record: Record): Date | undefined {
    return new Date((record.data as { unix_timestamp: number }).unix_timestamp * 1000);
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
             ${visitTime} AS unix_timestamp,
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

    for (const row of iterateRows<any>(this.db.prepare(sql), ...values)) {
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

  /** The visits a run reads and when, with how many pages they were to. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { where, values } = this.visitFilter();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(${visitTime}) AS first, MAX(${visitTime}) AS last,
          COUNT(DISTINCT history_items.id) AS pages FROM history_visits
         LEFT JOIN history_items ON history_items.id = history_visits.history_item
         WHERE ${where}`
      )
      .get(...values) as { n: number; first: number | null; last: number | null; pages: number };
    const byMonth =
      options.byMonth &&
      countsByMonth(
        this.db
          .prepare(
            `SELECT ${monthSql(visitTime)} AS month, COUNT(*) AS n FROM history_visits
             LEFT JOIN history_items ON history_items.id = history_visits.history_item
             WHERE ${where} GROUP BY month`
          )
          .all(...values) as Array<{ month: string | null; n: number }>
      );
    return {
      views: {
        count: row.n,
        ...(row.first !== null && { earliest: new Date(row.first * 1000) }),
        ...(row.last !== null && { latest: new Date(row.last * 1000) }),
        ...(byMonth && { byMonth }),
        measures: [{ key: 'pages', label: 'pages', value: row.pages }],
      },
    };
  }
}
