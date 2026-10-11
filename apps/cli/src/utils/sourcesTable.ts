import { table, type Tokens } from '../output/index.js';
import type { SourceListing } from '../plugins/catalog.js';

export const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** The sources as a table: name, strategies (the default first), and summary. */
export function sourcesTable(sources: SourceListing[], t: Tokens, width: number): string[] {
  return table(
    {
      headings: ['source', 'strategy', 'description'],
      cells: sources.map(row => [
        row.source,
        // The default strategy first; it's what a bare `extract` takes.
        [...row.strategies]
          .sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)))
          .map(strategy => strategy.name)
          .join(', '),
        row.summary,
      ]),
    },
    t,
    width
  ).lines;
}
