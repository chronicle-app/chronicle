import type { Runner } from '@chronicle.app/etl';
import { RunnerBuilder } from './RunnerBuilder.js';

/** Run the shared extract path with cleanup even after partial setup or interruption. */
export async function runExtraction(extractor: any, flags: any, commandId: string) {
  const { InkProgressManager } = await import('../components/extraction/InkProgressManager.js');
  const builder = new RunnerBuilder(flags);
  const runner: Runner = await builder.buildRunner(extractor);
  const originalLog = console.log;
  // Plugins sometimes log during setup, before the progress UI exists.
  console.log = console.error.bind(console);
  let progress: InstanceType<typeof InkProgressManager> | undefined;
  let failure: unknown;
  let result: unknown;
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
    result = await Promise.race([
      interruption,
      (async () => {
        await runner.setup();
        if (interrupted) return;
        progress = new InkProgressManager(
          flags,
          builder.shouldShowProgressBar(),
          undefined,
          onInterrupt
        );
        progress.showJobSetup(commandId, extractor.name || 'extractor');
        progress.initializeProgressBar(runner.numRecords || 0);
        progress.addDataSeparator();
        for await (const log of runner.run()) {
          if (interrupted) break;
          progress.processLogEntry(log, flags.verbose);
          for (const message of [
            log.error,
            ...(log.validationErrors ?? []),
            ...log.results.filter(result => !result.success).map(result => result.error),
          ]) {
            if (message) console.error(`Extraction error: ${message}`);
          }
        }
        progress.stopProgressBar();
        const stats = progress.displayStats();
        if (stats.errorCount > 0)
          throw new Error(`Extraction failed for ${stats.errorCount} record operation(s).`);
        return stats;
      })(),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await runner.teardown();
    } catch (error) {
      if (!failure) failure = error;
      console.error('Extraction cleanup failed:', error instanceof Error ? error.message : error);
    } finally {
      if (failure) progress?.teardownNow();
      else await progress?.teardown();
      console.log = originalLog;
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  if (failure) throw failure;
  return result;
}
