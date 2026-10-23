import { dirname, join } from 'node:path';
import { Locator, type Candidate, type LocationMatch } from '@chronicle.app/etl';
import { zoteroDataDir } from '../dataDir.js';

/**
 * Zotero's library where its preferences say it is, which is where a run
 * reads it, and one left in the default `~/Zotero` the manifest names, if
 * that's another.
 */
export class ZoteroLocator extends Locator {
  static override source = 'zotero';
  static override strategy = 'app-db';

  override async *locate(matches: LocationMatch[]): AsyncGenerator<Candidate> {
    const libraries = new Set([
      join(zoteroDataDir(this.context.home), 'zotero.sqlite'),
      ...matches.map(match => match.path),
    ]);
    for (const file of libraries) yield { config: { input: dirname(file) }, path: file };
  }
}
