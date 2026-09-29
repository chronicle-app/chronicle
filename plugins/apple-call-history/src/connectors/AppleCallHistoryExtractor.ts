import { Record } from '@chronicle.app/etl';
import {
  SqliteExtractor,
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

    const conditions = ['ZUNIQUE_ID IS NOT NULL'];
    const params: any[] = [];
    const range = timeRangeConditions('ZDATE', this.config, {
      convert: date => unixToSafariTimestamp(date.getTime() / 1000),
    });
    conditions.push(...range.conditions);
    params.push(...range.values);

    const limit = this.getEffectiveLimit();
    let sql = `
      SELECT Z_PK AS pk, ZUNIQUE_ID AS uuid, ZDATE AS zdate, ZDURATION AS duration,
             ZORIGINATED AS originated, ZADDRESS AS address, ZNAME AS name,
             hex(ZPARTICIPANTGROUPUUID) AS groupUuid
      FROM ZCALLRECORD
      WHERE ${conditions.join(' AND ')}
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
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ZCALLRECORD WHERE ZUNIQUE_ID IS NOT NULL`)
        .get() as { n: number };
      return row.n;
    } catch {
      return null;
    }
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}
