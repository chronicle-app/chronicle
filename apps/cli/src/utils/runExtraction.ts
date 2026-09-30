import { randomUUID } from 'node:crypto';
import { Errors } from '@oclif/core';
import {
  captureConsole,
  createLogger,
  describeError,
  isReported,
  markReported,
  setDefaultSink,
  thresholdFor,
} from '@chronicle.app/logging';
import type { Runner } from '@chronicle.app/etl';
import type { FlagSource } from '../config/index.js';
import { count, createSink, defaultLogFormat, relativePath, type Live } from '../output/index.js';
import { RunnerBuilder, requestedRecordTypes } from './RunnerBuilder.js';

/** Where the records land, when it's a file: relative to here unless that climbs out. */
function destination(output: unknown): string | undefined {
  if (typeof output !== 'string' || output === '' || output === 'stdout') return undefined;
  return relativePath(output);
}

/**
 * The live view goes on stderr when that's a terminal. When records print to
 * the same terminal it shows only until they do: while the run starts and
 * reads, or for the table, which prints as the run is torn down, until then.
 */
function wantsLiveView(flags: any): Live {
  if (flags.quiet || !process.stderr.isTTY) return false;
  const toTerminal = !destination(flags.output) && process.stdout.isTTY;
  if (!toTerminal) return true;
  return flags.loader === 'table' ? 'until-writing' : 'until-loading';
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

/** Run the shared extract path with cleanup even after partial setup or interruption. */
export async function runExtraction(
  extractor: any,
  flags: any,
  flagSources: Record<string, FlagSource> = {}
) {
  const { source, strategy } = extractor;
  const output = destination(flags.output);
  const sink = createSink({
    format: flags['log-format'] ?? defaultLogFormat(),
    level: thresholdFor(flags),
    theme: flags.theme,
    live: wantsLiveView(flags),
    personal: flags['log-personal'],
    air: !output && process.stdout.isTTY && process.stderr.isTTY,
  });
  const run = { id: randomUUID(), source: String(source), strategy: String(strategy ?? '') };
  const logger = createLogger({ scope: 'runner', sink, run });
  const builder = new RunnerBuilder(flags, flagSources);
  // The runner reports the run itself: progress, record errors, the summary.
  const runner: Runner = await builder.buildRunner(extractor, { sink, run, output });
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
        await runner.setup();
        if (interrupted) return;
        if (flags.stream && !requestedRecordTypes(flags.type)) sourceTotal = runner.numRecords;
        for await (const _ of runner.run()) {
          if (interrupted) break;
        }
      })(),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    // A failed run gets no summary, so its live view comes down now.
    if (failure) logger.flush();
    try {
      await runner.teardown();
    } catch (error) {
      if (!failure) failure = error;
      logger.emit({
        level: 'error',
        kind: 'error',
        message: `Extraction cleanup failed: ${error instanceof Error ? error.message : error}`,
      });
      markReported(error);
    } finally {
      // A failed run gets no summary, so what it held back prints now.
      if (failure) logger.flush();
      restoreConsole();
      setDefaultSink(previousSink);
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  if (failure) {
    // Already on stderr as an event, with its hint: exit with its code, quietly.
    if (isReported(failure)) throw new Errors.ExitError(describeError(failure).exitCode);
    throw failure;
  }
  const { processed, failed } = runner.stats;
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
  if (processed > 0) hints.push(...columnHints(flags, builder.loader, flagSources));
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
  if (failed > 0) throw new Error(`Extraction failed for ${failed} record operation(s).`);
  return { processedCount: processed, errorCount: failed };
}
