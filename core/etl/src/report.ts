import type { Logger, ProgressFields, SummaryFields } from '@chronicle.app/logging';
import { nodeLabel } from './connectors/loaders/columns.js';
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

/** A record's one-line label: its name, else the first text it carries. */
function label(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const node = data as { [key: string]: unknown };
  const text =
    nodeLabel(node) ?? Object.values(node).find((v): v is string => typeof v === 'string') ?? '';
  return text.replaceAll(/\s+/g, ' ').trim();
}

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
  private current = '';
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
    this.current = label(record.data) || this.current;
    this.progress();
  }

  /** Setup is done: records now go through to the output, `total` of them if known. */
  loading(total: number): void {
    this.phase = 'loading';
    this.total = total;
    this.current = '';
    this.progress();
  }

  /** Records are in; the loaders flush their output. */
  writing(): void {
    this.phase = 'writing';
    this.target = this.output ?? 'output';
    this.current = '';
    this.progress();
  }

  /** Count a processed record, and report its failures, keyed so a flood aggregates. */
  record(log: RunLog): void {
    if (!log.record) return;
    const { stats } = this;
    stats.processed++;
    const type = log.record.extraction.recordType ?? 'records';
    stats.counts[type] = (stats.counts[type] ?? 0) + 1;
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
        message: `Extraction error: ${message ?? 'load failed'}`,
        key,
      });
    }
    stats.written += log.results.filter(result => result.success).length;
    if (log.filtered) stats.skipped++;
    const loaded = log.results.at(-1)?.record?.data;
    this.current = label(loaded ?? log.record.data) || this.current;
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
      ...(skipped > 0 && { skipped }),
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
