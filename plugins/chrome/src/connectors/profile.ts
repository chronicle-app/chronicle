import { readFileSync } from 'node:fs';

/** The Google account a Chrome profile is signed in to. */
export interface ChromeAccount {
  gaiaId: string;
  email?: string;
}

/**
 * Read the profile's account from its `Preferences` JSON. A signed-out
 * profile, or a missing or unreadable file, has none: visits are still
 * readable, with no agent.
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

// `account_info` lists every Google account signed in on the web as well, so
// the profile's own account is the one `last_gaia_id` names.
function readAccount(prefs: any): ChromeAccount | null {
  const gaiaId = prefs?.google?.services?.last_gaia_id ?? prefs?.sync?.gaia_id;
  if (typeof gaiaId !== 'string' || gaiaId === '') return null;
  const info = Array.isArray(prefs?.account_info)
    ? prefs.account_info.find((a: any) => a?.gaia === gaiaId)
    : undefined;
  const email = typeof info?.email === 'string' && info.email !== '' ? info.email : undefined;
  return { gaiaId, ...(email && { email }) };
}
