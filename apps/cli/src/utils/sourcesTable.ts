import { table, type Tokens } from '../output/index.js';
import type { SourceListing } from '../plugins/catalog.js';

export const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** Whether the source can run here, and if not, why. Legacy sources say so. */
export function statusOf(row: SourceListing): string {
  const status = availabilityOf(row);
  return row.tier === 'legacy' ? `legacy, ${status}` : status;
}

/**
 * The plugin is named only where it matters: the one to install when its name
 * isn't the source's, which of your local plugins is running, or which package
 * outside the catalog provides it.
 */
function availabilityOf(row: SourceListing): string {
  if (!row.installed) {
    return row.plugin === row.source ? 'not installed' : `not installed · install ${row.plugin}`;
  }
  if (!row.supported) {
    return `${row.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ')} only`;
  }
  if (row.origin === 'local') return `local · ${row.plugin}`;
  if (!row.tier) return `not in catalog · ${row.package}`;
  return 'installed';
}

/** The sources as a table: name, strategies (the default first), status, and summary. */
export function sourcesTable(sources: SourceListing[], t: Tokens, width: number): string[] {
  return table(
    {
      headings: ['source', 'strategy', 'status', 'description'],
      cells: sources.map(row => [
        row.source,
        // The default strategy first; it's what a bare `extract` takes.
        [...row.strategies]
          .sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)))
          .map(strategy => strategy.name)
          .join(', '),
        statusOf(row),
        row.summary,
      ]),
      muted: [false, false, true, false],
    },
    t,
    width
  ).lines;
}
