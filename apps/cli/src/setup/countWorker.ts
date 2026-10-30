import { PluginScanner } from '../plugins/PluginScanner.js';
import { surveyRow } from '../plugins/survey.js';
import type { ScanRow } from '../plugins/scan.js';
import { surveyTarget, type Target } from './targets.js';

/** What the counter asks: a row's survey, a target's count from `since`, or to load the plugins again. */
export type Ask =
  { id: number; row: ScanRow } | { id: number; target: Target; since: string } | { refresh: true };

/**
 * Counts for setup, in a process of its own: some plugins' surveys read a
 * whole database without stopping, which would freeze what setup draws
 * meanwhile, and a query that's going can only be ended by ending the
 * process. Each is counted as it's asked, alongside any still going.
 */
let extractors = PluginScanner.scanAllPlugins();

// Setup gone, however it went, a count still going is no use to anyone.
process.on('disconnect', () => process.kill(process.pid, 'SIGKILL'));

process.on('message', async (ask: Ask) => {
  if ('refresh' in ask) {
    extractors = PluginScanner.scanAllPlugins();
    return;
  }
  try {
    const found = await extractors;
    const answer =
      'row' in ask
        ? await surveyRow(ask.row, found)
        : await surveyTarget(ask.target, found.get(ask.target.source) ?? [], new Date(ask.since));
    process.send!({ id: ask.id, answer });
  } catch (error) {
    process.send!({ id: ask.id, error: String(error) });
  }
});
