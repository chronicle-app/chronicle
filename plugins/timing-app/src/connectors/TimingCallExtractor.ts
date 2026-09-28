import { Record, normalizePhoneNumber } from '@chronicle.app/etl';
import { SqliteExtractor, iterateRows } from '@chronicle.app/etl-sqlite';
import { z } from 'zod';
import TimingCallTransformer from './TimingCallTransformer.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Application Support/info.eurocomp.Timing2/SQLite.db`;

/**
 * Timing.app's relay of Apple Call History — the historical supplement for the
 * long tail Apple has pruned. Grouped under the `timing-app` source (it reads
 * Timing's DB → `chronicle extract timing-app --type calls`), but its
 * *records* emit `source: apple-phone` keyed on the shared call UUID
 * (`Event.origin_id`), so they fold with the Apple Call History plugin's
 * calls. Direction is lost here, and named contacts carry no number (only the
 * name).
 */
export class TimingCallExtractor extends SqliteExtractor<typeof TimingCallExtractor> {
  static override source = 'timing-app';
  static override description = 'Phone and FaceTime calls (historical supplement)';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['calls'];
  static override default = false;
  static override defaultTransformer = TimingCallTransformer;
  static override temporality = 'event' as const;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe("Path to Timing.app's SQLite.db").default(DEFAULT_DB),
  }) as any;

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const conditions = [
      "i.type = 'com.apple.CallHistory'",
      'e.deleted_at IS NULL',
      'e.origin_id IS NOT NULL',
    ];
    const params: any[] = [];
    if (this.config.since) {
      conditions.push('e.start_date > ?');
      params.push(this.config.since.getTime() / 1000);
    }
    if (this.config.until) {
      conditions.push('e.start_date < ?');
      params.push(this.config.until.getTime() / 1000);
    }

    const limit = this.getEffectiveLimit();
    let sql = `
      SELECT e.origin_id AS uuid, e.start_date AS startSec, e.end_date AS endSec,
             es.title AS contactTitle, es.event_source_type AS sourceType
      FROM Event e
      JOIN Integration i ON e.integration_id = i.id
      LEFT JOIN EventSource es ON e.event_source_id = es.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.start_date DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    for (const row of iterateRows<any>(this.db.prepare(sql), ...params)) {
      // The title is either a real handle (unnamed contact) or a display name.
      const title: string | null = row.contactTitle || null;
      let handle: string | null = null;
      let contactName: string | null = null;
      if (title) {
        if (title.includes('@') || normalizePhoneNumber(title)) handle = title;
        else contactName = title;
      }

      yield this.createRecord(
        {},
        {
          recordType: 'calls',
          uuid: row.uuid,
          startSec: row.startSec,
          endSec: row.endSec ?? null,
          handle,
          contactName,
        }
      );
    }
  }
}
