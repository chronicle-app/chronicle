import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Zotero keeps its profiles, on macOS and on Linux. */
const PROFILES = [
  ['Library', 'Application Support', 'Zotero', 'Profiles'],
  ['.zotero', 'zotero'],
];

/** A preference's value from a profile's `prefs.js`, as the JSON Zotero writes it. */
function pref(prefs: string, name: string): unknown {
  const value = prefs.match(
    new RegExp(`user_pref\\("${name.replaceAll('.', '\\.')}",\\s*(.+?)\\);`)
  );
  if (!value) return undefined;
  try {
    return JSON.parse(value[1]);
  } catch {
    return undefined;
  }
}

/**
 * Zotero's data folder: the one a profile's preferences name, when it was
 * moved from the default, else `~/Zotero`. Read the way Zotero reads it, so
 * a run and a scan find the same library.
 */
export function zoteroDataDir(home = homedir()): string {
  for (const parts of PROFILES) {
    const root = join(home, ...parts);
    let profiles: string[];
    try {
      profiles = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const profile of profiles) {
      let prefs: string;
      try {
        prefs = readFileSync(join(root, profile, 'prefs.js'), 'utf8');
      } catch {
        continue;
      }
      const dir = pref(prefs, 'extensions.zotero.dataDir');
      if (pref(prefs, 'extensions.zotero.useDataDir') === true && typeof dir === 'string') {
        return dir;
      }
    }
  }
  return join(home, 'Zotero');
}
