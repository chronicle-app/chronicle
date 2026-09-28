import { MergingExtractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { AppUsageExtractor } from './AppUsageExtractor.js';
import { TimeEntriesExtractor } from './TimeEntriesExtractor.js';
import { TimingCallExtractor } from './TimingCallExtractor.js';
import TimingDefaultTransformer from './TimingDefaultTransformer.js';
import { DEFAULT_DB, DEFAULT_WINDOW_DAYS } from './TimingDbExtractor.js';

/**
 * The default `timing-app` extractor: a reverse-chronological merge of the
 * curated core streams — app usage, time entries, and calls. `--limit` applies
 * to the merged output, so `-l 1` yields the single most-recent record across
 * all three. Focused extractors remain available individually via `-t`.
 */
export class TimingDefaultExtractor extends MergingExtractor<typeof TimingDefaultExtractor> {
  static override source = 'timing-app';
  static override description = 'Everything: app usage, time entries, and calls';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['app-activities', 'time-entries', 'calls'];
  static override default = true;
  static override defaultTransformer = TimingDefaultTransformer;

  static override children = [AppUsageExtractor, TimeEntriesExtractor, TimingCallExtractor];

  // Superset of the children's flags, so RunnerBuilder passes them through to
  // the merge, which forwards the raw config to each child.
  static override schema = MergingExtractor.schema.extend({
    input: z.string().describe("Path to Timing.app's SQLite.db").default(DEFAULT_DB),
    all: z
      .boolean()
      .default(false)
      .describe(`Import the full history instead of the last ${DEFAULT_WINDOW_DAYS} days`),
  }) as any;

  /** Calls key their occurrence on `startSec`; activity/entries on `startDate`. */
  protected sortKey(record: Record): number {
    const ctx = record.context as { startDate?: number; startSec?: number };
    return record.extraction.recordType === 'calls' ? (ctx.startSec ?? 0) : (ctx.startDate ?? 0);
  }
}
