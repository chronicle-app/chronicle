import os from 'node:os';
import path from 'node:path';
import type { Survey, SurveyOptions } from '@chronicle.app/etl';
import type { SourceListing } from './catalog.js';
import type { ExtractorMetadata } from './PluginScanner.js';
import { check, commandFor, fromHome, withoutDefaults, type ScanRow } from './scan.js';
import { ExtractorSelector } from '../utils/ExtractorSelector.js';
import { FlagManager } from '../utils/FlagManager.js';
import { ALL_KINDS } from '../utils/recordKinds.js';

/** Whether a row can be surveyed: ready to extract, and read without the network. */
export function surveyable(row: ScanRow, extractors: Map<string, ExtractorMetadata[]>): boolean {
  const pool = (extractors.get(row.source) ?? []).filter(e => e.strategy === row.strategy);
  return row.installed && row.status === 'ready' && pool.some(e => e.delivery !== 'api');
}

/** How much a run of `Selected` with `config` would read: set up, asked, and put away. */
export async function surveyWith(
  Selected: any,
  config: { [option: string]: unknown },
  options: SurveyOptions = {}
): Promise<Survey | null> {
  const extractor = new Selected({ ...config, quiet: true });
  await extractor.setup();
  try {
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

/**
 * How much a row's run would read: the extractor a run of every kind with
 * the row's options would use, set up and asked. Null when it can't say.
 */
export async function surveyRow(
  row: ScanRow,
  extractors: Map<string, ExtractorMetadata[]>,
  options: SurveyOptions = {}
): Promise<Survey | null> {
  const Selected = await new ExtractorSelector({
    source: row.source,
    candidates: extractors.get(row.source) ?? [],
    strategy: row.strategy,
    types: [ALL_KINDS],
    config: row.config,
    interactive: false,
  }).select();
  return surveyWith(Selected, row.config, options);
}

/**
 * A run given its options, as a row the way a scan lists what it finds:
 * named for its input, the one its extractor reads by default, or else its
 * options, with the command that extracts it. Null when there's nothing at
 * the input.
 */
export async function rowFor(
  listing: SourceListing,
  strategy: string,
  options: { [option: string]: unknown },
  extractors: ExtractorMetadata[],
  kinds: string[] = []
): Promise<ScanRow | null> {
  const home = os.homedir();
  const pool = extractors.filter(e => e.strategy === strategy);
  const input = typeof options.input === 'string' ? path.resolve(options.input) : undefined;
  const checked = input ? await check(input, process.platform) : { status: 'ready' as const };
  if (!checked) return null;
  const config = withoutDefaults(input ? { ...options, input } : options, pool);
  const shape: { [field: string]: any } | undefined = pool[0]?.extractor.schema?.shape;
  const read = input ?? (shape?.input && FlagManager.getDefault(shape.input._def));
  // The options as flags: the words after the source in its command.
  const flags = commandFor(listing, strategy, options, home).split(' ').slice(3).join(' ');
  return {
    source: listing.source,
    strategy,
    label: typeof read === 'string' ? fromHome(read, home) : flags || strategy,
    status: checked.status,
    installed: listing.installed,
    plugin: listing.plugin,
    config,
    command: commandFor(listing, strategy, config, home, kinds),
    evidence: { ...(input && { path: input }) },
  };
}
