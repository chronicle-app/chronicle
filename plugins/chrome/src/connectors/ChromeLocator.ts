import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Locator, type Candidate, type LocationMatch } from '@chronicle.app/etl';
import { readChromeAccount } from './profile.js';

/** Chrome's profiles by folder, with the name each shows in Chrome's profile menu. */
function readProfiles(localStatePath: string): { [folder: string]: { name?: string } } | null {
  try {
    const profiles = JSON.parse(readFileSync(localStatePath, 'utf8'))?.profile?.info_cache;
    return profiles && typeof profiles === 'object' ? profiles : null;
  } catch {
    return null;
  }
}

/**
 * Chrome's profiles, named as its profile menu names them, with the account
 * each is signed in to. The profile list in `Local State` decides which
 * folders are profiles, since Chrome keeps others beside them, like
 * `System Profile`, that no one browses in.
 */
export class ChromeLocator extends Locator {
  static override source = 'chrome';
  static override strategy = 'app-db';

  override async *locate(matches: LocationMatch[]): AsyncGenerator<Candidate> {
    for (const match of matches) {
      const profile = String(match.options.profile);
      const profileDir = dirname(match.path);
      const profiles = readProfiles(join(dirname(profileDir), 'Local State'));
      if (profiles && !profiles[profile]) continue;
      const name = profiles?.[profile]?.name || profile;
      const account = readChromeAccount(join(profileDir, 'Preferences'));
      yield {
        label: account ? `${name} (${account.email})` : name,
        config: { profile },
        path: match.path,
      };
    }
  }
}
