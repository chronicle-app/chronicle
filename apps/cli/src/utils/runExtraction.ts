import { randomUUID } from 'node:crypto';
import { createLogger, thresholdFor, type Logger } from '@chronicle.app/logging';
import { nodeLabel, type Runner, type RunLog } from '@chronicle.app/etl';
import type { FlagSource } from '../config/index.js';
import {
  createSink,
  defaultLogFormat,
  plainTokens,
  relativePath,
  summary,
  type ProgressFields,
  type SummaryFields,
} from '../output/index.js';
import { RunnerBuilder } from './RunnerBuilder.js';

/** Where the records land, when it's a file: relative to here unless that climbs out. */
function destination(output: unknown): string | undefined {
  if (typeof output !== 'string' || output === '' || output === 'stdout') return undefined;
  return relativePath(output);
}

/**
 * The live view goes on stderr when that's a terminal, except when records
 * stream to the same terminal. The table loader prints only after the run,
 * so it keeps the view.
 */
function wantsLiveView(flags: any): boolean {
  if (flags.quiet || !process.stderr.isTTY) return false;
  const toTerminal = !destination(flags.output) && process.stdout.isTTY;
  return !toTerminal || flags.loader === 'table';
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
  failed = 0;
  skipped = 0;
  counts: Record<string, number> = {};
  current = '';
  readonly startedAt = Date.now();

  constructor(
    private readonly logger: Logger,
    private readonly title: string,
    private readonly total: number
  ) {}

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
    if (log.filtered) this.skipped++;
    const loaded = log.results.at(-1)?.record?.data;
    this.current = label(loaded ?? log.record.data) || this.current;
    this.progress();
  }

  progress(): void {
    const fields: ProgressFields = {
      title: this.title,
      processed: this.processed,
      total: this.total,
      counts: { ...this.counts },
      elapsedMs: Date.now() - this.startedAt,
      ...(this.current && { current: this.current }),
    };
    this.logger.emit({
      level: 'debug',
      kind: 'progress',
      message: `${this.processed.toLocaleString('en-US')} records`,
      fields,
      sensitive: ['current'],
    });
  }

  summary(output: string | undefined): void {
    const fields: SummaryFields = {
      title: this.title,
      counts: this.counts,
      records: this.processed,
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
  const builder = new RunnerBuilder(flags);
  const runner: Runner = await builder.buildRunner(extractor, { sink, run });
  const originalLog = console.log;
  // Plugins sometimes log; stdout carries the records.
  console.log = console.error.bind(console);
  const title = strategy && strategy !== source ? `${source} · ${strategy}` : String(source);
  let tally: Tally | undefined;
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
        await runner.setup();
        if (interrupted) return;
        tally = new Tally(logger, title, runner.numRecords || 0);
        tally.progress();
        for await (const log of runner.run()) {
          if (interrupted) break;
          tally.record(log);
        }
      })(),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    // Off the screen before the loaders flush: the table prints on teardown.
    logger.flush();
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
      console.log = originalLog;
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  if (failure) throw failure;
  tally ??= new Tally(logger, title, 0);
  const hasRecords = tally.processed > 0;
  // Records on this same screen get a line of air before the summary.
  const shared = !destination(flags.output) && process.stdout.isTTY && process.stderr.isTTY;
  if (format === 'pretty' && shared && hasRecords && !flags.quiet) process.stderr.write('\n');
  tally.summary(destination(flags.output));
  // Only the default cap earns a hint; a limit you set is the scope you asked for.
  const limit = (flagSources.limit?.source ?? 'default') === 'default' ? flags.limit : undefined;
  const hints: Hint[] = [];
  if (limit && limit > 0 && tally.processed >= limit) {
    hints.push({
      message: `stopped at --limit ${limit.toLocaleString('en-US')}`,
      action: 'pass --limit 0 to extract everything',
      fields: { limit },
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
