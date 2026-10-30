import type { Logger, ProgressFields, RecordLabel, SummaryFields } from '@chronicle.app/logging';
import { recordLabel } from './label.js';
import type { Record, RunLog } from './types.js';

/** A run's totals so far. */
export interface RunStats {
  /** Records the run processed, by type. */
  counts: { [type: string]: number };
  processed: number;
  /** Payloads the loaders took: a transformer can fan a record out, or drop it. */
  written: number;
  /** Records a transformer filtered out on purpose. */
  skipped: number;
  /** Failed operations: transforms, validations, and loads. */
  failed: number;
}

/** A label as an event's fields, in the order a person reads them: what, when, which. */
const labelFields = ({ type, date, title }: RecordLabel) => ({
  type,
  ...(date && { date }),
  ...(title && { title }),
});

const number = (n: number) => n.toLocaleString('en-US');

/**
 * Counts a run and says so: `progress` as records are read and processed,
 * keyed record `error` events, and a `summary` with the totals. The Runner
 * owns it, so every host sees a run the same way.
 */
export class RunReport {
  readonly stats: RunStats = { counts: {}, processed: 0, written: 0, skipped: 0, failed: 0 };
  private readonly startedAt = Date.now();
  private phase: NonNullable<ProgressFields['phase']> = 'reading';
  private total = 0;
  private read = 0;
  private readCounts: { [type: string]: number } = {};
  private skippedCounts: { [type: string]: number } = {};
  private current?: RecordLabel;
  private target?: string;

  constructor(
    private readonly logger: Logger,
    private readonly title: string,
    private readonly output?: string
  ) {}

  /** A record read in ahead of the run, before any reach the output. */
  readAhead(record: Record): void {
    this.read++;
    const type = record.extraction.recordType ?? 'records';
    this.readCounts[type] = (this.readCounts[type] ?? 0) + 1;
    this.current = recordLabel(record);
    this.progress();
  }

  /** Setup is done: records now go through to the output, `total` of them if known. */
  loading(total: number): void {
    this.phase = 'loading';
    this.total = total;
    this.current = undefined;
    this.progress();
  }

  /** Records are in; the loaders flush their output. */
  writing(): void {
    this.phase = 'writing';
    this.target = this.output ?? 'output';
    this.current = undefined;
    this.progress();
  }

  /**
   * Count a processed record, and report its failures and, for `--verbose`,
   * its skip, each naming the record and keyed so a flood aggregates.
   */
  record(log: RunLog): void {
    if (!log.record) return;
    const { stats } = this;
    stats.processed++;
    const type = log.record.extraction.recordType ?? 'records';
    stats.counts[type] = (stats.counts[type] ?? 0) + 1;
    // What it loaded as, else what was extracted, as when a transformer threw.
    const label = recordLabel(log.results.at(-1)?.record ?? log.record);
    const about = labelFields(label);
    const failures: [key: string, message: string | undefined][] = [
      ...(log.error ? [['record.transform', log.error] as [string, string]] : []),
      ...(log.validationErrors ?? []).map(
        error => ['record.validation', error] as [string, string]
      ),
      ...log.results
        .filter(result => !result.success)
        .map(result => ['record.load', result.error] as [string, string | undefined]),
    ];
    for (const [key, message] of failures) {
      stats.failed++;
      this.logger.emit({
        level: 'error',
        kind: 'error',
        message: message ?? "Couldn't load the record",
        key,
        fields: about,
        sensitive: ['date', 'title'],
      });
    }
    stats.written += log.results.filter(result => result.success).length;
    if (log.filtered) {
      stats.skipped++;
      this.skippedCounts[type] = (this.skippedCounts[type] ?? 0) + 1;
      this.logger.emit({
        level: 'debug',
        kind: 'diagnostic',
        message: 'Skipped a record',
        key: 'record.skip',
        fields: about,
        sensitive: ['date', 'title'],
      });
    }
    this.current = label;
    this.progress();
  }

  progress(): void {
    const reading = this.phase === 'reading';
    const fields: ProgressFields = {
      title: this.title,
      phase: this.phase,
      processed: reading ? this.read : this.stats.processed,
      total: this.total,
      counts: { ...(reading ? this.readCounts : this.stats.counts) },
      elapsedMs: Date.now() - this.startedAt,
      ...(this.current && { current: this.current }),
      ...(this.target && { target: this.target }),
    };
    this.logger.emit({
      level: 'debug',
      kind: 'progress',
      message: reading
        ? `${number(this.read)} records extracted`
        : `${number(this.stats.processed)} records`,
      fields,
      sensitive: ['current'],
    });
  }

  summary(): void {
    const { counts, processed, written, skipped, failed } = this.stats;
    const fields: SummaryFields = {
      title: this.title,
      counts,
      records: processed,
      // Only when it says something the counts don't: a fan-out, or failures.
      ...(written !== processed - skipped && { written }),
      ...(skipped > 0 && { skipped, skippedCounts: { ...this.skippedCounts } }),
      ...(failed > 0 && { failed }),
      durationMs: Date.now() - this.startedAt,
      ...(this.output && { output: this.output }),
    };
    const kinds = Object.entries(counts).map(([type, n]) => `${number(n)} ${type}`);
    this.logger.emit({
      level: failed > 0 ? 'error' : 'info',
      kind: 'summary',
      message: [
        `${this.title}: ${kinds.length > 0 ? kinds.join(', ') : 'no records'}`,
        ...(skipped > 0 ? [`${number(skipped)} skipped`] : []),
        ...(failed > 0 ? [`${number(failed)} failed`] : []),
        `in ${fields.durationMs}ms`,
      ].join(', '),
      fields,
    });
  }
}
