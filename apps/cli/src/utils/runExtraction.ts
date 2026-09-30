import { randomUUID } from 'node:crypto';
import {
  captureConsole,
  createLogger,
  setDefaultSink,
  thresholdFor,
  type Logger,
} from '@chronicle.app/logging';
import {
  nodeLabel,
  type Record as ExtractedRecord,
  type Runner,
  type RunLog,
} from '@chronicle.app/etl';
import type { FlagSource } from '../config/index.js';
import {
  count,
  createSink,
  defaultLogFormat,
  plainTokens,
  relativePath,
  summary,
  type Live,
  type ProgressFields,
  type SummaryFields,
} from '../output/index.js';
import { RunnerBuilder, requestedRecordTypes } from './RunnerBuilder.js';

/** Where the records land, when it's a file: relative to here unless that climbs out. */
function destination(output: unknown): string | undefined {
  if (typeof output !== 'string' || output === '' || output === 'stdout') return undefined;
  return relativePath(output);
}

/**
 * The live view goes on stderr when that's a terminal. When records print to
 * the same terminal it shows only while the run starts and reads, and steps
 * aside before the first record; the table loader prints only after the run,
 * so it keeps the view throughout.
 */
function wantsLiveView(flags: any): Live {
  if (flags.quiet || !process.stderr.isTTY) return false;
  const toTerminal = !destination(flags.output) && process.stdout.isTTY;
  return toTerminal && flags.loader !== 'table' ? 'until-loading' : true;
}

const list = (names: string[]) =>
  names.length > 3 ? `${names.slice(0, 3).join(', ')}, …` : names.join(', ');

interface Hint {
  message: string;
  action: string;
  fields?: Record<string, unknown>;
}

/**
 * Next moves for tabular output: the columns the table had no room for, and
 * the other column mode when the run took the default one.
 */
function columnHints(flags: any, loader: any, flagSources: Record<string, FlagSource>): Hint[] {
  if (flags.loader !== 'csv' && flags.loader !== 'table') return [];
  const hints: Hint[] = [];
  const hidden: string[] = loader?.hiddenColumns ?? [];
  if (hidden.length > 0) {
    const n = hidden.length;
    hints.push({
      message: `${n} column${n === 1 ? '' : 's'} didn't fit (${list(hidden)})`,
      action: '--loader csv keeps every column',
      fields: { hidden },
    });
  }
  if (loader?.collapsed && (flagSources.columns?.source ?? 'default') === 'default') {
    hints.push({
      message: 'nested nodes shown as labels',
      action: '--columns schema keeps every schema property',
    });
  }
  return hints;
}

/** A record's one-line label: its name, else the first text it carries. */
function label(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const node = data as { [key: string]: unknown };
  const text =
    nodeLabel(node) ?? Object.values(node).find((v): v is string => typeof v === 'string') ?? '';
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** A run's counts as it goes: what progress and the summary report. */
class Tally {
  processed = 0;
  /** Payloads loaders took: a transformer can fan a record out, or drop it. */
  written = 0;
  failed = 0;
  skipped = 0;
  counts: Record<string, number> = {};
  current = '';
  readonly startedAt = Date.now();
  private total = 0;
  private phase: 'reading' | 'loading' | 'writing' = 'reading';
  private target?: string;
  private read = 0;
  private readCounts: Record<string, number> = {};

  constructor(
    private readonly logger: Logger,
    private readonly title: string
  ) {}

  /** A record read in ahead of the run, before any reach the output. */
  readAhead(record: ExtractedRecord): void {
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

  /** Records are in; the loaders flush their output to `target`. */
  writing(target: string): void {
    this.phase = 'writing';
    this.target = target;
    this.current = '';
    this.progress();
  }

  /** Count a record, and report its failures, keyed so a flood aggregates. */
  record(log: RunLog): void {
    if (!log.record) return;
    this.processed++;
    const type = log.record.extraction.recordType ?? 'records';
    this.counts[type] = (this.counts[type] ?? 0) + 1;
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
      this.failed++;
      this.logger.emit({
        level: 'error',
        kind: 'error',
        message: `Extraction error: ${message ?? 'load failed'}`,
        key,
      });
    }
    this.written += log.results.filter(result => result.success).length;
    if (log.filtered) this.skipped++;
    const loaded = log.results.at(-1)?.record?.data;
    this.current = label(loaded ?? log.record.data) || this.current;
    this.progress();
  }

  progress(): void {
    const reading = this.phase === 'reading';
    const fields: ProgressFields = {
      title: this.title,
      phase: this.phase,
      processed: reading ? this.read : this.processed,
      total: this.total,
      counts: { ...(reading ? this.readCounts : this.counts) },
      elapsedMs: Date.now() - this.startedAt,
      ...(this.current && { current: this.current }),
      ...(this.target && { target: this.target }),
    };
    this.logger.emit({
      level: 'debug',
      kind: 'progress',
      message: reading
        ? `${this.read.toLocaleString('en-US')} records read`
        : `${this.processed.toLocaleString('en-US')} records`,
      fields,
      sensitive: ['current'],
    });
  }

  summary(output: string | undefined): void {
    const fields: SummaryFields = {
      title: this.title,
      counts: this.counts,
      records: this.processed,
      // Only when it says something the counts don't: a fan-out, or failures.
      ...(this.written !== this.processed - this.skipped && { written: this.written }),
      ...(this.skipped > 0 && { skipped: this.skipped }),
      ...(this.failed > 0 && { failed: this.failed }),
      durationMs: Date.now() - this.startedAt,
      ...(output && { output }),
    };
    this.logger.emit({
      level: this.failed > 0 ? 'error' : 'info',
      kind: 'summary',
      message: summary(fields, plainTokens, Number.POSITIVE_INFINITY, { status: false }),
      fields,
    });
  }
}

/** Run the shared extract path with cleanup even after partial setup or interruption. */
export async function runExtraction(
  extractor: any,
  flags: any,
  flagSources: Record<string, FlagSource> = {}
) {
  const { source, strategy } = extractor;
  const format = flags['log-format'] ?? defaultLogFormat();
  const sink = createSink({
    format,
    level: thresholdFor(flags),
    theme: flags.theme,
    live: wantsLiveView(flags),
    personal: flags['log-personal'],
  });
  const run = { id: randomUUID(), source: String(source), strategy: String(strategy ?? '') };
  const logger = createLogger({ scope: 'runner', sink, run });
  const title = strategy && strategy !== source ? `${source} · ${strategy}` : String(source);
  const tally = new Tally(logger, title);
  const builder = new RunnerBuilder(flags, flagSources);
  const runner: Runner = await builder.buildRunner(extractor, {
    sink,
    run,
    onRead: record => tally.readAhead(record),
  });
  // For the run, everything goes to its sink: loggers without one of their
  // own, and anything a plugin or dependency writes to the console, as its
  // diagnostics. Stdout carries only the records.
  const previousSink = setDefaultSink(sink);
  const restoreConsole = captureConsole(
    createLogger({ scope: `${run.source}.${run.strategy}`, sink, run })
  );
  // The source's own count, when it gave one (a streamed run asks): the whole
  // source, before any limit, and only meaningful when no --type narrows it.
  let sourceTotal: number | null = null;
  let failure: unknown;
  let interrupted = false;
  let interrupt!: (error: Error) => void;
  const interruption = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  const onInterrupt = () => {
    interrupted = true;
    interrupt(
      Object.assign(new Error('Extraction cancelled'), { exitCode: 130, oclif: { exit: 130 } })
    );
  };
  process.on('SIGINT', onInterrupt);
  try {
    await Promise.race([
      interruption,
      (async () => {
        // The view starts before setup: a buffered run reads its source there.
        tally.progress();
        await runner.setup();
        if (interrupted) return;
        const total = runner.numRecords ?? 0;
        if (flags.stream && !requestedRecordTypes(flags.type)) sourceTotal = runner.numRecords;
        // The bar measures what this run will load, not the whole source.
        tally.loading(flags.limit > 0 && total > 0 ? Math.min(total, flags.limit) : total);
        for await (const log of runner.run()) {
          if (interrupted) break;
          tally.record(log);
        }
      })(),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    // Loaders that buffer write everything at teardown. When that's to the
    // terminal (the table), the live view comes off the screen first;
    // otherwise it stays up, saying where the output is going.
    const toTerminal = !destination(flags.output) && process.stdout.isTTY;
    if (toTerminal || failure) logger.flush();
    else tally.writing(destination(flags.output) ?? 'stdout');
    try {
      await runner.teardown();
    } catch (error) {
      if (!failure) failure = error;
      logger.emit({
        level: 'error',
        kind: 'error',
        message: `Extraction cleanup failed: ${error instanceof Error ? error.message : error}`,
      });
    } finally {
      logger.flush();
      restoreConsole();
      setDefaultSink(previousSink);
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  if (failure) throw failure;
  const hasRecords = tally.processed > 0;
  // Records on this same screen get a line of air before the summary.
  const shared = !destination(flags.output) && process.stdout.isTTY && process.stderr.isTTY;
  if (format === 'pretty' && shared && hasRecords && !flags.quiet) process.stderr.write('\n');
  tally.summary(destination(flags.output));
  // Only the default cap earns a hint, and only when it left records unread
  // (the runner peeked one past it); a limit you set is the scope you asked for.
  const hints: Hint[] = [];
  if (builder.peeking() && runner.truncated) {
    const { limit } = flags;
    const of = sourceTotal && sourceTotal > limit ? ` of ${count(sourceTotal)}` : '';
    hints.push({
      message: `first ${count(limit)}${of}`,
      action: 'use --limit 0 for all',
      fields: { limit, ...(of && { total: sourceTotal }) },
    });
  }
  if (hasRecords) hints.push(...columnHints(flags, builder.loader, flagSources));
  for (const { message, action, fields } of hints) {
    logger.emit({
      level: 'info',
      kind: 'hint',
      message,
      hint: { action },
      ...(fields && { fields }),
    });
  }
  logger.flush();
  if (tally.failed > 0)
    throw new Error(`Extraction failed for ${tally.failed} record operation(s).`);
  return { processedCount: tally.processed, errorCount: tally.failed };
}
