import path from 'node:path';
import type { Runner } from '@chronicle.app/etl';
import type { FlagSource } from '../config/index.js';
import { ExtractionProgress } from '../components/extraction/ExtractionProgress.js';
import { getTheme } from '../theme.js';
import { RunnerBuilder } from './RunnerBuilder.js';

/** Where the records land, when it's a file: relative to here unless that climbs out. */
function destination(output: unknown): string | undefined {
  if (typeof output !== 'string' || output === '' || output === 'stdout') return undefined;
  const relative = path.relative(process.cwd(), output);
  return relative.startsWith('..') || path.isAbsolute(relative) ? output : relative;
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

/**
 * Next moves for tabular output: the columns the table had no room for, and
 * the other column mode when the run took the default one.
 */
function columnHints(flags: any, loader: any, flagSources: Record<string, FlagSource>): string[] {
  if (flags.loader !== 'csv' && flags.loader !== 'table') return [];
  const hints: string[] = [];
  const hidden: string[] = loader?.hiddenColumns ?? [];
  if (hidden.length > 0) {
    const n = hidden.length;
    hints.push(
      `${n} column${n === 1 ? '' : 's'} didn't fit (${list(hidden)}) · --loader csv keeps every column`
    );
  }
  if (loader?.collapsed && (flagSources.columns?.source ?? 'default') === 'default') {
    hints.push('nested nodes shown as labels · --columns schema keeps every schema property');
  }
  return hints;
}

/** Run the shared extract path with cleanup even after partial setup or interruption. */
export async function runExtraction(
  extractor: any,
  flags: any,
  flagSources: Record<string, FlagSource> = {}
) {
  const builder = new RunnerBuilder(flags);
  const runner: Runner = await builder.buildRunner(extractor);
  const originalLog = console.log;
  // Plugins sometimes log; stdout carries the records.
  console.log = console.error.bind(console);
  const { source, strategy } = extractor;
  const progress = new ExtractionProgress({
    title: strategy && strategy !== source ? `${source} · ${strategy}` : String(source),
    live: wantsLiveView(flags),
    // Only the default cap earns a hint; a limit you set is the scope you asked for.
    limit: (flagSources.limit?.source ?? 'default') === 'default' ? flags.limit : undefined,
    output: destination(flags.output),
    color: getTheme(flags.theme).colors.primary,
  });
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
        progress.start(runner.numRecords || 0);
        for await (const log of runner.run()) {
          if (interrupted) break;
          progress.record(log);
          for (const message of [
            log.error,
            ...(log.validationErrors ?? []),
            ...log.results.filter(result => !result.success).map(result => result.error),
          ]) {
            if (message) console.error(`Extraction error: ${message}`);
          }
        }
      })(),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    // Off the screen before the loaders flush: the table prints on teardown.
    progress.stop();
    try {
      await runner.teardown();
    } catch (error) {
      if (!failure) failure = error;
      console.error('Extraction cleanup failed:', error instanceof Error ? error.message : error);
    } finally {
      console.log = originalLog;
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  if (failure) throw failure;
  if (!flags.quiet) {
    const hasRecords = progress.processed > 0;
    const hints = hasRecords ? columnHints(flags, builder.loader, flagSources) : [];
    // Records on this same screen get a line of air before the summary.
    const shared = !destination(flags.output) && process.stdout.isTTY && process.stderr.isTTY;
    process.stderr.write(`${shared && hasRecords ? '\n' : ''}${progress.summary(hints)}\n`);
  }
  if (progress.failed > 0)
    throw new Error(`Extraction failed for ${progress.failed} record operation(s).`);
  return { processedCount: progress.processed, errorCount: progress.failed };
}
