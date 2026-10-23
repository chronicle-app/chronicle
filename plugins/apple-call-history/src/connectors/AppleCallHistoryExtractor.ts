import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  countsByMonth,
  monthSql,
  safariToUnixTimestamp,
  timeRangeConditions,
  unixToSafariTimestamp,
  iterateRows,
} from '@chronicle.app/etl-sqlite';
import { z } from 'zod';
import CallHistoryTransformer from './CallHistoryTransformer.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Application Support/CallHistoryDB/CallHistory.storedata`;

/**
 * Apple Call History — the primary, per-record-rich call source. Each record has
 * an explicit direction, address, name, duration, and (for groups) a participant
 * join table. Records key on the call UUID so they fold with the Timing relay.
 */
export class AppleCallHistoryExtractor extends SqliteExtractor<typeof AppleCallHistoryExtractor> {
  // Plugin, CLI name, and record namespace are all `apple-call-history`, after
  // Apple's CallHistory store (`com.apple.CallHistory`), which holds phone and
  // FaceTime calls alike. Timing's relayed calls use it too, so the two fold.
  static override source = 'apple-call-history';
  static override description = 'Phone and FaceTime calls';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['calls'];
  static override default = true;
  static override defaultTransformer = CallHistoryTransformer;
  static override temporality = 'event' as const;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe('Path to CallHistory.storedata').default(DEFAULT_DB),
  }) as any;

  // Calls with an id, within since/until. ZDATE is seconds since the Apple epoch.
  private callFilter(): { where: string; values: Array<number | string> } {
    const range = timeRangeConditions('ZDATE', this.config, {
      convert: date => unixToSafariTimestamp(date.getTime() / 1000),
    });
    const conditions = ['ZUNIQUE_ID IS NOT NULL', ...range.conditions];
    return { where: conditions.join(' AND '), values: range.values };
  }

  /** call Z_PK → remote handle values (phone/email). */
  private loadParticipants(): Map<number, string[]> {
    const rows = this.db!.prepare(
      `SELECT j.Z_2REMOTEPARTICIPANTCALLS AS callPk, h.ZVALUE AS value
       FROM Z_2REMOTEPARTICIPANTHANDLES j
       JOIN ZHANDLE h ON h.Z_PK = j.Z_4REMOTEPARTICIPANTHANDLES`
    ).all() as any[];
    const map = new Map<number, string[]>();
    for (const row of rows) {
      if (!row.value) continue;
      const list = map.get(row.callPk) ?? [];
      list.push(row.value);
      map.set(row.callPk, list);
    }
    return map;
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const participants = this.loadParticipants();

    const { where, values: params } = this.callFilter();
    const limit = this.getEffectiveLimit();
    let sql = `
      SELECT Z_PK AS pk, ZUNIQUE_ID AS uuid, ZDATE AS zdate, ZDURATION AS duration,
             ZORIGINATED AS originated, ZADDRESS AS address, ZNAME AS name,
             hex(ZPARTICIPANTGROUPUUID) AS groupUuid
      FROM ZCALLRECORD
      WHERE ${where}
      ORDER BY ZDATE DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    for (const row of iterateRows<any>(this.db.prepare(sql), ...params)) {
      const handles = dedupe([
        ...(participants.get(row.pk) ?? []),
        ...(row.address ? [row.address] : []),
      ]);

      yield this.createRecord(
        {},
        {
          recordType: 'calls',
          uuid: row.uuid,
          startSec: safariToUnixTimestamp(row.zdate),
          durationSec: row.duration ?? 0,
          originated: row.originated, // 1 out, 0 in
          name: row.name || null,
          handles,
          groupUuid: row.groupUuid || null, // hex of ZPARTICIPANTGROUPUUID
        }
      );
    }
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      // The calls a run reads: those with an id, within since and until.
      const { where, values } = this.callFilter();
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ZCALLRECORD WHERE ${where}`)
        .get(...values) as { n: number };
      const limit = this.getEffectiveLimit();
      return limit === null ? row.n : Math.min(row.n, limit);
    } catch {
      return null;
    }
  }

  /** The calls a run reads and when, with how long they lasted, to the second. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { where, values } = this.callFilter();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(ZDATE) AS first, MAX(ZDATE) AS last,
          COALESCE(ROUND(SUM(ZDURATION)), 0) AS seconds FROM ZCALLRECORD WHERE ${where}`
      )
      .get(...values) as { n: number; first: number | null; last: number | null; seconds: number };
    const byMonth =
      options.byMonth &&
      countsByMonth(
        this.db
          .prepare(
            `SELECT ${monthSql(`ZDATE + ${APPLE_EPOCH_OFFSET_SECONDS}`)} AS month, COUNT(*) AS n
            FROM ZCALLRECORD WHERE ${where} GROUP BY month`
          )
          .all(...values) as Array<{ month: string | null; n: number }>
      );
    return {
      calls: {
        count: row.n,
        ...(row.first !== null && { earliest: new Date(safariToUnixTimestamp(row.first) * 1000) }),
        ...(row.last !== null && { latest: new Date(safariToUnixTimestamp(row.last) * 1000) }),
        ...(byMonth && { byMonth }),
        measures: [{ key: 'callSeconds', label: 'calls', value: row.seconds, unit: 'seconds' }],
      },
    };
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}
