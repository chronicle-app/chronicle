import { table, type Tokens } from '../output/index.js';
import type { SourceListing } from '../plugins/catalog.js';
import { bareRunStrategy } from './recordKinds.js';

export const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/**
 * What stands between a source and a run here, if anything: a plugin that
 * isn't installed, or another OS. Legacy sources say so. A source ready to run
 * says nothing, so the column speaks up only where it matters.
 */
export function statusOf(row: SourceListing): string {
  return [
    ...(row.tier === 'legacy' ? ['legacy'] : []),
    ...(row.installed ? [] : ['not installed']),
    ...(row.supported ? [] : [`${row.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ')} only`]),
  ].join(', ');
}

/**
 * The sources as a table: name, strategies (the default first), status, and
 * summary. The status column is left out when every source is ready to run.
 */
export function sourcesTable(sources: SourceListing[], t: Tokens, width: number): string[] {
  const statuses = sources.map(row => statusOf(row));
  const status = statuses.some(Boolean);
  return table(
    {
      headings: ['source', 'strategy', ...(status ? ['status'] : []), 'description'],
      cells: sources.map((row, i) => [
        row.source,
        // The default strategy first; it's what a bare `extract` takes.
        defaultFirst(row.strategies)
          .map(strategy => strategy.name)
          .join(', '),
        ...(status ? [statuses[i]] : []),
        row.summary,
      ]),
      muted: [false, false, status],
    },
    t,
    width
  ).lines;
}

/** The strategies with the one a bare `extract` takes first. */
function defaultFirst<S extends SourceListing['strategies'][number]>(strategies: S[]): S[] {
  const chosen = bareRunStrategy(strategies, strategy => Boolean(strategy.default));
  return [...strategies].sort((a, b) => Number(b === chosen) - Number(a === chosen));
}
