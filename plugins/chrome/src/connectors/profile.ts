import { readFileSync } from 'node:fs';

/** The Google account a Chrome profile is signed in to. */
export interface ChromeAccount {
  gaiaId: string;
  email?: string;
}

/**
 * Read the profile's account from its `Preferences` JSON: the one signed in
 * now, else the last one that synced, which Chrome keeps after sign-out. A
 * profile never signed in, or a missing or unreadable file, has none: visits
 * are still readable, with no agent.
 */
export function readChromeAccount(preferencesPath: string): ChromeAccount | null {
  let prefs: any;
  try {
    prefs = JSON.parse(readFileSync(preferencesPath, 'utf8'));
  } catch {
    return null;
  }
  return readAccount(prefs);
}

// `sync.gaia_id` is the account signed in now, cleared at sign-out;
// `google.services.last_gaia_id` is the last one that synced. `account_info`
// lists every Google account signed in on the web as well, so the profile's
// own is the entry with its Gaia id. Addresses are lowercased, as mail keys
// them.
function readAccount(prefs: any): ChromeAccount | null {
  const gaiaId = [prefs?.sync?.gaia_id, prefs?.google?.services?.last_gaia_id].find(
    (id): id is string => typeof id === 'string' && id !== ''
  );
  if (!gaiaId) return null;
  const info = Array.isArray(prefs?.account_info)
    ? prefs.account_info.find((a: any) => a?.gaia === gaiaId)
    : undefined;
  const email =
    typeof info?.email === 'string' && info.email !== '' ? info.email.toLowerCase() : undefined;
  return { gaiaId, ...(email && { email }) };
}
