import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Locator, type Candidate, type LocationMatch } from '@chronicle.app/etl';

/**
 * The vaults Obsidian has opened, from its registry, `obsidian.json`: one
 * candidate each, its folder the run's input. A vault Obsidian remembers
 * but that has since moved or gone isn't found, so it isn't offered.
 */
export class ObsidianLocator extends Locator {
  static override source = 'obsidian';
  static override strategy = 'vault';

  override async *locate(matches: LocationMatch[]): AsyncGenerator<Candidate> {
    for (const match of matches) {
      let vaults: { [id: string]: { path?: unknown } };
      try {
        vaults = JSON.parse(await readFile(match.path, 'utf8'))?.vaults ?? {};
      } catch {
        continue;
      }
      for (const vault of Object.values(vaults)) {
        if (typeof vault?.path !== 'string') continue;
        const { home } = this.context;
        const where = vault.path.startsWith(home + path.sep)
          ? `~${vault.path.slice(home.length)}`
          : vault.path;
        yield {
          label: `${path.basename(vault.path)}, ${where}`,
          config: { input: vault.path },
          path: vault.path,
        };
      }
    }
  }
}
